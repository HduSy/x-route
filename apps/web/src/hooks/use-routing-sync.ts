import { useEffect } from 'react';
import { useRoutingStore } from '@/store/routing-slice';
import { routingLayer } from '@/lib/map/routing-layer';
import { mapManager } from '@/lib/map/MapManager';
import { route, getManualRoute } from '@/lib/routing';

// Stale-response guard: only the latest request may write its result.
let requestSeq = 0;

/** Wires the routing store to the imperative map layer and computes routes. */
export function useRoutingSync() {
    const active = useRoutingStore((s) => s.active);
    const anchors = useRoutingStore((s) => s.anchors);
    const profile = useRoutingStore((s) => s.profile);
    const manualMode = useRoutingStore((s) => s.manualMode);
    const resultPoints = useRoutingStore((s) => s.resultPoints);
    const showDistanceMarkers = useRoutingStore((s) => s.showDistanceMarkers);
    const showRoutePath = useRoutingStore((s) => s.showRoutePath);
    const units = useRoutingStore((s) => s.units);
    const elevationPreference = useRoutingStore((s) => s.elevationPreference);

    // Map interactions -> store (wired once)
    useEffect(() => {
        routingLayer.onMapClick = (lngLat) => {
            mapManager.markInteracted();
            const state = useRoutingStore.getState();
            if (!state.active) return;
            state.addAnchor(lngLat);
        };
        routingLayer.onInsertAnchor = (index, lngLat) => {
            mapManager.markInteracted();
            const state = useRoutingStore.getState();
            state.insertAnchor(index, lngLat);
        };
        routingLayer.onMarkerDrag = (index, to) => {
            mapManager.markInteracted();
            useRoutingStore.getState().moveAnchor(index, to);
        };
        routingLayer.onMarkerRightClick = (index) => {
            mapManager.markInteracted();
            useRoutingStore.getState().removeAnchor(index);
        };
        return () => {
            routingLayer.onMapClick = null;
            routingLayer.onInsertAnchor = null;
            routingLayer.onMarkerDrag = null;
            routingLayer.onMarkerRightClick = null;
        };
    }, []);

    // Sync display options to map layer
    useEffect(() => {
        routingLayer.setOptions({
            showDistanceMarkers,
            showRoutePath,
            units,
            isDrawMode: active,
        });
    }, [showDistanceMarkers, showRoutePath, units, active]);

    // Store -> map layer
    useEffect(() => {
        if (anchors.length === 0) {
            routingLayer.clear();
        } else {
            routingLayer.sync(anchors);
        }
    }, [anchors]);

    useEffect(() => {
        routingLayer.setResult(resultPoints);
    }, [resultPoints]);

    // Route computation on anchors/profile/manualMode change
    useEffect(() => {
        const myRequest = ++requestSeq;
        if (anchors.length < 2) {
            const state = useRoutingStore.getState();
            state.setResult([], null);
            state.setRouting(false);
            return;
        }

        const state = useRoutingStore.getState();
        state.setRouting(true);

        route(anchors, profile, manualMode, elevationPreference)
            .then((points) => {
                // Stale-response guard: sequence number AND identity of the anchors
                // that started this request. clear() swaps in a new anchors array
                // before the next effect pass bumps requestSeq — the reference
                // check closes that window so a cleared route can't be resurrected
                // by a late response.
                const state = useRoutingStore.getState();
                if (myRequest !== requestSeq || state.anchors !== anchors) return;
                state.setResult(points, null);
            })
            .catch((error: Error) => {
                const state = useRoutingStore.getState();
                if (myRequest !== requestSeq || state.anchors !== anchors) return;
                console.warn('Routing error, falling back to straight-line segments:', error);
                // Fallback to straight lines so the route line NEVER vanishes
                const fallbackPoints = getManualRoute(anchors);
                state.setResult(fallbackPoints, error.message);
            })
            .finally(() => {
                if (myRequest === requestSeq) {
                    useRoutingStore.getState().setRouting(false);
                }
            });
    }, [anchors, profile, manualMode, elevationPreference]);

    // When draw mode turns ON, ensure markers and route are synced to map layer
    useEffect(() => {
        if (active && anchors.length > 0) {
            routingLayer.sync(anchors);
            if (resultPoints.length >= 2) {
                routingLayer.setResult(resultPoints);
            }
        }
    }, [active]);
}
