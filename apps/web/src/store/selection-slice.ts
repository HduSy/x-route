import { create } from 'zustand';

/** What a single click on a route card should do next (three-state cycle:
 *  none → preview → edit → none). */
export type CardCycleAction = 'preview' | 'edit' | 'unload';

/** Decides the next state for a card click from the current selection state:
 *  - card not loaded            → 'preview' (show its track on the map only)
 *  - loaded but not the edited  → 'edit'    (load into the route editor)
 *  - the route being edited     → 'unload'  (deselect, back to unselected)
 */
export function nextCardCycleAction(
    fileId: string,
    loadedFileIds: string[],
    editingFileId: string | null
): CardCycleAction {
    if (editingFileId === fileId) return 'unload';
    if (loadedFileIds.includes(fileId)) return 'edit';
    return 'preview';
}

interface SelectionState {
    selectedFileId: string | null;
    loadedFileIds: string[];
    selectFile: (fileId: string | null) => void;
    addLoadedFile: (fileId: string) => void;
    removeLoadedFile: (fileId: string) => void;
    toggleLoadedFile: (fileId: string) => void;
    setLoadedFiles: (fileIds: string[]) => void;
    clearLoadedFiles: () => void;
}

// AD-2 selection slice: tracks which file is selected and which routes are currently loaded on the map.
// File contents themselves are stored in Dexie DB.
export const useSelectionStore = create<SelectionState>()((set) => ({
    selectedFileId: null,
    loadedFileIds: [],
    selectFile: (fileId) => set({ selectedFileId: fileId }),
    addLoadedFile: (fileId) =>
        set((state) => ({
            loadedFileIds: state.loadedFileIds.includes(fileId)
                ? state.loadedFileIds
                : [...state.loadedFileIds, fileId],
            selectedFileId: fileId,
        })),
    removeLoadedFile: (fileId) =>
        set((state) => ({
            loadedFileIds: state.loadedFileIds.filter((id) => id !== fileId),
            selectedFileId: state.selectedFileId === fileId ? null : state.selectedFileId,
        })),
    toggleLoadedFile: (fileId) =>
        set((state) => {
            const isLoaded = state.loadedFileIds.includes(fileId);
            return {
                loadedFileIds: isLoaded
                    ? state.loadedFileIds.filter((id) => id !== fileId)
                    : [...state.loadedFileIds, fileId],
                selectedFileId: isLoaded
                    ? state.selectedFileId === fileId
                        ? null
                        : state.selectedFileId
                    : fileId,
            };
        }),
    setLoadedFiles: (fileIds) => set({ loadedFileIds: fileIds }),
    clearLoadedFiles: () => set({ loadedFileIds: [], selectedFileId: null }),
}));

