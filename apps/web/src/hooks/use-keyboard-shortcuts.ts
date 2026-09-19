import { useEffect } from 'react';
import { useRoutingStore } from '@/store/routing-slice';
import { useSelectionStore } from '@/store/selection-slice';
import { deleteFile } from '@/lib/file-actions';

export function useKeyboardShortcuts() {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.tagName === 'SELECT' ||
                    target.isContentEditable)
            ) {
                return;
            }

            const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
            const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

            // Undo: Ctrl+Z / Cmd+Z (without Shift)
            if (cmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
                const { active, past, undo } = useRoutingStore.getState();
                if (active && past.length > 0) {
                    e.preventDefault();
                    undo();
                    return;
                }
            }

            // Redo: Ctrl+Y / Cmd+Shift+Z / Ctrl+Shift+Z
            if (
                (cmdOrCtrl && e.key.toLowerCase() === 'y') ||
                (cmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'z')
            ) {
                const { active, future, redo } = useRoutingStore.getState();
                if (active && future.length > 0) {
                    e.preventDefault();
                    redo();
                    return;
                }
            }

            // Escape: Deactivate routing mode
            if (e.key === 'Escape') {
                const { active, setActive } = useRoutingStore.getState();
                if (active) {
                    e.preventDefault();
                    setActive(false);
                    return;
                }
            }

            // Delete / Backspace: Remove last anchor in routing mode, or delete selected file
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const { active, anchors, removeAnchor } = useRoutingStore.getState();
                if (active) {
                    if (anchors.length > 0) {
                        e.preventDefault();
                        removeAnchor(anchors.length - 1);
                        return;
                    }
                } else {
                    const { selectedFileId } = useSelectionStore.getState();
                    if (selectedFileId) {
                        e.preventDefault();
                        void deleteFile(selectedFileId);
                        return;
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
}
