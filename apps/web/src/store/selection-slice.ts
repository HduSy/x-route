import { create } from 'zustand';

interface SelectionState {
    selectedFileId: string | null;
    selectFile: (fileId: string | null) => void;
}

// AD-2 selection slice: which file (later: track/segment/waypoint) is selected.
// File contents themselves are NOT stored here — Dexie is the source of truth
// for GPX data (see lib/db.ts), this slice only tracks UI selection state.
export const useSelectionStore = create<SelectionState>()((set) => ({
    selectedFileId: null,
    selectFile: (fileId) => set({ selectedFileId: fileId }),
}));
