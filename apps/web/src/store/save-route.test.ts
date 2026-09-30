import { describe, expect, it, beforeEach, vi } from 'vitest';
import { resolveSaveTargetId, useSelectionStore } from './selection-slice';
import { useRoutingStore } from './routing-slice';
import { saveGPXFile, updateGPXFile } from '@/lib/file-actions';

// Regression: saving a NEW route must never update the previously saved card
// that is still loaded/selected. The old resolution updated any selected &
// loaded file when nothing was being edited, silently overwriting it.

vi.mock('@/lib/file-actions', () => ({
    saveGPXFile: vi.fn(async () => `saved-${++sequence}`),
    updateGPXFile: vi.fn(async () => {}),
}));

let sequence = 0;

const saveGPXMock = vi.mocked(saveGPXFile);
const updateGPXMock = vi.mocked(updateGPXFile);

function resetStores() {
    sequence = 0;
    saveGPXMock.mockClear();
    updateGPXMock.mockClear();
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

/** Mirrors SaveRouteModal.handleSave's store/file sequence for one save. */
async function saveLikeModal() {
    const { editingFileId } = useRoutingStore.getState();
    // the real decision point (resolveSaveTargetId drives update-vs-create)
    const effectiveFileId = resolveSaveTargetId(editingFileId);
    let savedFileId = effectiveFileId;
    if (effectiveFileId) {
        await updateGPXFile(effectiveFileId, {} as never, false);
    } else {
        savedFileId = await saveGPXFile({} as never, false);
    }
    // the success callback: preview/select the saved card, reset the editor
    if (savedFileId) {
        useSelectionStore.getState().addLoadedFile(savedFileId);
        useSelectionStore.getState().selectFile(savedFileId);
    }
    useRoutingStore.getState().clear(true);
    useRoutingStore.getState().setEditingFileId(null);
    return savedFileId;
}

describe('resolveSaveTargetId', () => {
    it('updates only the editing route, never a merely selected/loaded one', () => {
        expect(resolveSaveTargetId('route-A')).toBe('route-A'); // editing state → update
        expect(resolveSaveTargetId(null)).toBeNull(); // new/loaded-selected → create
    });
});

describe('save flow: new route never overwrites the previously saved card', () => {
    beforeEach(resetStores);

    it("reproduces the user's path: save A → A loaded+selected → new B save → B is a new file, A untouched", async () => {
        // 1. Create and save route A (fresh editor, nothing loaded)
        const savedA = await saveLikeModal();
        expect(savedA).toBe('saved-1');
        expect(useSelectionStore.getState().loadedFileIds).toEqual([savedA]);
        expect(useSelectionStore.getState().selectedFileId).toBe(savedA);
        expect(useRoutingStore.getState().editingFileId).toBeNull();
        expect(updateGPXMock).not.toHaveBeenCalled();

        // 2. Draw a brand-new route B in the cleared editor. Trap state:
        //    selectedFileId is still A and A is loaded — the old resolution
        //    updated A here (silent overwrite).
        const sel = useSelectionStore.getState();
        expect(sel.selectedFileId).toBe(savedA);
        expect(sel.loadedFileIds.includes(sel.selectedFileId!)).toBe(true);
        expect(useRoutingStore.getState().editingFileId).toBeNull();

        // 3. Save B: must be a NEW file; updateGPXFile must stay untouched
        const savedB = await saveLikeModal();
        expect(savedB).not.toBe(savedA);
        expect(savedB).toBe('saved-2');
        expect(updateGPXMock).not.toHaveBeenCalled(); // A was never written
        expect(saveGPXMock).toHaveBeenCalledTimes(2); // both saves created files
    });

    it('still updates the original when saving from the editing state', async () => {
        // card cycle: A loaded → edit → editingFileId set
        useSelectionStore.getState().addLoadedFile('route-A');
        useRoutingStore.getState().setEditingFileId('route-A');

        const saved = await saveLikeModal();
        expect(saved).toBe('route-A');
        expect(updateGPXMock).toHaveBeenCalledTimes(1);
        expect(updateGPXMock).toHaveBeenCalledWith('route-A', expect.anything(), false);
        expect(saveGPXMock).not.toHaveBeenCalled();
    });
});
