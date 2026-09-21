import { create } from 'zustand';

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

