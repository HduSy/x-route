import { describe, expect, it, beforeEach } from 'vitest';
import { TrackPoint } from '@x-route/gpx';
import { nextCardCycleAction } from './selection-slice';
import { useSelectionStore } from './selection-slice';
import { useRoutingStore } from './routing-slice';

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
