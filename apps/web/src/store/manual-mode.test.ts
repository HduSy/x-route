import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useRoutingStore } from './routing-slice';
import { computeRoute, getManualRoute, routingSegmentCache, type SegmentMode } from '@/lib/routing';

// Regression suite for Manual (free-draw) mode semantics:
// Manual mode decides only how NEW segments are generated. Segments that
// already exist keep their geometry — toggling the mode must never recompute
// the route, and appended points must only affect the last segment.

const p0 = { lat: 39.9, lon: 116.4 };
const p1 = { lat: 39.91, lon: 116.41 };
const p2 = { lat: 39.92, lon: 116.42 };
const p3 = { lat: 39.93, lon: 116.43 };

/** Road-following mock: 3 coordinates per segment with a distinctive bend
 *  off the straight line, so straight-line regressions are detectable. */
function mockRoadFetch() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
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
                                [(start[0] + end[0]) / 2 + 0.005, (start[1] + end[1]) / 2 + 0.005, 12],
                                [end[0], end[1], 15],
                            ],
                        },
                    },
                ],
            }),
        } as Response;
    });
}

function resetStore() {
    useRoutingStore.setState({
        active: true,
        anchors: [],
        segmentModes: [],
        manualMode: false,
        profile: 'racing_bike',
        elevationPreference: 'any',
        resultPoints: [],
        routing: false,
        error: null,
        past: [],
        future: [],
        skipNextRouteComputation: false,
    });
}

/** Mirrors what use-routing-sync does after a store change: recompute with the
 *  CURRENT per-segment modes and store the result. */
async function recomputeLikeHook() {
    const { anchors, segmentModes, profile, elevationPreference } = useRoutingStore.getState();
    const res = await computeRoute(anchors, profile, segmentModes, elevationPreference);
    const state = useRoutingStore.getState();
    if (state.anchors !== anchors || state.segmentModes !== segmentModes) return null;
    state.setResult(res.points, res.error);
    return res.points;
}

const toLngLat = (pts: { getLatitude(): number; getLongitude(): number }[]) =>
    pts.map((p) => [p.getLongitude(), p.getLatitude()]);

describe('Manual mode only affects newly created segments', () => {
    let fetchSpy: ReturnType<typeof mockRoadFetch>;

    beforeEach(() => {
        resetStore();
        routingSegmentCache.clear();
        vi.restoreAllMocks();
        fetchSpy = mockRoadFetch();
    });

    it('regression: 3 routed points → toggle Manual → existing segments unchanged, only new segment is straight', async () => {
        const store = useRoutingStore.getState();

        // 1. Draw 3 points along the road network (Manual OFF)
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.addAnchor(p2);
        expect(useRoutingStore.getState().segmentModes).toEqual<SegmentMode[]>(['route', 'route']);
        const routed = await recomputeLikeHook();
        expect(routed).not.toBeNull();
        expect(fetchSpy).toHaveBeenCalledTimes(2); // two road segments fetched
        expect(routed!.length).toBe(5); // 3 + 3 coords stitched, duplicate p1 stripped
        const routedResult = useRoutingStore.getState().resultPoints;

        // 2. Toggle Manual ON: this must not touch the route in any way.
        //    (In use-routing-sync the effect deps are anchors/profile/
        //    segmentModes/elevationPreference — all unchanged here, so no
        //    recompute may fire.)
        const anchorsBefore = useRoutingStore.getState().anchors;
        const modesBefore = useRoutingStore.getState().segmentModes;
        useRoutingStore.getState().setManualMode(true);
        const afterToggle = useRoutingStore.getState();
        expect(afterToggle.anchors).toBe(anchorsBefore); // same reference → hook deps unchanged
        expect(afterToggle.segmentModes).toBe(modesBefore);
        expect(afterToggle.segmentModes).toEqual<SegmentMode[]>(['route', 'route']);
        expect(afterToggle.resultPoints).toBe(routedResult); // same line, untouched
        expect(fetchSpy).toHaveBeenCalledTimes(2); // still no network activity

        // 3. Add a 4th point under Manual: only the p2→p3 segment is new.
        useRoutingStore.getState().addAnchor(p3);
        expect(useRoutingStore.getState().segmentModes).toEqual<SegmentMode[]>(['route', 'route', 'manual']);
        const mixed = await recomputeLikeHook();
        expect(mixed).not.toBeNull();
        expect(fetchSpy).toHaveBeenCalledTimes(2); // zero refetch: history cached, manual needs no network

        // 3a. Existing segments keep their exact road coordinates (bend included)
        expect(toLngLat(mixed!.slice(0, routed!.length))).toEqual(toLngLat(routed!));

        // 3b. The appended p2→p3 segment is a straight line: exact continuation
        //     of the manual geometry, every point collinear with p2→p3.
        //     (Stitching keeps routed's p2 endpoint and strips the manual
        //     segment's duplicate first point, so the tail IS the full manual
        //     segment.)
        const manualSegment = getManualRoute([p2, p3]);
        expect(toLngLat(mixed!.slice(routed!.length - 1))).toEqual(toLngLat(manualSegment));
        for (const pt of mixed!.slice(routed!.length - 1)) {
            // point lies on the straight line between p2 and p3 (cross product ≈ 0)
            const cross =
                (pt.getLatitude() - p2.lat) * (p3.lon - p2.lon) -
                (pt.getLongitude() - p2.lon) * (p3.lat - p2.lat);
            expect(Math.abs(cross)).toBeLessThan(1e-9);
        }
    });

    it('undo/redo restore anchors together with their per-segment modes', async () => {
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.addAnchor(p2);
        store.setManualMode(true);
        store.addAnchor(p3);
        expect(useRoutingStore.getState().segmentModes).toEqual<SegmentMode[]>(['route', 'route', 'manual']);

        useRoutingStore.getState().undo();
        expect(useRoutingStore.getState().segmentModes).toEqual<SegmentMode[]>(['route', 'route']);

        useRoutingStore.getState().redo();
        expect(useRoutingStore.getState().segmentModes).toEqual<SegmentMode[]>(['route', 'route', 'manual']);
    });

    it('dragging an anchor keeps each segment generation mode', () => {
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.addAnchor(p2);
        store.setManualMode(true);
        store.moveAnchor(1, { lat: 39.915, lon: 116.415 });
        // mode is a property of the segment, not of the global toggle
        expect(useRoutingStore.getState().segmentModes).toEqual<SegmentMode[]>(['route', 'route']);
    });

    it('removing a middle anchor creates one new segment under the current mode', () => {
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.addAnchor(p2);

        // Manual OFF → merged segment follows the road again
        store.removeAnchor(1);
        expect(useRoutingStore.getState().segmentModes).toEqual<SegmentMode[]>(['route']);

        // Manual ON → merged segment is a straight line
        store.undo();
        store.setManualMode(true);
        useRoutingStore.getState().removeAnchor(1);
        expect(useRoutingStore.getState().segmentModes).toEqual<SegmentMode[]>(['manual']);
    });

    it('inserting a mid-route point under Manual marks only the two new segments', () => {
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.addAnchor(p2);
        store.setManualMode(true);
        useRoutingStore.getState().insertAnchor(1, { lat: 39.905, lon: 116.405 });
        // p0→new and new→p1 are fresh (manual); p1→p2 survives as routed
        expect(useRoutingStore.getState().segmentModes).toEqual<SegmentMode[]>(['manual', 'manual', 'route']);
    });
});
