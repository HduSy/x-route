import { useEffect } from 'react';
import { mapManager } from '@/lib/map/MapManager';
import { routingLayer } from '@/lib/map/routing-layer';

/**
 * Registers beforeprint/afterprint event listeners on a target (defaults to window).
 * Automatically fits the active route into the printable area and resizes the
 * MapLibre canvas so the printed sheet is perfectly framed without clipping.
 * Returns a cleanup function.
 */
export function registerPrintHandlers(target?: EventTarget): () => void {
    if (typeof window === 'undefined' && !target) return () => {};
    const evtTarget = target ?? window;

    let savedCamera: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null = null;
    let isPrinting = false;

    const handleBeforePrint = () => {
        if (isPrinting) return;
        isPrinting = true;

        const map = mapManager.getMap();
        if (!map) return;

        try {
            const center = map.getCenter();
            savedCamera = {
                center: [center.lng, center.lat],
                zoom: map.getZoom(),
                bearing: map.getBearing(),
                pitch: map.getPitch(),
            };
        } catch {}

        // 1. Enable print mode on routing layer to render WebGL Start & Finish endpoint badges
        routingLayer.setPrintMode(true);
        // 2. Flush dimensions to the printable area first so fitBounds computes correct aspect ratio
        map.resize();
        // 3. Trigger instant bounds fit for the active route to center on A4 canvas
        mapManager.fitActiveRoute(50, true);
        // 4. Force synchronous render of the WebGL canvas before print preview freezes the DOM
        try {
            if (typeof (map as any).redraw === 'function') {
                (map as any).redraw();
            } else if (typeof map.triggerRepaint === 'function') {
                map.triggerRepaint();
            }
        } catch {}
    };

    const handleAfterPrint = () => {
        if (!isPrinting) return;
        isPrinting = false;

        // Restore interactive DOM markers and hide WebGL endpoint overlays
        routingLayer.setPrintMode(false);

        const map = mapManager.getMap();
        if (!map) return;

        map.resize();
        if (savedCamera) {
            try {
                map.jumpTo({
                    center: savedCamera.center,
                    zoom: savedCamera.zoom,
                    bearing: savedCamera.bearing,
                    pitch: savedCamera.pitch,
                });
            } catch {}
            savedCamera = null;
        }
    };

    evtTarget.addEventListener('beforeprint', handleBeforePrint);
    evtTarget.addEventListener('afterprint', handleAfterPrint);

    return () => {
        evtTarget.removeEventListener('beforeprint', handleBeforePrint);
        evtTarget.removeEventListener('afterprint', handleAfterPrint);
    };
}

export function usePrintHandler() {
    useEffect(() => {
        if (typeof window === 'undefined') return;
        return registerPrintHandlers(window);
    }, []);
}
