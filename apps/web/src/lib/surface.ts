import { TrackPoint, distance, type Coordinates } from '@x-route/gpx';

export type SurfaceCategory = 'paved' | 'unpaved' | 'unknown';

export interface SurfaceStats {
    pavedMeters: number;
    unpavedMeters: number;
    unknownMeters: number;
    totalMeters: number;
    pavedPct: number;
    unpavedPct: number;
    unknownPct: number;
    pavedDistFormatted: string;
    unpavedDistFormatted: string;
    unknownDistFormatted: string;
}

const PAVED_SURFACES = new Set([
    'asphalt',
    'paved',
    'concrete',
    'concrete:plates',
    'concrete:lanes',
    'paving_stones',
    'sett',
    'cobblestone',
    'metal',
    'wood',
]);

const UNPAVED_SURFACES = new Set([
    'unpaved',
    'compacted',
    'fine_gravel',
    'gravel',
    'pebblestone',
    'ground',
    'dirt',
    'earth',
    'grass',
    'sand',
    'clay',
    'mud',
]);

const PAVED_ROAD_CLASSES = new Set([
    'motorway',
    'trunk',
    'primary',
    'secondary',
    'tertiary',
    'residential',
    'living_street',
    'service',
    'cycleway',
]);

const UNPAVED_ROAD_CLASSES = new Set([
    'track',
    'path',
    'bridleway',
]);

/**
 * Classifies an OSM surface or inferred road class into standard categories:
 * 'paved' (asphalt, concrete, paving stones, or classified public highways),
 * 'unpaved' (gravel, dirt, tracks, sand), or 'unknown'.
 */
export function classifySurface(
    rawSurface?: string,
    roadClass?: string
): SurfaceCategory {
    if (rawSurface && rawSurface !== 'missing') {
        const s = rawSurface.toLowerCase().trim();
        if (PAVED_SURFACES.has(s)) return 'paved';
        if (UNPAVED_SURFACES.has(s)) return 'unpaved';
    }

    if (roadClass) {
        const rc = roadClass.toLowerCase().trim();
        if (PAVED_ROAD_CLASSES.has(rc)) return 'paved';
        if (UNPAVED_ROAD_CLASSES.has(rc)) return 'unpaved';
    }

    return 'unknown';
}

/**
 * Computes distance-weighted surface type statistics along a polyline.
 * Matches Strava's distance-based percentage breakdown.
 */
export function computeSurfaceStats(
    points: (TrackPoint | { lat: number; lon: number; _data?: any })[],
    units: 'km' | 'mi' = 'km'
): SurfaceStats {
    let pavedMeters = 0;
    let unpavedMeters = 0;
    let unknownMeters = 0;

    const emptyResult: SurfaceStats = {
        pavedMeters: 0,
        unpavedMeters: 0,
        unknownMeters: 0,
        totalMeters: 0,
        pavedPct: 100,
        unpavedPct: 0,
        unknownPct: 0,
        pavedDistFormatted: units === 'mi' ? '0.0 mi' : '0.0 km',
        unpavedDistFormatted: units === 'mi' ? '0.0 mi' : '0.0 km',
        unknownDistFormatted: units === 'mi' ? '0.0 mi' : '0.0 km',
    };

    if (!points || points.length < 2) {
        return emptyResult;
    }

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i]!;
        const p2 = points[i + 1]!;
        const c1: Coordinates = 'attributes' in p1 ? (p1 as TrackPoint).attributes : { lat: p1.lat, lon: p1.lon };
        const c2: Coordinates = 'attributes' in p2 ? (p2 as TrackPoint).attributes : { lat: p2.lat, lon: p2.lon };
        const dist = distance(c1, c2);

        // Get surface category from segment endpoints' metadata
        const category: SurfaceCategory =
            p2._data?.surface ??
            p1._data?.surface ??
            classifySurface(p2._data?.rawSurface, p2._data?.roadClass) ??
            classifySurface(p1._data?.rawSurface, p1._data?.roadClass) ??
            'paved';

        if (category === 'paved') {
            pavedMeters += dist;
        } else if (category === 'unpaved') {
            unpavedMeters += dist;
        } else {
            unknownMeters += dist;
        }
    }

    const totalMeters = pavedMeters + unpavedMeters + unknownMeters;
    if (totalMeters <= 0) {
        return emptyResult;
    }

    let pavedPct = Math.round((pavedMeters / totalMeters) * 100);
    let unpavedPct = Math.round((unpavedMeters / totalMeters) * 100);
    let unknownPct = 100 - pavedPct - unpavedPct;

    if (unknownPct < 0) {
        if (pavedPct >= unpavedPct) pavedPct += unknownPct;
        else unpavedPct += unknownPct;
        unknownPct = 0;
    }

    const formatDist = (meters: number) => {
        if (units === 'mi') {
            const mi = (meters / 1000) * 0.621371;
            return `${mi.toFixed(1)} mi`;
        }
        const km = meters / 1000;
        return `${km.toFixed(1)} km`;
    };

    return {
        pavedMeters,
        unpavedMeters,
        unknownMeters,
        totalMeters,
        pavedPct,
        unpavedPct,
        unknownPct,
        pavedDistFormatted: formatDist(pavedMeters),
        unpavedDistFormatted: formatDist(unpavedMeters),
        unknownDistFormatted: formatDist(unknownMeters),
    };
}
