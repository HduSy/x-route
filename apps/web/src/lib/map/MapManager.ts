import { AttributionControl, Map as MapLibreMap, setWorkerUrl, type LngLatBoundsLike } from 'maplibre-gl';
// maplibre v6 is ESM-only and loads its worker from a separate runtime file;
// Vite cannot rewrite that URL automatically — route it through the bundler.
// https://www.maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

// AD-6: imperative MapLibre singleton. React only owns the container div;
// all map operations go through this manager (vanilla access from anywhere,
// no hooks rules inside map event callbacks).

export const BASEMAPS = {
    liberty: { label: 'Liberty', style: 'https://tiles.openfreemap.org/styles/liberty' },
    positron: { label: 'Minimal', style: 'https://tiles.openfreemap.org/styles/positron' },
    dark: { label: 'Dark', style: 'https://tiles.openfreemap.org/styles/dark' },
} as const;

export type BasemapKey = keyof typeof BASEMAPS;

const DEFAULT_CENTER: [number, number] = [4.4049, 50.7908]; // Brussels test area
const DEFAULT_ZOOM = 10;

class MapManager {
    private map: MapLibreMap | null = null;
    private container: HTMLElement | null = null;
    private basemap: BasemapKey = 'liberty';
    private styleReloadCallbacks = new Set<() => void>();

    /** Idempotent under React StrictMode double-mount: re-init with the same
     *  container is a no-op; a different container tears down and rebuilds. */
    init(container: HTMLElement): MapLibreMap {
        if (this.map && this.container === container) {
            return this.map;
        }
        if (this.map) {
            this.destroy();
        }

        const map = new MapLibreMap({
            container,
            style: BASEMAPS[this.basemap].style,
            center: DEFAULT_CENTER,
            zoom: DEFAULT_ZOOM,
            attributionControl: false,
        });
        map.addControl(new AttributionControl({ compact: true }));

        this.map = map;
        this.container = container;
        (globalThis as { __xroute_map?: MapLibreMap }).__xroute_map = map; // debug/testing hook
        return map;
    }

    destroy() {
        if (!this.map) return;
        (globalThis as { __xroute_map?: MapLibreMap }).__xroute_map = undefined;
        this.map.remove();
        this.map = null;
        this.container = null;
    }

    getMap(): MapLibreMap | null {
        return this.map;
    }

    getBasemap(): BasemapKey {
        return this.basemap;
    }

    setBasemap(key: BasemapKey) {
        if (key === this.basemap) return;
        this.basemap = key;
        if (this.map) {
            this.map.setStyle(BASEMAPS[key].style);
            // Dynamic sources/layers are wiped by setStyle. Wait out the style
            // diff window first: right after setStyle, getSource()/getLayer()
            // still return the PREVIOUS style's objects, so an immediate re-add
            // would no-op against dead objects and vanish once the new style
            // settles. A short delay plus readiness retry is the robust combo.
            setTimeout(() => {
                this.onReady(() => this.styleReloadCallbacks.forEach((cb) => cb()));
            }, 500);
        }
    }

    fitBounds(bounds: LngLatBoundsLike, padding = 60) {
        if (!this.map) return;
        this.map.fitBounds(bounds, { padding, duration: 600, maxZoom: 16 });
    }

    /** Run `callback` as soon as the style can accept addSource/addLayer.
     *  Retries with backoff on transient "style not done loading" errors —
     *  event-based waits are unreliable here: styledata stops firing once a
     *  style settles, and isStyleLoaded() pends forever when remote glyphs
     *  404. A bounded retry loop is the robust option. */
    onReady(callback: (map: MapLibreMap) => void) {
        if (!this.map) return;
        const started = Date.now();
        let delay = 50;
        const run = () => {
            if (!this.map) return;
            try {
                callback(this.map);
            } catch (error) {
                if (Date.now() - started < 10000) {
                    setTimeout(run, delay);
                    delay = Math.min(delay * 2, 500);
                } else {
                    console.error('[map] onReady gave up:', error);
                }
            }
        };
        run();
    }

    /** Register a callback fired after every setStyle — dynamic layers added
     *  by the previous style are gone and callers must re-add them. */
    onStyleReload(callback: () => void): () => void {
        this.styleReloadCallbacks.add(callback);
        return () => this.styleReloadCallbacks.delete(callback);
    }
}

export const mapManager = new MapManager();
