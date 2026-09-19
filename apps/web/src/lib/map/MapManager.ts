import { AttributionControl, Map as MapLibreMap, Marker, ScaleControl, setWorkerUrl, type LngLatBoundsLike } from 'maplibre-gl';
// maplibre v6 is ESM-only and loads its worker from a separate runtime file;
// Vite cannot rewrite that URL automatically — route it through the bundler.
// https://www.maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

// AD-6: imperative MapLibre singleton. React only owns the container div;
// all map operations go through this manager (vanilla access from anywhere,
// no hooks rules inside map event callbacks).

export type BasemapKey = 'bright' | 'liberty' | 'positron' | 'dark';

export const BASEMAPS: Record<BasemapKey, { label: string; style: string }> = {
    bright: { label: 'Bright', style: 'https://tiles.openfreemap.org/styles/bright' },
    liberty: { label: 'Liberty', style: 'https://tiles.openfreemap.org/styles/liberty' },
    positron: { label: 'Positron', style: 'https://tiles.openfreemap.org/styles/positron' },
    dark: { label: 'Dark', style: 'https://tiles.openfreemap.org/styles/dark' },
};

const DEFAULT_CENTER: [number, number] = [4.4049, 50.7908]; // Brussels test area
const DEFAULT_ZOOM = 10;

class MapManager {
    private map: MapLibreMap | null = null;
    private container: HTMLElement | null = null;
    private basemap: BasemapKey = 'bright';
    private cursorMarker: Marker | null = null;
    private userLocationMarker: Marker | null = null;
    private userLocationCoords: { lon: number; lat: number } | null = null;
    private scaleControl: ScaleControl | null = null;
    private styleReloadCallbacks = new Set<() => void>();
    private wheelGuardHandler: ((e: WheelEvent) => void) | null = null;

    /** Idempotent under React StrictMode double-mount: re-init with the same
     *  container is a no-op; a different container tears down and rebuilds. */
    init(container: HTMLElement): MapLibreMap {
        if (this.map && this.container === container) {
            return this.map;
        }
        if (this.map) {
            this.destroy();
        }

        this.cursorMarker?.remove();
        this.cursorMarker = null;

        const map = new MapLibreMap({
            container,
            style: BASEMAPS[this.basemap].style,
            center: DEFAULT_CENTER,
            zoom: DEFAULT_ZOOM,
            minZoom: 3.5,
            maxZoom: 19,
            attributionControl: false,
        });
        map.addControl(new AttributionControl({ compact: true }));

        // Responsive scroll and pinch zoom rates: smooth and snappy without runaway zoom
        map.scrollZoom.setWheelZoomRate(1 / 1200);
        map.scrollZoom.setZoomRate(1 / 200);

        // Guard against runaway wheel delta bursts during free-spinning mouse wheels or lag spikes
        let lastWheelTime = 0;
        let recentWheelDelta = 0;
        this.wheelGuardHandler = (e: WheelEvent) => {
            const now = performance.now();
            if (now - lastWheelTime > 160) {
                recentWheelDelta = 0;
            }
            lastWheelTime = now;
            recentWheelDelta += Math.abs(e.deltaY);

            // If wheel delta exceeds the safety burst threshold within 160ms,
            // clamp further wheel events to prevent runaway zooming to 300km
            if (recentWheelDelta > 1200) {
                e.stopImmediatePropagation();
            }
        };
        container.addEventListener('wheel', this.wheelGuardHandler, { capture: true, passive: false });

        const scale = new ScaleControl({ maxWidth: 90, unit: 'metric' });
        map.addControl(scale, 'bottom-left');
        this.scaleControl = scale;

        this.map = map;
        this.container = container;
        (globalThis as { __xroute_map?: MapLibreMap }).__xroute_map = map; // debug/testing hook

        // Initial settlement kicks
        requestAnimationFrame(() => this.map?.resize());
        setTimeout(() => this.map?.resize(), 100);

        return map;
    }

    destroy() {
        if (this.container && this.wheelGuardHandler) {
            this.container.removeEventListener('wheel', this.wheelGuardHandler, { capture: true });
            this.wheelGuardHandler = null;
        }
        if (!this.map) return;
        (globalThis as { __xroute_map?: MapLibreMap }).__xroute_map = undefined;
        this.cursorMarker?.remove();
        this.cursorMarker = null;
        this.userLocationMarker?.remove();
        this.userLocationMarker = null;
        this.userLocationCoords = null;
        this.scaleControl = null;
        this.map.remove();
        this.map = null;
        this.container = null;
    }

    resize() {
        this.map?.resize();
    }

    setScaleUnit(unit: 'metric' | 'imperial') {
        if (this.scaleControl) {
            this.scaleControl.setUnit(unit);
        }
    }

    setCursor(coords: { lon: number; lat: number } | null) {
        if (!this.map) return;
        if (
            !coords ||
            typeof coords.lon !== 'number' ||
            typeof coords.lat !== 'number' ||
            !Number.isFinite(coords.lon) ||
            !Number.isFinite(coords.lat)
        ) {
            this.cursorMarker?.remove();
            this.cursorMarker = null;
            return;
        }

        if (!this.cursorMarker) {
            const el = document.createElement('div');
            el.className = 'x-route-cursor-marker';
            el.style.cssText = `
                width: 14px;
                height: 14px;
                border-radius: 9999px;
                background-color: #863BFF;
                border: 2.5px solid #ffffff;
                box-shadow: 0 0 0 3px rgba(134, 59, 255, 0.4), 0 2px 6px rgba(0,0,0,0.35);
                pointer-events: none;
            `;
            this.cursorMarker = new Marker({ element: el, subpixelPositioning: true })
                .setLngLat([coords.lon, coords.lat])
                .addTo(this.map);
        } else {
            this.cursorMarker.setLngLat([coords.lon, coords.lat]);
        }
    }

    setUserLocation(coords: { lon: number; lat: number } | null) {
        if (!this.map) return;
        if (!coords) {
            this.userLocationMarker?.remove();
            this.userLocationMarker = null;
            this.userLocationCoords = null;
            return;
        }

        this.userLocationCoords = coords;

        if (!this.userLocationMarker) {
            const container = document.createElement('div');
            container.className = 'x-route-user-location';
            container.style.cssText = `
                width: 48px;
                height: 48px;
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
            `;

            // Pulsing breathing halo ring
            const pulse = document.createElement('div');
            pulse.className = 'x-route-user-location-pulse';
            pulse.style.cssText = `
                position: absolute;
                width: 40px;
                height: 40px;
                border-radius: 9999px;
                background-color: rgba(0, 122, 255, 0.35);
                animation: user-location-pulse 2s cubic-bezier(0.2, 0.6, 0.35, 1) infinite;
            `;

            // Center blue dot with white border and subtle breathing animation
            const dot = document.createElement('div');
            dot.className = 'x-route-user-location-dot';
            dot.style.cssText = `
                position: relative;
                width: 16px;
                height: 16px;
                border-radius: 9999px;
                background-color: #007AFF;
                border: 2.5px solid #ffffff;
                box-shadow: 0 1px 6px rgba(0, 122, 255, 0.75), 0 0 0 1px rgba(0,0,0,0.1);
                animation: user-location-breathe 2s ease-in-out infinite;
            `;

            container.appendChild(pulse);
            container.appendChild(dot);

            this.userLocationMarker = new Marker({
                element: container,
                anchor: 'center',
                subpixelPositioning: true,
            });
        }

        this.userLocationMarker.setLngLat([coords.lon, coords.lat]);
        if (!this.userLocationMarker.getElement().parentElement) {
            this.userLocationMarker.addTo(this.map);
        }
    }

    clearUserLocation() {
        this.setUserLocation(null);
    }

    getUserLocation(): { lon: number; lat: number } | null {
        return this.userLocationCoords;
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
        const started = Date.now();
        let delay = 25;
        const run = () => {
            if (!this.map) {
                if (Date.now() - started < 10000) {
                    setTimeout(run, delay);
                    delay = Math.min(delay * 1.5, 250);
                }
                return;
            }
            try {
                callback(this.map);
            } catch (error) {
                if (Date.now() - started < 10000) {
                    setTimeout(run, delay);
                    delay = Math.min(delay * 1.5, 250);
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
