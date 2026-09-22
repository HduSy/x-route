import { useEffect, useRef } from 'react';
import { useRoutingStore } from '@/store/routing-slice';
import { lassoModeStore } from '@/store/lasso-store';
import { routingLayer } from '@/lib/map/routing-layer';
import { mapManager } from '@/lib/map/MapManager';
import {
    computeRoute,
    getManualRoute,
    areAllSegmentsCached,
    cancelAllPendingRouting,
} from '@/lib/routing';

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

    const abortControllerRef = useRef<AbortController | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            if (lassoModeStore.active) return;
            state.insertAnchor(index, lngLat);
        };
        routingLayer.onMarkerDrag = (index, to) => {
            mapManager.markInteracted();
            if (lassoModeStore.active) return;
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

    // Cleanup abort controllers and debounce timers on component unmount
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            cancelAllPendingRouting();
        };
    }, []);

    // Route computation on anchors/profile/manualMode change
    useEffect(() => {
        // Clear pending debounce timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }

        if (anchors.length < 2) {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            cancelAllPendingRouting();
            const state = useRoutingStore.getState();
            state.setResult([], null);
            state.setRouting(false);
            return;
        }

        // If all segments are already cached (e.g. Undo/Redo or revisit), debounce is 0ms (instant).
        // Otherwise, 50ms micro-debounce coalesces rapid clicks and drag events.
        const allCached = areAllSegmentsCached(anchors, profile, manualMode, elevationPreference);
        const debounceMs = allCached ? 0 : 50;

        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;

            // Abort previous in-flight route computation
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            const controller = new AbortController();
            abortControllerRef.current = controller;

            const myRequest = ++requestSeq;
            const state = useRoutingStore.getState();
            state.setRouting(true);

            computeRoute(anchors, profile, manualMode, elevationPreference, controller.signal)
                .then((res) => {
                    const state = useRoutingStore.getState();
                    if (controller.signal.aborted || myRequest !== requestSeq || state.anchors !== anchors) return;
                    state.setResult(res.points, res.error);
                })
                .catch((error: Error) => {
                    if (error.name === 'AbortError' || controller.signal.aborted) return;
                    const state = useRoutingStore.getState();
                    if (myRequest !== requestSeq || state.anchors !== anchors) return;
                    console.warn('Routing error, falling back to straight-line segments:', error);
                    // Fallback to straight lines so the route line NEVER vanishes
                    const fallbackPoints = getManualRoute(anchors);
                    state.setResult(fallbackPoints, error.message);
                })
                .finally(() => {
                    if (myRequest === requestSeq && !controller.signal.aborted) {
                        useRoutingStore.getState().setRouting(false);
                    }
                });
        }, debounceMs);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
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
