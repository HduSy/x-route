import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useRoutingStore, RETURN_TO_START_MIN_GAP_M } from './routing-slice';
import { computeRoute, routingSegmentCache, type SegmentMode } from '@/lib/routing';

// returnToStart(): complete the current route as an out-and-back round trip —
// outbound untouched, return segments are the existing ones reversed (same
// generation modes, same geometry when cached).

const p0 = { lat: 39.9, lon: 116.4 };
const p1 = { lat: 39.91, lon: 116.41 };
const p2 = { lat: 39.92, lon: 116.42 };

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

/** Mirrors what use-routing-sync does after a store change. */
async function recomputeLikeHook() {
    const { anchors, segmentModes, profile, elevationPreference } = useRoutingStore.getState();
    const res = await computeRoute(anchors, profile, segmentModes, elevationPreference);
    useRoutingStore.getState().setResult(res.points, res.error);
    return res.points;
}

const toLngLat = (pts: { getLatitude(): number; getLongitude(): number }[]) =>
    pts.map((p) => [p.getLongitude(), p.getLatitude()]);

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
                                // bend off the straight line
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

describe('returnToStart', () => {
    let fetchSpy: ReturnType<typeof mockRoadFetch>;

    beforeEach(() => {
        resetStore();
        routingSegmentCache.clear();
        vi.restoreAllMocks();
        fetchSpy = mockRoadFetch();
    });

    it('appends reversed anchors and mirrors the outbound segment modes', () => {
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.setManualMode(true);
        store.addAnchor(p2); // p1→p2 manual
        store.setManualMode(false);

        const pastLength = useRoutingStore.getState().past.length;
        useRoutingStore.getState().returnToStart();

        // [p0, p1, p2] -> [p0, p1, p2, p1, p0]; return segment i reuses the
        // mode of its outbound counterpart (reverse of ['route','manual']).
        const state = useRoutingStore.getState();
        expect(state.anchors.map((a) => a.lat)).toEqual([p0.lat, p1.lat, p2.lat, p1.lat, p0.lat]);
        expect(state.segmentModes).toEqual<SegmentMode[]>(['route', 'manual', 'manual', 'route']);
        expect(state.past.length).toBe(pastLength + 1); // undoable, like every anchor edit
    });

    it('is a no-op with fewer than 2 anchors', () => {
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        const before = useRoutingStore.getState();

        useRoutingStore.getState().returnToStart();

        const after = useRoutingStore.getState();
        expect(after.anchors).toBe(before.anchors);
        expect(after.segmentModes).toBe(before.segmentModes);
        expect(after.past.length).toBe(before.past.length);
    });

    it(`is a no-op when start and end are already within ${RETURN_TO_START_MIN_GAP_M} m`, () => {
        const nearStart = { lat: p0.lat + 0.0003, lon: p0.lon }; // ~33 m north of start
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.addAnchor(nearStart);
        const before = useRoutingStore.getState();

        useRoutingStore.getState().returnToStart();

        const after = useRoutingStore.getState();
        expect(after.anchors).toBe(before.anchors);
        expect(after.segmentModes).toBe(before.segmentModes);
        expect(after.past.length).toBe(before.past.length);
    });

    it('undo restores the one-way route, redo re-applies the round trip', () => {
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.addAnchor(p2);
        useRoutingStore.getState().returnToStart();
        expect(useRoutingStore.getState().anchors).toHaveLength(5);

        useRoutingStore.getState().undo();
        let state = useRoutingStore.getState();
        expect(state.anchors.map((a) => a.lat)).toEqual([p0.lat, p1.lat, p2.lat]);
        expect(state.segmentModes).toEqual<SegmentMode[]>(['route', 'route']);

        useRoutingStore.getState().redo();
        state = useRoutingStore.getState();
        expect(state.anchors).toHaveLength(5);
        expect(state.segmentModes).toEqual<SegmentMode[]>(['route', 'route', 'route', 'route']);
    });

    it('round trip retraces the exact outbound geometry with zero extra network calls', async () => {
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.addAnchor(p2);
        const oneWay = await recomputeLikeHook();
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(oneWay!.length).toBe(5); // bent road geometry, not a straight line

        useRoutingStore.getState().returnToStart();
        const roundTrip = await recomputeLikeHook();

        // No refetch at all: the return trip reuses the cached outbound
        // segments reversed (same roads — a reverse fetch could differ on
        // one-way streets).
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        // Geometry: outbound as-is, then the outbound reversed minus the
        // duplicated turning point — a perfect closed loop.
        const oneWayCoords = toLngLat(oneWay!);
        const expected = [...oneWayCoords, ...[...oneWayCoords].reverse().slice(1)];
        expect(toLngLat(roundTrip!)).toEqual(expected);

        // It really is a loop: first point == last point
        const rt = toLngLat(roundTrip!);
        expect(rt[0]).toEqual(rt[rt.length - 1]);
    });

    it('keeps manual straight-line segments straight on the way back', async () => {
        const store = useRoutingStore.getState();
        store.addAnchor(p0);
        store.addAnchor(p1);
        store.setManualMode(true);
        store.addAnchor(p2); // manual segment p1→p2
        await recomputeLikeHook(); // one-way route exists before the user clicks
        expect(fetchSpy).toHaveBeenCalledTimes(1); // only p0→p1 went over the network

        useRoutingStore.getState().returnToStart();
        const roundTrip = await recomputeLikeHook();
        expect(fetchSpy).toHaveBeenCalledTimes(1); // return p1→p0 prefilled from cache

        // The whole tail from p1 on is two collinear manual segments (p1→p2→p1)
        const tail = roundTrip!.slice(2);
        for (const pt of tail) {
            const cross =
                (pt.getLatitude() - p1.lat) * (p2.lon - p1.lon) -
                (pt.getLongitude() - p1.lon) * (p2.lat - p1.lat);
            expect(Math.abs(cross)).toBeLessThan(1e-9);
        }
    });
});
