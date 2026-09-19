import { useEffect, useRef } from 'react';
import { useRoutingStore } from '@/store/routing-slice';
import { routingLayer } from '@/lib/map/routing-layer';
import { route } from '@/lib/routing';

// Stale-response guard: only the latest request may write its result.
let requestSeq = 0;

/** Wires the routing store to the imperative map layer and computes routes. */
export function useRoutingSync() {
    const active = useRoutingStore((s) => s.active);
    const anchors = useRoutingStore((s) => s.anchors);
    const profile = useRoutingStore((s) => s.profile);
    const resultPoints = useRoutingStore((s) => s.resultPoints);

    // Map interactions -> store (wired once)
    useEffect(() => {
        routingLayer.onMapClick = (lngLat) => {
            const state = useRoutingStore.getState();
            if (!state.active) return;
            state.addAnchor(lngLat);
        };
        routingLayer.onInsertAnchor = (index, lngLat) => {
            const state = useRoutingStore.getState();
            if (!state.active) return;
            state.insertAnchor(index, lngLat);
        };
        routingLayer.onMarkerDrag = (index, to) => {
            useRoutingStore.getState().moveAnchor(index, to);
        };
        routingLayer.onMarkerRightClick = (index) => {
            useRoutingStore.getState().removeAnchor(index);
        };
        return () => {
            routingLayer.onMapClick = null;
            routingLayer.onInsertAnchor = null;
            routingLayer.onMarkerDrag = null;
            routingLayer.onMarkerRightClick = null;
        };
    }, []);

    // Store -> map layer
    useEffect(() => {
        routingLayer.sync(anchors);
    }, [anchors]);

    useEffect(() => {
        routingLayer.setResult(resultPoints);
    }, [resultPoints]);

    // Route computation on anchors/profile change
    useEffect(() => {
        if (anchors.length < 2) {
            const state = useRoutingStore.getState();
            state.setResult([], null);
            state.setRouting(false);
            return;
        }

        const myRequest = ++requestSeq;
        const state = useRoutingStore.getState();
        state.setRouting(true);

        route(anchors, profile)
            .then((points) => {
                if (myRequest !== requestSeq) return;
                useRoutingStore.getState().setResult(points, null);
            })
            .catch((error: Error) => {
                if (myRequest !== requestSeq) return;
                useRoutingStore.getState().setResult([], error.message);
            })
            .finally(() => {
                if (myRequest === requestSeq) {
                    useRoutingStore.getState().setRouting(false);
                }
            });
    }, [anchors, profile]);

    // When the tool turns OFF, drop markers and the preview line. (Never
    // destroy on mount: initial active=false must not unwind the wiring.)
    const prevActive = useRef(false);
    useEffect(() => {
        if (prevActive.current && !active) {
            routingLayer.clear();
        }
        prevActive.current = active;
    }, [active]);
}
