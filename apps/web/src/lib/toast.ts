// Minimal toast pub-sub — no dependency, callers pass already-translated
// strings so the toast layer stays i18n-agnostic.

export interface ToastItem {
    id: number;
    message: string;
    kind: 'success' | 'error';
}

let seq = 0;
const listeners = new Set<(item: ToastItem) => void>();

export function toast(message: string, kind: ToastItem['kind'] = 'success') {
    const item: ToastItem = { id: ++seq, message, kind };
    listeners.forEach((notify) => notify(item));
}

export function subscribeToasts(notify: (item: ToastItem) => void): () => void {
    listeners.add(notify);
    return () => {
        listeners.delete(notify);
    };
}
