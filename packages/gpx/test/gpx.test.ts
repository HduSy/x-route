import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGPX, parseGPX, ramerDouglasPeucker } from '../src';

const testData = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../test-data/${name}`, import.meta.url)), 'utf-8');

describe('parseGPX', () => {
    it('parses metadata, tracks, segments and track points', () => {
        const file = parseGPX(testData('simple.gpx'));

        expect(file.metadata?.name).toBe('simple');

        const segments = file.getSegments();
        expect(segments).toHaveLength(1);
        expect(file.getTrackPoints()).toHaveLength(80);

        const first = segments[0]!.trkpt[0]!;
        expect(first.getCoordinates().lat).toBeCloseTo(50.790867, 6);
        expect(first.getCoordinates().lon).toBeCloseTo(4.404968, 6);
        expect(first.ele).toBeCloseTo(109.0, 1);
    });

    it('parses waypoints', () => {
        const file = parseGPX(testData('with_waypoint.gpx'));
        expect(file.wpt.length).toBeGreaterThan(0);
    });

    it('parses multiple tracks and segments', () => {
        const file = parseGPX(testData('with_tracks_and_segments.gpx'));
        expect(file.getSegments().length).toBeGreaterThan(1);
    });
});

describe('statistics', () => {
    it('computes distance, elevation and bounds for a known track', () => {
        const file = parseGPX(testData('simple.gpx'));
        const { global } = file.getStatistics();

        // Brussels test track: ~2-5 km winding path with 100-140 m elevation band
        expect(global.distance.total).toBeGreaterThan(2);
        expect(global.distance.total).toBeLessThan(5);

        // measured: gain 40.26 m, loss 19.76 m (net +20.5 m matches start/end elevation delta)
        expect(global.elevation.gain).toBeGreaterThan(30);
        expect(global.elevation.loss).toBeGreaterThan(15);

        expect(global.bounds.southWest.lat).toBeCloseTo(50.776, 2);
        expect(global.bounds.northEast.lat).toBeCloseTo(50.791, 2);
        expect(global.bounds.southWest.lon).toBeCloseTo(4.404, 2);
        expect(global.bounds.northEast.lon).toBeCloseTo(4.419, 2);

        expect(global.length).toBe(80);
    });

    it('computes time and speed statistics when timestamps are present', () => {
        const file = parseGPX(testData('with_time.gpx'));
        const { global } = file.getStatistics();

        expect(global.time.start).toBeDefined();
        expect(global.time.end).toBeDefined();
        if (global.time.total && global.time.total > 0) {
            expect(global.speed.total).toBeGreaterThan(0);
        }
    });
});

describe('buildGPX roundtrip', () => {
    it('preserves track point count through serialize/parse cycle', () => {
        const file = parseGPX(testData('simple.gpx'));
        const xml = buildGPX(file, []);
        const reparsed = parseGPX(xml);

        expect(reparsed.getTrackPoints()).toHaveLength(file.getTrackPoints().length);

        const a = file.getTrackPoints()[0]!.getCoordinates();
        const b = reparsed.getTrackPoints()[0]!.getCoordinates();
        expect(b.lat).toBeCloseTo(a.lat, 6);
        expect(b.lon).toBeCloseTo(a.lon, 6);
    });
});

describe('toGeoJSON', () => {
    it('produces GeoJSON features from a parsed file', () => {
        const file = parseGPX(testData('simple.gpx'));
        const geojson = file.toGeoJSON();
        expect(geojson).toBeDefined();
    });
});

describe('ramerDouglasPeucker', () => {
    it('reduces point count while keeping endpoints', () => {
        const file = parseGPX(testData('simple.gpx'));
        const points = file.getSegments()[0]!.trkpt;
        // epsilon is in meters (default measure: crossarcDistance, default epsilon: 50)
        const simplified = ramerDouglasPeucker(points, 10);

        expect(simplified.length).toBeLessThan(points.length);
        expect(simplified.length).toBeGreaterThanOrEqual(2);
        expect(simplified[0]!.point.getCoordinates().lat).toBeCloseTo(
            points[0]!.getCoordinates().lat,
            8
        );
        const lastIdx = points.length - 1;
        const simplifiedLast = simplified[simplified.length - 1]!;
        expect(simplifiedLast.point.getCoordinates().lat).toBeCloseTo(
            points[lastIdx]!.getCoordinates().lat,
            8
        );
    });
});
