import { TrackPoint, distance, type Coordinates } from '@x-route/gpx';

// Route planning service — mirrors gpx.studio's dual-engine setup (AD-5).
// GraphHopper goes through the relay (strict CORS on the origin instance);
// BRouter's public instance is CORS-open and called directly.

export type RoutingEngine = 'graphhopper' | 'brouter';

export interface RoutingProfile {
    engine: RoutingEngine;
    profile: string;
    label: string;
}

export const routingProfiles: Record<string, RoutingProfile> = {
    bike: { engine: 'graphhopper', profile: 'bike', label: 'Bike' },
    racing_bike: { engine: 'graphhopper', profile: 'racingbike', label: 'Road bike' },
    gravel_bike: { engine: 'graphhopper', profile: 'gravelbike', label: 'Gravel bike' },
    mountain_bike: { engine: 'graphhopper', profile: 'mtb', label: 'MTB' },
    foot: { engine: 'graphhopper', profile: 'foot', label: 'Foot' },
    hike: { engine: 'brouter', profile: 'hiking-mountain', label: 'Hike' },
    water: { engine: 'brouter', profile: 'river', label: 'Water' },
    railway: { engine: 'brouter', profile: 'rail', label: 'Railway' },
};

const graphhopperBlockPrivate: Record<string, { priority: { if: string; multiply_by: string }[] }> = {
    bike: { priority: [{ if: 'bike_road_access == PRIVATE', multiply_by: '0.0' }] },
    racingbike: { priority: [{ if: 'bike_road_access == PRIVATE', multiply_by: '0.0' }] },
    gravelbike: { priority: [{ if: 'bike_road_access == PRIVATE', multiply_by: '0.0' }] },
    mtb: { priority: [{ if: 'bike_road_access == PRIVATE', multiply_by: '0.0' }] },
    foot: { priority: [{ if: 'foot_road_access == PRIVATE', multiply_by: '0.0' }] },
};

function buildGraphHopperCustomModel(profile: string, elevationPreference: 'any' | 'min' | 'max'): object {
    const base = graphhopperBlockPrivate[profile];
    const priorities: { if: string; multiply_by: string }[] = base?.priority ? [...base.priority] : [];

    if (elevationPreference === 'min') {
        priorities.push(
            { if: 'average_slope > 4 || average_slope < -4', multiply_by: '0.2' },
            { if: 'average_slope > 8 || average_slope < -8', multiply_by: '0.1' }
        );
    } else if (elevationPreference === 'max') {
        priorities.push(
            { if: 'average_slope > 2 || average_slope < -2', multiply_by: '1.8' },
            { if: 'average_slope > 5 || average_slope < -5', multiply_by: '2.5' }
        );
    }

    return priorities.length > 0 ? { priority: priorities } : {};
}

// ---------------------------------------------------------------------------
// Segment LRU Cache & In-Flight Request Management
// ---------------------------------------------------------------------------

export class SegmentLRUCache<K, V> {
    private capacity: number;
    private map: Map<K, V>;

    constructor(capacity = 1000) {
        this.capacity = capacity;
        this.map = new Map();
    }

    get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            // Re-insert to refresh LRU order
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.map.has(key)) {
            this.map.delete(key);
        } else if (this.map.size >= this.capacity) {
            const firstKey = this.map.keys().next().value;
            if (firstKey !== undefined) {
                this.map.delete(firstKey);
            }
        }
        this.map.set(key, value);
    }

    has(key: K): boolean {
        return this.map.has(key);
    }

    delete(key: K): boolean {
        return this.map.delete(key);
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}

/** Global in-memory segment cache (LRU capacity: 1000 segments) */
export const routingSegmentCache = new SegmentLRUCache<string, TrackPoint[]>(1000);

function getCoordKey(coord: Coordinates): string {
    // 6 decimal places (~0.1m precision) avoids floating point noise while preventing collisions
    return `${coord.lat.toFixed(6)},${coord.lon.toFixed(6)}`;
}

export function getSegmentKey(
    from: Coordinates,
    to: Coordinates,
    profileKey: string,
    elevationPreference: 'any' | 'min' | 'max' = 'any'
): string {
    return `${profileKey}:${elevationPreference}:${getCoordKey(from)}->${getCoordKey(to)}`;
}

/** Returns true if every adjacent segment in `points` is already present in cache. */
export function areAllSegmentsCached(
    points: Coordinates[],
    profileKey: string,
    manualMode = false,
    elevationPreference: 'any' | 'min' | 'max' = 'any'
): boolean {
    if (manualMode || points.length < 2) return true;
    for (let i = 0; i < points.length - 1; i++) {
        const key = getSegmentKey(points[i]!, points[i + 1]!, profileKey, elevationPreference);
        if (!routingSegmentCache.has(key)) {
            return false;
        }
    }
    return true;
}

interface InFlightSegment {
    controller: AbortController;
    promise: Promise<TrackPoint[]>;
}

const inFlightSegments = new Map<string, InFlightSegment>();

/** Abort and remove any in-flight segment requests not present in `neededKeys`. */
export function cancelUnneededSegments(neededKeys: Set<string>): void {
    for (const [key, inFlight] of inFlightSegments.entries()) {
        if (!neededKeys.has(key)) {
            inFlight.controller.abort();
            inFlightSegments.delete(key);
        }
    }
}

/** Abort all currently active in-flight segment requests (e.g. on clear or reset). */
export function cancelAllPendingRouting(): void {
    cancelUnneededSegments(new Set());
}

// ---------------------------------------------------------------------------
// Manual routing & Segment fetching
// ---------------------------------------------------------------------------

export function getManualRoute(points: Coordinates[]): TrackPoint[] {
    const routePoints: TrackPoint[] = [];
    for (let i = 0; i < points.length; i++) {
        const pt = points[i]!;
        if (i > 0) {
            const prev = points[i - 1]!;
            const d = distance(prev, pt);
            // interpolate intermediate samples every ~100m so distance and profile look natural
            const count = Math.max(1, Math.floor(d / 100));
            for (let s = 1; s <= count; s++) {
                const fraction = s / count;
                const lat = prev.lat + (pt.lat - prev.lat) * fraction;
                const lon = prev.lon + (pt.lon - prev.lon) * fraction;
                routePoints.push(
                    new TrackPoint({
                        attributes: { lat, lon },
                        ele: 0,
                        extensions: {},
                    })
                );
            }
        } else {
            routePoints.push(
                new TrackPoint({
                    attributes: { lat: pt.lat, lon: pt.lon },
                    ele: 0,
                    extensions: {},
                })
            );
        }
    }
    return routePoints;
}

async function fetchSegmentFromNetwork(
    from: Coordinates,
    to: Coordinates,
    profileKey: string,
    elevationPreference: 'any' | 'min' | 'max',
    signal?: AbortSignal
): Promise<TrackPoint[]> {
    const d = distance(from, to);
    if (d < 2) {
        // Virtually identical points: return directly to prevent engine zero-distance errors
        return [
            new TrackPoint({
                attributes: { lat: from.lat, lon: from.lon },
                ele: 0,
                extensions: {},
            }),
            new TrackPoint({
                attributes: { lat: to.lat, lon: to.lon },
                ele: 0,
                extensions: {},
            }),
        ];
    }

    const profile = routingProfiles[profileKey] ?? routingProfiles.bike!;
    if (profile.engine === 'graphhopper') {
        return await getGraphHopperRoute([from, to], profile.profile, elevationPreference, signal);
    } else {
        const bProfile = (profileKey === 'hike' && elevationPreference === 'min') ? 'hiking' : profile.profile;
        try {
            return await getBRouterRoute([from, to], bProfile, signal);
        } catch (bErr: any) {
            if (signal?.aborted || bErr.name === 'AbortError') throw bErr;
            if (profileKey === 'hike') {
                return await getGraphHopperRoute([from, to], 'foot', elevationPreference, signal);
            }
            throw bErr;
        }
    }
}

async function fetchSegment(
    from: Coordinates,
    to: Coordinates,
    profileKey: string,
    elevationPreference: 'any' | 'min' | 'max',
    onWarning?: (msg: string) => void
): Promise<TrackPoint[]> {
    const key = getSegmentKey(from, to, profileKey, elevationPreference);

    // 1. Memory cache hit
    const cached = routingSegmentCache.get(key);
    if (cached) {
        return cached;
    }

    // 2. In-flight promise reuse
    const inFlight = inFlightSegments.get(key);
    if (inFlight) {
        return inFlight.promise;
    }

    // 3. New network request with its own AbortController
    const controller = new AbortController();
    const promise = (async () => {
        try {
            const points = await fetchSegmentFromNetwork(from, to, profileKey, elevationPreference, controller.signal);
            routingSegmentCache.set(key, points);
            return points;
        } catch (err: any) {
            if (controller.signal.aborted || err.name === 'AbortError') {
                throw err;
            }
            console.warn(`Segment routing failed for ${key}, falling back to straight line:`, err);
            if (onWarning) {
                onWarning(err.message ?? 'Segment unreachable by road, using straight line');
            }
            // Return straight line for this single segment without caching the fallback
            return getManualRoute([from, to]);
        } finally {
            inFlightSegments.delete(key);
        }
    })();

    inFlightSegments.set(key, { controller, promise });
    return promise;
}

async function mapConcurrent<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    concurrency = 6
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const currentIndex = index++;
            results[currentIndex] = await fn(items[currentIndex]!, currentIndex);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

// ---------------------------------------------------------------------------
// Route orchestration
// ---------------------------------------------------------------------------

export interface RouteResult {
    points: TrackPoint[];
    error: string | null;
}

/**
 * Computes a multi-waypoint route using segment caching, parallel fetching,
 * and individual segment fallback.
 */
export async function computeRoute(
    points: Coordinates[],
    profileKey: string,
    manualMode = false,
    elevationPreference: 'any' | 'min' | 'max' = 'any',
    signal?: AbortSignal
): Promise<RouteResult> {
    if (points.length < 2) {
        return { points: [], error: null };
    }

    if (manualMode) {
        cancelAllPendingRouting();
        return { points: getManualRoute(points), error: null };
    }

    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    // Build the set of needed segment keys
    const neededKeys = new Set<string>();
    const segmentPairs: { from: Coordinates; to: Coordinates }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const from = points[i]!;
        const to = points[i + 1]!;
        neededKeys.add(getSegmentKey(from, to, profileKey, elevationPreference));
        segmentPairs.push({ from, to });
    }

    // Abort in-flight segments that are no longer part of this route
    cancelUnneededSegments(neededKeys);

    let warningMessage: string | null = null;

    const segments = await mapConcurrent(
        segmentPairs,
        async ({ from, to }) => {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            return fetchSegment(from, to, profileKey, elevationPreference, (msg) => {
                warningMessage = msg;
            });
        },
        6
    );

    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    // Concatenate segments seamlessly, stripping duplicate consecutive endpoints
    const fullRoute: TrackPoint[] = [];
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        if (seg.length === 0) continue;
        if (fullRoute.length === 0) {
            fullRoute.push(...seg);
        } else {
            const lastPt = fullRoute[fullRoute.length - 1]!;
            const firstPt = seg[0]!;
            const isDuplicate =
                Math.abs(lastPt.getLatitude() - firstPt.getLatitude()) < 0.00001 &&
                Math.abs(lastPt.getLongitude() - firstPt.getLongitude()) < 0.00001;
            if (isDuplicate) {
                fullRoute.push(...seg.slice(1));
            } else {
                fullRoute.push(...seg);
            }
        }
    }

    return { points: fullRoute, error: warningMessage };
}

/**
 * Backward-compatible helper returning TrackPoint[] directly.
 */
export async function route(
    points: Coordinates[],
    profileKey: string,
    manualMode = false,
    elevationPreference: 'any' | 'min' | 'max' = 'any',
    signal?: AbortSignal
): Promise<TrackPoint[]> {
    const result = await computeRoute(points, profileKey, manualMode, elevationPreference, signal);
    return result.points;
}

async function getGraphHopperRoute(
    points: Coordinates[],
    profile: string,
    elevationPreference: 'any' | 'min' | 'max' = 'any',
    signal?: AbortSignal
): Promise<TrackPoint[]> {
    const response = await fetch('/api/graphhopper/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            points: points.map((point) => [point.lon, point.lat]),
            profile,
            elevation: true,
            points_encoded: false,
            custom_model: buildGraphHopperCustomModel(profile, elevationPreference),
        }),
        signal,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
        throw new Error(normalizeGraphHopperError(error, points.length));
    }

    const json = await response.json();
    const coordinates: number[][] = json.paths[0].points.coordinates;

    const routePoints: TrackPoint[] = [];
    for (let i = 0; i < coordinates.length; i++) {
        routePoints.push(
            new TrackPoint({
                attributes: { lat: coordinates[i]![1]!, lon: coordinates[i]![0]! },
                ele: coordinates[i]![2] ?? (i > 0 ? routePoints[i - 1]!.ele : 0),
                extensions: {},
            })
        );
    }
    return routePoints;
}

async function getBRouterRoute(
    points: Coordinates[],
    profile: string,
    signal?: AbortSignal
): Promise<TrackPoint[]> {
    const url = `https://brouter.de/brouter?lonlats=${points
        .map((point) => `${point.lon.toFixed(8)},${point.lat.toFixed(8)}`)
        .join('|')}&profile=${profile}&format=geojson&alternativeidx=0`;

    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`BRouter error (HTTP ${response.status})`);
    }

    const json = await response.json();
    const coordinates: number[][] = json.features[0].geometry.coordinates;

    return coordinates.map(
        (c) =>
            new TrackPoint({
                attributes: { lat: c[1]!, lon: c[0]! },
                ele: c[2] ?? 0,
                extensions: {},
            })
    );
}

function normalizeGraphHopperError(error: { message?: string }, pointCount: number): string {
    const message = error.message ?? 'Routing failed';
    if (message.includes('Cannot find point 0')) return 'Start point is not reachable by road';
    if (message.includes('Cannot find point 1')) {
        return pointCount === 3 ? 'Via point is not reachable by road' : 'End point is not reachable by road';
    }
    return message;
}
