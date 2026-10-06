import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { TrackPoint } from '@x-route/gpx';
import { nextCardCycleAction } from './selection-slice';
import { useSelectionStore } from './selection-slice';
import { useRoutingStore } from './routing-slice';
import { drawerOverlaysSidebar, drawerOverlaysPanelRects } from '@/lib/utils';

// Three-state card click cycle in MyRoutesDrawer:
//   unselected → preview (track on map, editor untouched)
//             → edit    (loaded into the route editor, anchors editable)
//             → none    (deselected, editor cleared)

const pts = (n: number) =>
    Array.from({ length: n }, (_, i) =>
        new TrackPoint({
            attributes: { lat: 39.9 + i * 0.001, lon: 116.4 + i * 0.001 },
            ele: 10 + i,
            extensions: {},
        })
    );

function resetStores() {
    useSelectionStore.setState({ selectedFileId: null, loadedFileIds: [] });
    useRoutingStore.setState({
        active: true,
        anchors: [],
        segmentModes: [],
        editingFileId: null,
        resultPoints: [],
        error: null,
        past: [],
        future: [],
        skipNextRouteComputation: false,
        myRoutesOpen: false,
        sidebarCollapsed: false,
    });
}

describe('nextCardCycleAction (pure decision)', () => {
    it('cycles none → preview → edit → unload', () => {
        expect(nextCardCycleAction('r1', [], null)).toBe('preview');
        expect(nextCardCycleAction('r1', ['r1'], null)).toBe('edit');
        expect(nextCardCycleAction('r1', ['r1'], 'r1')).toBe('unload');
    });

    it('preview does not hijack another route being edited', () => {
        // route A is in the editor; clicking unselected B previews B only
        expect(nextCardCycleAction('r2', ['r1'], 'r1')).toBe('preview');
        // loaded-but-previewed B still cycles to edit
        expect(nextCardCycleAction('r2', ['r1', 'r2'], 'r1')).toBe('edit');
    });
});

describe('card cycle state transitions (store integration)', () => {
    beforeEach(resetStores);

    it('click 1 (preview): track loaded on map, editor untouched', () => {
        // what handlePreviewRoute performs: addLoadedFile only
        useSelectionStore.getState().addLoadedFile('r1');

        const sel = useSelectionStore.getState();
        const routing = useRoutingStore.getState();
        expect(sel.loadedFileIds).toEqual(['r1']);
        expect(sel.selectedFileId).toBe('r1');
        // editor untouched: nothing being edited, no anchors
        expect(routing.editingFileId).toBeNull();
        expect(routing.anchors).toEqual([]);
    });

    it('click 2 (edit): route loaded into the editor with editable anchors', () => {
        const trkpts = pts(5);
        const routing = useRoutingStore.getState();
        // what handleLoadRoute performs for a previewed card
        useSelectionStore.getState().addLoadedFile('r1');
        routing.loadRouteFromPoints(
            trkpts.map((p) => p.getCoordinates()),
            trkpts
        );
        routing.setEditingFileId('r1');

        const sel = useSelectionStore.getState();
        const editing = useRoutingStore.getState();
        expect(sel.loadedFileIds).toEqual(['r1']);
        expect(editing.editingFileId).toBe('r1');
        expect(editing.anchors.length).toBeGreaterThanOrEqual(2); // editable nodes restored
        expect(editing.resultPoints.length).toBeGreaterThanOrEqual(2); // seeded line
    });

    it('click 3 (unload): deselected, editor cleared — full cycle back to none', () => {
        // arrive at edit state first (previous two clicks)
        const trkpts = pts(5);
        useSelectionStore.getState().addLoadedFile('r1');
        useRoutingStore.getState().loadRouteFromPoints(
            trkpts.map((p) => p.getCoordinates()),
            trkpts
        );
        useRoutingStore.getState().setEditingFileId('r1');

        // what handleUnloadRoute performs for the edited route
        useSelectionStore.getState().removeLoadedFile('r1');
        useRoutingStore.getState().clear(true);
        useSelectionStore.getState().selectFile(null);

        const sel = useSelectionStore.getState();
        const routing = useRoutingStore.getState();
        expect(sel.loadedFileIds).toEqual([]);
        expect(sel.selectedFileId).toBeNull();
        expect(routing.editingFileId).toBeNull();
        expect(routing.anchors).toEqual([]);
        expect(routing.resultPoints).toEqual([]);
    });
});

// Regression: on small layouts the My Routes drawer is a fixed overlay
// covering the route builder. Entering edit must close it — expanding the
// panel alone leaves it hidden behind the open drawer.
describe('edit entry closes the drawer when it overlays the sidebar', () => {
    beforeEach(resetStores);

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('small screen: drawer closes so the expanded panel is visible', () => {
        stubPanels(
            { left: -320, width: 320 }, // planner collapsed off-canvas (mobile draw flow)
            { left: 70, width: 320 } // open drawer covers [70, 390) of a 390px viewport
        );
        expect(drawerOverlaysSidebar()).toBe(true);

        // previewed card, drawer open, sidebar collapsed (mobile draw flow)
        useSelectionStore.getState().addLoadedFile('r1');
        useRoutingStore.setState({ myRoutesOpen: true, sidebarCollapsed: true });

        // what handleLoadRoute performs on the edit click
        const trkpts = pts(5);
        const routing = useRoutingStore.getState();
        routing.loadRouteFromPoints(trkpts.map((p) => p.getCoordinates()), trkpts);
        routing.setEditingFileId('r1');
        routing.setSidebarCollapsed(false);
        if (drawerOverlaysSidebar()) routing.setMyRoutesOpen(false);

        const after = useRoutingStore.getState();
        expect(after.editingFileId).toBe('r1');
        expect(after.sidebarCollapsed).toBe(false); // panel expanded…
        expect(after.myRoutesOpen).toBe(false); // …and actually visible
    });

    it('wide screen: drawer stays open (it does not cover the sidebar)', () => {
        stubPanels(
            { left: 0, width: 320 }, // planner expanded
            { left: 960, width: 320 } // drawer docked right on a 1280px viewport
        );
        expect(drawerOverlaysSidebar()).toBe(false);

        useSelectionStore.getState().addLoadedFile('r1');
        useRoutingStore.setState({ myRoutesOpen: true, sidebarCollapsed: false });

        const trkpts = pts(5);
        const routing = useRoutingStore.getState();
        routing.loadRouteFromPoints(trkpts.map((p) => p.getCoordinates()), trkpts);
        routing.setEditingFileId('r1');
        routing.setSidebarCollapsed(false);
        if (drawerOverlaysSidebar()) routing.setMyRoutesOpen(false);

        const after = useRoutingStore.getState();
        expect(after.sidebarCollapsed).toBe(false);
        expect(after.myRoutesOpen).toBe(true); // desktop keeps both panels
    });
});

describe('drawerOverlaysPanelRects (pure geometry)', () => {
    it('drawer covering the planner footprint -> true', () => {
        // planner [0,320]; drawer starts at 70 -> covers it
        expect(drawerOverlaysPanelRects({ left: 0, width: 320 }, { left: 70, width: 320 })).toBe(true);
    });

    it('planner collapsed off-canvas still detects the overlay (width is the footprint)', () => {
        // collapsed planner: translated left but same width — the panel we
        // are about to expand WILL sit in [0, width]
        expect(drawerOverlaysPanelRects({ left: -320, width: 320 }, { left: 70, width: 320 })).toBe(true);
    });

    it('docked side-by-side drawer -> false', () => {
        expect(drawerOverlaysPanelRects({ left: 0, width: 320 }, { left: 960, width: 320 })).toBe(false);
    });

    it('panels exactly abutting -> false (touching is not covering)', () => {
        expect(drawerOverlaysPanelRects({ left: 0, width: 320 }, { left: 320, width: 320 })).toBe(false);
    });

    it('already-closed drawer translated off-canvas -> false', () => {
        expect(drawerOverlaysPanelRects({ left: 0, width: 320 }, { left: 390, width: 320 })).toBe(false);
    });
});

// Test seam for drawerOverlaysSidebar(): fake the two panel asides.
function stubPanels(panelRect: { left: number; width: number }, drawerRect: { left: number; width: number }) {
    const fakeAside = (rect: { left: number; width: number }) => ({
        getBoundingClientRect: () => ({ left: rect.left, width: rect.width, ...rect }),
    });
    vi.stubGlobal('document', {
        querySelector: (sel: string) =>
            sel === '[data-panel="planner"]'
                ? fakeAside(panelRect)
                : sel === '[data-panel="my-routes"]'
                  ? fakeAside(drawerRect)
                  : null,
    });
}
