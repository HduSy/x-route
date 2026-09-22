import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useRoutingStore } from './routing-slice';
import { useSelectionStore } from './selection-slice';

describe('Lasso Delete All vs Partial Waypoints', () => {
    beforeEach(() => {
        useRoutingStore.setState({
            anchors: [
                { lat: 39.9, lon: 116.4 },
                { lat: 39.91, lon: 116.41 },
                { lat: 39.92, lon: 116.42 },
            ],
            editingFileId: 'route-123',
            active: true,
        });

        useSelectionStore.setState({
            selectedFileId: 'route-123',
            loadedFileIds: ['route-123', 'other-456'],
        });
    });

    it('partial lasso deletion removes only selected anchors and keeps editingFileId', () => {
        const store = useRoutingStore.getState();
        store.removeAnchors([1]); // remove middle anchor

        const updated = useRoutingStore.getState();
        expect(updated.anchors).toHaveLength(2);
        expect(updated.anchors[0]).toEqual({ lat: 39.9, lon: 116.4 });
        expect(updated.anchors[1]).toEqual({ lat: 39.92, lon: 116.42 });
        // editingFileId should still be active
        expect(updated.editingFileId).toBe('route-123');
    });

    it('clearing all anchors resets editingFileId to null', () => {
        const store = useRoutingStore.getState();
        store.clear();

        const updated = useRoutingStore.getState();
        expect(updated.anchors).toHaveLength(0);
        expect(updated.editingFileId).toBeNull();
    });

    it('selection store unloads deleted file cleanly', () => {
        const selection = useSelectionStore.getState();
        selection.removeLoadedFile('route-123');

        const updated = useSelectionStore.getState();
        expect(updated.loadedFileIds).toEqual(['other-456']);
        expect(updated.selectedFileId).toBeNull();
    });
});
