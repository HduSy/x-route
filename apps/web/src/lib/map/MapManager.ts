import {
    AttributionControl,
    type AttributionControlOptions,
    Map as MapLibreMap,
    Marker,
    ScaleControl,
    setWorkerUrl,
    type LngLatBoundsLike,
    type StyleSpecification,
} from 'maplibre-gl';
// maplibre v6 is ESM-only and loads its worker from a separate runtime file;
// Vite cannot rewrite that URL automatically — route it through the bundler.
// https://www.maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

/**
 * CompactAttributionControl starts in collapsed state (only the circular 'i' icon is visible)
 * rather than expanding text across the bottom on initial map load.
 */
class CompactAttributionControl extends AttributionControl {
    constructor(options?: AttributionControlOptions) {
        super({ compact: true, ...options });

        this._updateCompact = () => {
            if (!this._map) return;
            if (this._map.getCanvasContainer().offsetWidth <= 640 || this._compact) {
                if (this._compact === false) {
                    this._container.setAttribute('open', '');
                } else if (
                    !this._container.classList.contains('maplibregl-compact') &&
                    !this._container.classList.contains('maplibregl-attrib-empty')
                ) {
                    this._container.setAttribute('open', '');
                    this._container.classList.add('maplibregl-compact');
                    // Always default to collapsed: do not add 'maplibregl-compact-show'
                    this._container.classList.remove('maplibregl-compact-show');
                }
            } else {
                this._container.setAttribute('open', '');
                if (this._container.classList.contains('maplibregl-compact')) {
                    this._container.classList.remove('maplibregl-compact', 'maplibregl-compact-show');
                }
            }
        };
    }

    override onAdd(map: MapLibreMap): HTMLElement {
        const container = super.onAdd(map);
        container.classList.add('maplibregl-compact');
        container.classList.remove('maplibregl-compact-show');
        return container;
    }
}

// AD-6: imperative MapLibre singleton. React only owns the container div;
// all map operations go through this manager (vanilla access from anywhere,
// no hooks rules inside map event callbacks).

export type BasemapKey =
    | 'bright'
    | 'liberty'
    | 'positron'
    | 'dark'
    | 'esriSatellite'
    | 'openTopoMap'
    | 'cyclOSM'
    | 'openStreetMap';

export const BASEMAPS: Record<BasemapKey, { label: string; style: string | StyleSpecification }> = {
    bright: { label: 'Bright', style: 'https://tiles.openfreemap.org/styles/bright' },
    liberty: { label: 'Liberty', style: 'https://tiles.openfreemap.org/styles/liberty' },
    positron: { label: 'Positron', style: 'https://tiles.openfreemap.org/styles/positron' },
    dark: { label: 'Dark', style: 'https://tiles.openfreemap.org/styles/dark' },
    esriSatellite: {
        label: 'Satellite',
        style: {
            version: 8,
            sources: {
                esriSatellite: {
                    type: 'raster',
                    tiles: [
                        'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/WMTS/tile/1.0.0/World_Imagery/default/default028mm/{z}/{y}/{x}.jpg',
                    ],
                    tileSize: 256,
                    maxzoom: 19,
                    attribution: '© Esri',
                },
            },
            layers: [{ id: 'esriSatellite', type: 'raster', source: 'esriSatellite' }],
        },
    },
    openTopoMap: {
        label: 'OpenTopoMap',
        style: {
            version: 8,
            sources: {
                openTopoMap: {
                    type: 'raster',
                    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    maxzoom: 17,
                    attribution: '© OpenTopoMap',
                },
            },
            layers: [{ id: 'openTopoMap', type: 'raster', source: 'openTopoMap' }],
        },
    },
    cyclOSM: {
        label: 'CyclOSM',
        style: {
            version: 8,
            sources: {
                cyclOSM: {
                    type: 'raster',
                    tiles: [
                        'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
                        'https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
                    ],
                    tileSize: 256,
                    maxzoom: 18,
                    attribution: '© CyclOSM',
                },
            },
            layers: [{ id: 'cyclOSM', type: 'raster', source: 'cyclOSM' }],
        },
    },
    openStreetMap: {
        label: 'OpenStreetMap',
        style: {
            version: 8,
            sources: {
                openStreetMap: {
                    type: 'raster',
                    tiles: [
                        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    ],
                    tileSize: 256,
                    maxzoom: 19,
                    attribution: '© OpenStreetMap',
                },
            },
            layers: [{ id: 'openStreetMap', type: 'raster', source: 'openStreetMap' }],
        },
    },
};

const BASEMAP_STORAGE_KEY = 'x-route-basemap';

function getSavedBasemap(): BasemapKey {
    try {
        const val = localStorage.getItem(BASEMAP_STORAGE_KEY);
        if (val && val in BASEMAPS) return val as BasemapKey;
    } catch {}
    return 'bright';
}

function saveSavedBasemap(key: BasemapKey) {
    try {
        localStorage.setItem(BASEMAP_STORAGE_KEY, key);
    } catch {}
}

const DEFAULT_CENTER: [number, number] = [4.4049, 50.7908]; // Brussels fallback
const DEFAULT_ZOOM = 13;
const VIEWPORT_STORAGE_KEY = 'x-route-viewport';

interface SavedViewport {
    center: [number, number];
    zoom: number;
}

function getSavedViewport(): SavedViewport | null {
    try {
        const raw = localStorage.getItem(VIEWPORT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
            Array.isArray(parsed.center) &&
            parsed.center.length === 2 &&
            typeof parsed.center[0] === 'number' &&
            typeof parsed.center[1] === 'number' &&
            Number.isFinite(parsed.center[0]) &&
            Number.isFinite(parsed.center[1]) &&
            typeof parsed.zoom === 'number' &&
            Number.isFinite(parsed.zoom)
        ) {
            return parsed;
        }
    } catch {}
    return null;
}

function saveViewport(center: [number, number], zoom: number) {
    try {
        localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify({ center, zoom }));
    } catch {}
}

const LAST_LOCATION_STORAGE_KEY = 'x-route-last-location';

function getLastLocation(): { lon: number; lat: number } | null {
    try {
        const raw = localStorage.getItem(LAST_LOCATION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
            typeof parsed.lon === 'number' &&
            typeof parsed.lat === 'number' &&
            Number.isFinite(parsed.lon) &&
            Number.isFinite(parsed.lat)
        ) {
            return parsed;
        }
    } catch {}
    return null;
}

function saveLastLocation(coords: { lon: number; lat: number } | null) {
    try {
        if (!coords) {
            localStorage.removeItem(LAST_LOCATION_STORAGE_KEY);
        } else {
            localStorage.setItem(LAST_LOCATION_STORAGE_KEY, JSON.stringify(coords));
        }
    } catch {}
}

class MapManager {
    private map: MapLibreMap | null = null;
    private container: HTMLElement | null = null;
    private basemap: BasemapKey = getSavedBasemap();
    private cursorMarker: Marker | null = null;
    private userLocationMarker: Marker | null = null;
    private userLocationCoords: { lon: number; lat: number } | null = null;
    private scaleControl: ScaleControl | null = null;
    private styleReloadCallbacks = new Set<() => void>();
    private userInteracted = false;
    private saveViewportTimer: ReturnType<typeof setTimeout> | null = null;

    hasSavedViewport(): boolean {
        return getSavedViewport() !== null;
    }

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

        const saved = getSavedViewport();
        const initialCenter = saved ? saved.center : DEFAULT_CENTER;
        const initialZoom = saved ? Math.max(2.0, Math.min(19.0, saved.zoom)) : DEFAULT_ZOOM;

        const map = new MapLibreMap({
            container,
            style: BASEMAPS[this.basemap].style,
            center: initialCenter,
            zoom: initialZoom,
            minZoom: 2.0,
            maxZoom: 19.0,
            attributionControl: false,
        });
        const attribControl = new CompactAttributionControl({ compact: true });
        map.addControl(attribControl);

        // Guarantee collapsed state after initial style load
        map.once('load', () => {
            attribControl._container?.classList.remove('maplibregl-compact-show');
        });

        // Use MapLibre's rock-solid native ScrollZoomHandler with calibrated rate:
        // default 1/450 is predictable, smooth, and explosion-free across wheel and trackpads
        map.scrollZoom.enable();
        map.scrollZoom.setWheelZoomRate(1 / 450);
        map.scrollZoom.setZoomRate(1 / 100);

        // Prevent gesture disruptions during route building:
        // 1. boxZoom: Shift-dragging must NOT suddenly zoom the map into a tiny bounding box
        map.boxZoom.disable();
        // 2. doubleClickZoom: rapid waypoint creation clicks must NOT zoom the camera
        map.doubleClickZoom.disable();
        // 3. dragRotate: prevent right-click or Ctrl+drag from tilting 2D map into 3D perspective
        map.dragRotate.disable();
        // 4. touchPitch: prevent accidental two-finger vertical drag on touch/trackpad from tilting map
        map.touchPitch.disable();
        // 5. touchZoomRotate: disable rotation during pinch zoom
        map.touchZoomRotate.disableRotation();

        // Track whether the user has driven the camera (pan/zoom/pinch/click).
        // Auto-fitBounds must never yank the viewport away from an inspecting user.
        const markInteracted = () => {
            this.userInteracted = true;
        };
        for (const evt of ['mousedown', 'wheel', 'touchstart', 'dblclick'] as const) {
            container.addEventListener(evt, markInteracted, { capture: true, passive: true });
        }

        const scale = new ScaleControl({ maxWidth: 90, unit: 'metric' });
        map.addControl(scale, 'bottom-left');
        this.scaleControl = scale;

        this.map = map;
        this.container = container;
        (globalThis as { __xroute_map?: MapLibreMap }).__xroute_map = map; // debug/testing hook

        // Persist viewport to localStorage on moveend (debounced)
        map.on('moveend', () => {
            if (this.saveViewportTimer) clearTimeout(this.saveViewportTimer);
            this.saveViewportTimer = setTimeout(() => {
                const c = map.getCenter();
                const z = map.getZoom();
                saveViewport([c.lng, c.lat], z);
            }, 300);
        });

        // Initial settlement kicks
        requestAnimationFrame(() => this.map?.resize());
        setTimeout(() => this.map?.resize(), 100);

        const lastLoc = getLastLocation();
        if (lastLoc) {
            this.setUserLocation(lastLoc);
        }

        return map;
    }

    destroy() {
        if (this.saveViewportTimer) {
            clearTimeout(this.saveViewportTimer);
            this.saveViewportTimer = null;
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
        saveLastLocation(coords);
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
        return this.userLocationCoords ?? getLastLocation();
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
        saveSavedBasemap(key);
        if (this.map) {
            this.map.setStyle(BASEMAPS[key].style as any);
            // Dynamic sources/layers are wiped by setStyle. Wait out the style
            // diff window first: right after setStyle, getSource()/getLayer()
            // still return the PREVIOUS style's objects, so an immediate re-add
            // would no-op against dead objects and vanish once the new style
            // settles. A short delay plus readiness retry is the robust combo.
            setTimeout(() => {
                this.onReady(() => {
                    this.styleReloadCallbacks.forEach((cb) => cb());
                });
            }, 500);
        }
    }

    /** Explicitly mark that the user has interacted with the map. */
    markInteracted() {
        this.userInteracted = true;
    }

    /** True once the user has panned/zoomed/clicked the map. Camera-affecting
     *  auto-behaviors (hydration fit, import fit) must respect their viewport. */
    hasUserInteracted(): boolean {
        return this.userInteracted;
    }

    fitBounds(bounds: LngLatBoundsLike, padding = 60, instant = false) {
        if (!this.map) return;
        this.map.fitBounds(bounds, { padding, duration: instant ? 0 : 600, maxZoom: 16 });
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
