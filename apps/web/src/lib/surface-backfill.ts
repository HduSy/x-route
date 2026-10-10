import { distance, GPXFile } from '@x-route/gpx';
import { classifySurface, type SurfaceCategory } from '@/lib/surface';
import { db } from '@/lib/db';
import { useRoutingStore } from '@/store/routing-slice';

/**
 * Surface backfill for imported GPX files.
 *
 * GPX carries geometry only — no surface/road-class fields — so imported
 * tracks read 100% "unknown" in the proportion bar, and routes edited on
 * top of an import (old segments unknown + new routed segments classified)
 * show inaccurate proportions. graphhopper.gpx.studio exposes no /match
 * endpoint, so we do poor-man's map matching: re-route through simplified
 * waypoints along the track (`details: [surface, road_class]`) and map the
 * snapped roads' classification back onto the original geometry by
 * nearest-vertex lookup. Intervals whose snapped length deviates too far
 * from the original are left unknown rather than trusted.
 *
 * Results persist to Dexie (per-point `_data.surface` + file-level
 * `_data.surfaceBackfilled`), so the cost is one-time per file.
 */

const WAYPOINT_SPACING_M = 1200; // target spacing between re-route waypoints
const MAX_SEGMENTS = 40; // request cap per track (spacing stretches to fit)
const REQUEST_TIMEOUT_MS = 12000;
const CONCURRENCY = 3;
const MIN_INTERVAL_M = 50; // skip snapping degenerate intervals
const MAX_LENGTH_DEVIATION = 0.25; // |snapped - original| / original — beyond this the snap is untrustworthy

interface FlatPoint {
    lat: number;
    lon: number;
}

function cumulativeDistances(pts: FlatPoint[]): number[] {
    const cum = new Array<number>(pts.length);
    cum[0] = 0;
    for (let i = 1; i < pts.length; i++) {
        cum[i] = cum[i - 1]! + distance(pts[i - 1]!, pts[i]!);
    }
    return cum;
}

/** Indices of waypoints spread along the track (~spacing meters apart,
 *  always including the endpoints; spacing stretches so the segment count
 *  never exceeds the request cap). */
function pickWaypointIndices(cum: number[], spacingM: number, maxSegments: number): number[] {
    const last = cum.length - 1;
    if (last < 1) return [0];
    const total = cum[last]!;
    if (total < spacingM * 2) return [0, last];
    const spacing = Math.max(spacingM, total / maxSegments);
    const idxs = [0];
    let nextAt = spacing;
    for (let i = 1; i < last; i++) {
        if (cum[i]! >= nextAt) {
            idxs.push(i);
            nextAt += spacing;
        }
    }
    idxs.push(last);
    return idxs;
}

interface SnappedInterval {
    pts: FlatPoint[];
    surface: SurfaceCategory[];
    lengthM: number;
}

async function fetchSnappedInterval(a: FlatPoint, b: FlatPoint): Promise<SnappedInterval | null> {
    try {
        const res = await fetch('/api/graphhopper/route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                points: [
                    [a.lon, a.lat],
                    [b.lon, b.lat],
                ],
                // Surface is road-network data, profile-independent — plain
                // bike with no custom model keeps the snap close to the roads
                // the track actually followed.
                profile: 'bike',
                elevation: false,
                points_encoded: false,
                details: ['surface', 'road_class'],
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const json = await res.json();
        const path = json?.paths?.[0];
        const coords: number[][] | undefined = path?.points?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return null;

        const expand = (key: string): (string | undefined)[] => {
            const map = new Array<string | undefined>(coords.length);
            for (const [from, to, val] of (path?.details?.[key] ?? []) as [number, number, string][]) {
                for (let i = from; i < to && i < coords.length; i++) map[i] = val;
            }
            return map;
        };
        const surfaceMap = expand('surface');
        const roadClassMap = expand('road_class');

        return {
            pts: coords.map((c) => ({ lon: c[0]!, lat: c[1]! })),
            surface: coords.map((_, i) => classifySurface(surfaceMap[i], roadClassMap[i])),
            lengthM: typeof path?.distance === 'number' ? path.distance : 0,
        };
    } catch {
        return null;
    }
}

/** Nearest-vertex lookup — planar squared distance is plenty at road scale. */
function nearestSurface(snapped: SnappedInterval, p: FlatPoint): SurfaceCategory {
    let best = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < snapped.pts.length; i++) {
        const q = snapped.pts[i]!;
        const d = (q.lat - p.lat) ** 2 + (q.lon - p.lon) ** 2;
        if (d < best) {
            best = d;
            bestIdx = i;
        }
    }
    return snapped.surface[bestIdx] ?? 'unknown';
}

async function backfillTrack(
    flat: FlatPoint[]
): Promise<{ surfaces: SurfaceCategory[]; okSegments: number }> {
    const cum = cumulativeDistances(flat);
    const wps = pickWaypointIndices(cum, WAYPOINT_SPACING_M, MAX_SEGMENTS);
    const surfaces: SurfaceCategory[] = new Array(flat.length).fill('unknown');
    let okSegments = 0;

    // Small worker pool over the intervals; a failed interval only leaves
    // its own slice unknown.
    let next = 0;
    const worker = async () => {
        while (next < wps.length - 1) {
            const k = next++;
            const i0 = wps[k]!;
            const i1 = wps[k + 1]!;
            const origLen = cum[i1]! - cum[i0]!;
            if (origLen < MIN_INTERVAL_M) continue;
            const snapped = await fetchSnappedInterval(flat[i0]!, flat[i1]!);
            if (!snapped) continue;
            // A responded-but-deviating interval counts as attempted: the
            // track may be genuinely off-road, and flagging the file done
            // avoids retrying hopeless snaps forever.
            okSegments++;
            if (Math.abs(snapped.lengthM - origLen) > MAX_LENGTH_DEVIATION * origLen) continue;
            // The shared endpoint belongs to the next interval's start;
            // only the final interval paints its closing point.
            const end = k === wps.length - 2 ? i1 + 1 : i1;
            for (let i = i0; i < end; i++) {
                if (surfaces[i] === 'unknown') surfaces[i] = nearestSurface(snapped, flat[i]!);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wps.length - 1) }, worker));

    // Trailing point keeps the previous classification if the last interval failed.
    surfaces[flat.length - 1] = surfaces[flat.length - 2] ?? 'unknown';
    return { surfaces, okSegments };
}

// --- Per-file orchestration: in-flight dedup, persisted once, retriable on total failure ---

const inflight = new Map<string, Promise<void>>();

/** Backfills surface data for a saved file (idempotent — no-op once the
 *  file is flagged done). Safe to call speculatively from UI entry points. */
export function ensureSurfaceBackfill(fileId: string): Promise<void> {
    const existing = inflight.get(fileId);
    if (existing) return existing;
    const run = runFileBackfill(fileId).finally(() => {
        if (inflight.get(fileId) === run) inflight.delete(fileId);
    });
    inflight.set(fileId, run);
    return run;
}

async function runFileBackfill(fileId: string): Promise<void> {
    try {
        const stored = await db.files.get(fileId);
        if (!stored || stored._data?.surfaceBackfilled) return;
        const trkpts = new GPXFile(stored).getTrackPoints();
        if (trkpts.length < 2) return;
        const flat = trkpts.map((p) => p.getCoordinates());

        const { surfaces, okSegments } = await backfillTrack(flat);
        // Zero responses = network trouble — leave the flag unset so the
        // next interaction can retry.
        if (okSegments === 0) return;

        // Re-read before writing: the file may have been edited meanwhile.
        const fresh = await db.files.get(fileId);
        if (!fresh || fresh._data?.surfaceBackfilled) return;
        const freshFile = new GPXFile(fresh);
        const freshPts = freshFile.getTrackPoints();
        // Only paint when the geometry is unchanged since we sampled it.
        if (freshPts.length === flat.length) {
            for (let i = 0; i < freshPts.length; i++) {
                if (surfaces[i] === 'unknown') continue;
                const pt = freshPts[i] as any;
                pt._data = { ...(pt._data ?? {}), surface: surfaces[i] };
            }
        }
        freshFile._data.surfaceBackfilled = true;
        await db.files.put(freshFile, fileId);

        // If this file is being edited right now, patch the editor's seeded
        // resultPoints too (the store action guards by file + point count).
        useRoutingStore.getState().applyBackfilledSurfaces(fileId, surfaces);
    } catch {
        // Background best-effort — never bubble up.
    }
}
