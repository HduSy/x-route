/** Expose lasso mode state to MapView via a simple store singleton.
 *  MapView reads this to know whether to activate box-select behavior. */
export const lassoModeStore = {
    active: false,
    listeners: new Set<(v: boolean) => void>(),
    set(v: boolean) {
        this.active = v;
        this.listeners.forEach((fn) => fn(v));
    },
    subscribe(fn: (v: boolean) => void) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    },
};
