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

export async function route(
    points: Coordinates[],
    profileKey: string,
    manualMode = false,
    elevationPreference: 'any' | 'min' | 'max' = 'any'
): Promise<TrackPoint[]> {
    if (manualMode) {
        return getManualRoute(points);
    }
    const profile = routingProfiles[profileKey] ?? routingProfiles.bike!;
    try {
        if (profile.engine === 'graphhopper') {
            return await getGraphHopperRoute(points, profile.profile, elevationPreference);
        } else {
            const bProfile = (profileKey === 'hike' && elevationPreference === 'min') ? 'hiking' : profile.profile;
            return await getBRouterRoute(points, bProfile);
        }
    } catch (err) {
        if (profile.engine === 'brouter' && profileKey === 'hike') {
            return getGraphHopperRoute(points, 'foot', elevationPreference);
        }
        throw err;
    }
}

async function getGraphHopperRoute(
    points: Coordinates[],
    profile: string,
    elevationPreference: 'any' | 'min' | 'max' = 'any'
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
    profile: string
): Promise<TrackPoint[]> {
    const url = `https://brouter.de/brouter?lonlats=${points
        .map((point) => `${point.lon.toFixed(8)},${point.lat.toFixed(8)}`)
        .join('|')}&profile=${profile}&format=geojson&alternativeidx=0`;

    const response = await fetch(url);
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
