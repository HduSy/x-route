import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TrackPoint } from '@x-route/gpx';
import {
    SegmentLRUCache,
    getSegmentKey,
    areAllSegmentsCached,
    routingSegmentCache,
    getManualRoute,
    computeRoute,
} from './routing';

describe('SegmentLRUCache', () => {
    it('sets and retrieves cached items', () => {
        const cache = new SegmentLRUCache<string, number>(3);
        cache.set('a', 1);
        cache.set('b', 2);
        expect(cache.get('a')).toBe(1);
        expect(cache.get('b')).toBe(2);
        expect(cache.has('a')).toBe(true);
        expect(cache.has('c')).toBe(false);
    });

    it('evicts least recently used items when capacity is reached', () => {
        const cache = new SegmentLRUCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        // access 'a' so 'b' becomes LRU
        expect(cache.get('a')).toBe(1);
        cache.set('c', 3);
        // 'b' should have been evicted
        expect(cache.has('b')).toBe(false);
        expect(cache.has('a')).toBe(true);
        expect(cache.has('c')).toBe(true);
    });
});

describe('getSegmentKey & areAllSegmentsCached', () => {
    beforeEach(() => {
        routingSegmentCache.clear();
    });

    it('generates consistent keys regardless of tiny floating-point noise', () => {
        const p1 = { lat: 39.904200001, lon: 116.407400002 };
        const p2 = { lat: 39.904200004, lon: 116.407400003 };
        const target = { lat: 40.0, lon: 116.5 };

        const key1 = getSegmentKey(p1, target, 'bike', 'any');
        const key2 = getSegmentKey(p2, target, 'bike', 'any');
        expect(key1).toBe(key2);
    });

    it('correctly reports areAllSegmentsCached', () => {
        const p0 = { lat: 39.9, lon: 116.4 };
        const p1 = { lat: 39.91, lon: 116.41 };
        const p2 = { lat: 39.92, lon: 116.42 };

        expect(areAllSegmentsCached([p0, p1, p2], 'bike')).toBe(false);

        const key01 = getSegmentKey(p0, p1, 'bike', 'any');
        routingSegmentCache.set(key01, [
            new TrackPoint({ attributes: p0, ele: 0, extensions: {} }),
            new TrackPoint({ attributes: p1, ele: 0, extensions: {} }),
        ]);

        expect(areAllSegmentsCached([p0, p1], 'bike')).toBe(true);
        expect(areAllSegmentsCached([p0, p1, p2], 'bike')).toBe(false);

        const key12 = getSegmentKey(p1, p2, 'bike', 'any');
        routingSegmentCache.set(key12, [
            new TrackPoint({ attributes: p1, ele: 0, extensions: {} }),
            new TrackPoint({ attributes: p2, ele: 0, extensions: {} }),
        ]);

        expect(areAllSegmentsCached([p0, p1, p2], 'bike')).toBe(true);
    });
});

describe('getManualRoute', () => {
    it('produces straight line points with interpolated steps', () => {
        const p0 = { lat: 39.9, lon: 116.4 };
        const p1 = { lat: 39.91, lon: 116.41 };

        const points = getManualRoute([p0, p1]);
        expect(points.length).toBeGreaterThanOrEqual(2);
        expect(points[0]!.getLatitude()).toBeCloseTo(p0.lat, 4);
        expect(points[points.length - 1]!.getLatitude()).toBeCloseTo(p1.lat, 4);
    });
});

describe('computeRoute', () => {
    beforeEach(() => {
        routingSegmentCache.clear();
        vi.restoreAllMocks();
    });

    it('stitches segments together and removes duplicate waypoint coordinates', async () => {
        const p0 = { lat: 39.9, lon: 116.4 };
        const p1 = { lat: 39.91, lon: 116.41 };
        const p2 = { lat: 39.92, lon: 116.42 };

        // Mock global fetch to return sample GraphHopper responses
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const body = JSON.parse((init?.body as string) || '{}');
            const [start, end] = body.points;
            return {
                ok: true,
                json: async () => ({
                    paths: [
                        {
                            points: {
                                coordinates: [
                                    [start[0], start[1], 10],
                                    [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, 12],
                                    [end[0], end[1], 15],
                                ],
                            },
                        },
                    ],
                }),
            } as Response;
        });

        const res = await computeRoute([p0, p1, p2], 'bike');
        expect(res.error).toBeNull();
        // Each segment has 3 points. When stitched, the duplicate intermediate waypoint p1 is stripped:
        // seg1 has 3 points, seg2 has 3 points, combined: 3 + 2 = 5 points.
        expect(res.points).toHaveLength(5);
        expect(res.points[0]!.getLatitude()).toBeCloseTo(p0.lat, 4);
        expect(res.points[2]!.getLatitude()).toBeCloseTo(p1.lat, 4); // intermediate anchor is strictly passed!
        expect(res.points[4]!.getLatitude()).toBeCloseTo(p2.lat, 4); // end anchor
    });

    it('caches calculated segments so subsequent point additions only fetch new segments', async () => {
        const p0 = { lat: 39.9, lon: 116.4 };
        const p1 = { lat: 39.91, lon: 116.41 };
        const p2 = { lat: 39.92, lon: 116.42 };
        const p3 = { lat: 39.93, lon: 116.43 };

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const body = JSON.parse((init?.body as string) || '{}');
            const [start, end] = body.points;
            return {
                ok: true,
                json: async () => ({
                    paths: [
                        {
                            points: {
                                coordinates: [
                                    [start[0], start[1], 10],
                                    [end[0], end[1], 15],
                                ],
                            },
                        },
                    ],
                }),
            } as Response;
        });

        // 1. Initial route: p0 -> p1 -> p2 (2 segments)
        await computeRoute([p0, p1, p2], 'bike');
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        // 2. User adds p3: p0 -> p1 -> p2 -> p3 (needs 3 segments, 2 are cached!)
        fetchSpy.mockClear();
        const res2 = await computeRoute([p0, p1, p2, p3], 'bike');
        // ONLY 1 network call for segment p2 -> p3!
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(res2.points[res2.points.length - 1]!.getLatitude()).toBeCloseTo(p3.lat, 4);

        // 3. User clicks Undo: p0 -> p1 -> p2 (all 2 segments cached!)
        fetchSpy.mockClear();
        const res3 = await computeRoute([p0, p1, p2], 'bike');
        // 0 network calls! 0ms instant resolution!
        expect(fetchSpy).toHaveBeenCalledTimes(0);
        expect(res3.points[res3.points.length - 1]!.getLatitude()).toBeCloseTo(p2.lat, 4);
    });

    it('falls back to straight-line interpolation only for failed segment without breaking others', async () => {
        const p0 = { lat: 39.9, lon: 116.4 };
        const p1 = { lat: 39.91, lon: 116.41 };
        const p2 = { lat: 39.92, lon: 116.42 };

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const body = JSON.parse((init?.body as string) || '{}');
            const [start, end] = body.points;
            // Simulate segment 1->2 failing with road unreachable
            if (Math.abs(start[1] - p1.lat) < 0.001) {
                return {
                    ok: false,
                    status: 400,
                    json: async () => ({ message: 'Cannot find point 1: out of bounds' }),
                } as Response;
            }
            return {
                ok: true,
                json: async () => ({
                    paths: [
                        {
                            points: {
                                coordinates: [
                                    [start[0], start[1], 10],
                                    [end[0], end[1], 15],
                                ],
                            },
                        },
                    ],
                }),
            } as Response;
        });

        const res = await computeRoute([p0, p1, p2], 'bike');
        // res.error contains the warning for the unroutable segment
        expect(res.error).toBeDefined();
        // The complete route still exists and connects all 3 points!
        expect(res.points.length).toBeGreaterThanOrEqual(3);
        expect(res.points[0]!.getLatitude()).toBeCloseTo(p0.lat, 4);
        expect(res.points[res.points.length - 1]!.getLatitude()).toBeCloseTo(p2.lat, 4);
    });
});
