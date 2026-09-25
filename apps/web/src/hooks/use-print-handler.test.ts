import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerPrintHandlers } from './use-print-handler';
import { mapManager } from '@/lib/map/MapManager';
import { routingLayer } from '@/lib/map/routing-layer';

describe('usePrintHandler / registerPrintHandlers', () => {
    let resizeSpy: any;
    let fitActiveRouteSpy: any;

    let jumpToSpy: any;

    beforeEach(() => {
        resizeSpy = vi.fn();
        jumpToSpy = vi.fn();
        fitActiveRouteSpy = vi.spyOn(mapManager, 'fitActiveRoute').mockImplementation(async () => {});
        vi.spyOn(mapManager, 'getMap').mockReturnValue({
            resize: resizeSpy,
            redraw: vi.fn(),
            triggerRepaint: vi.fn(),
            jumpTo: jumpToSpy,
            getCenter: () => ({ lng: 9.18, lat: 45.46 }),
            getZoom: () => 12,
            getBearing: () => 0,
            getPitch: () => 0,
        } as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('attaches and detaches print event listeners on mount and unmount', () => {
        const target = new EventTarget();
        const addListenerSpy = vi.spyOn(target, 'addEventListener');
        const removeListenerSpy = vi.spyOn(target, 'removeEventListener');

        const cleanup = registerPrintHandlers(target);

        expect(addListenerSpy).toHaveBeenCalledWith('beforeprint', expect.any(Function));
        expect(addListenerSpy).toHaveBeenCalledWith('afterprint', expect.any(Function));

        cleanup();

        expect(removeListenerSpy).toHaveBeenCalledWith('beforeprint', expect.any(Function));
        expect(removeListenerSpy).toHaveBeenCalledWith('afterprint', expect.any(Function));
    });

    it('resizes map first to flush print container dimensions, then fits active route', () => {
        const target = new EventTarget();
        const executionOrder: string[] = [];

        resizeSpy.mockImplementation(() => executionOrder.push('resize'));
        fitActiveRouteSpy.mockImplementation(async () => executionOrder.push('fitActiveRoute'));

        const cleanup = registerPrintHandlers(target);

        target.dispatchEvent(new Event('beforeprint'));

        expect(executionOrder).toEqual(['resize', 'fitActiveRoute']);
        expect(fitActiveRouteSpy).toHaveBeenCalledWith(50, true);

        cleanup();
    });

    it('resizes map and restores original camera when afterprint event fires', () => {
        const target = new EventTarget();
        const cleanup = registerPrintHandlers(target);

        // Fire beforeprint to cache the active camera
        target.dispatchEvent(new Event('beforeprint'));
        // Fire afterprint to finish printing
        target.dispatchEvent(new Event('afterprint'));

        expect(resizeSpy).toHaveBeenCalled();
        expect(jumpToSpy).toHaveBeenCalledWith({
            center: [9.18, 45.46],
            zoom: 12,
            bearing: 0,
            pitch: 0,
        });

        cleanup();
    });

    it('toggles routingLayer.setPrintMode on beforeprint and afterprint', () => {
        const target = new EventTarget();
        const setPrintModeSpy = vi.spyOn(routingLayer, 'setPrintMode');

        const cleanup = registerPrintHandlers(target);

        target.dispatchEvent(new Event('beforeprint'));
        expect(setPrintModeSpy).toHaveBeenCalledWith(true);

        target.dispatchEvent(new Event('afterprint'));
        expect(setPrintModeSpy).toHaveBeenCalledWith(false);

        cleanup();
    });
});
