import {
    AttributionControl,
    type AttributionControlOptions,
    Map as MapLibreMap,
    Marker,
    ScaleControl,
    setWorkerUrl,
    type LngLatBoundsLike,
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

export type BasemapKey = 'bright' | 'liberty' | 'positron' | 'dark';

export const BASEMAPS: Record<BasemapKey, { label: string; style: string }> = {
    bright: { label: 'Bright', style: 'https://tiles.openfreemap.org/styles/bright' },
    liberty: { label: 'Liberty', style: 'https://tiles.openfreemap.org/styles/liberty' },
    positron: { label: 'Positron', style: 'https://tiles.openfreemap.org/styles/positron' },
    dark: { label: 'Dark', style: 'https://tiles.openfreemap.org/styles/dark' },
};

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

/**
 * SmoothScrollZoomController
 * Replaces MapLibre's built-in ScrollZoomHandler with an ultra-smooth,
 * bounded, explosion-proof zoom controller modeled after Strava and Google Maps.
 *
 * 1. Delta Normalization: Handles mouse wheel notches, trackpad smooth scroll, and pinch-to-zoom consistently.
 * 2. Explosion Horizon Shield: At any millisecond, targetZoom is mathematically bounded within
 *    [currentZoom - 1.15, currentZoom + 1.15], preventing runaway exponential magnification even with
 *    high-frequency free-spinning wheels or chaotic trackpad bursts.
 * 3. Drag Suppression: If any mouse button is currently held down (user is actively drag-panning,
 *    dragging a route polyline, or moving an anchor marker), wheel zoom is completely suppressed to
 *    prevent accidental zoom scale changes from finger brush / jitter.
 * 4. Pinned Pivot Easing: Smoothly eases camera around the exact geographic coordinates under the cursor
 *    using MapLibre's native easeTo({ zoom, around, duration: 140 }).
 */
class SmoothScrollZoomController {
    private map: MapLibreMap;
    private container: HTMLElement;
    private targetZoom: number | null = null;
    private activeAround: { lng: number; lat: number } | null = null;
    private lastWheelTime = 0;
    private lastScreenX = 0;
    private lastScreenY = 0;
    private wheelHandler: ((e: WheelEvent) => void) | null = null;

    constructor(map: MapLibreMap, container: HTMLElement) {
        this.map = map;
        this.container = container;
        this.attach();
    }

    private attach() {
        this.wheelHandler = (e: WheelEvent) => {
            // 1. If any mouse button is pressed down (e.g. user is dragging the map,
            // dragging a route polyline, or moving an anchor marker), suppress wheel zoom completely!
            // This eliminates accidental zoom scale distortion when fingers slip on the wheel/trackpad during drag.
            if (e.buttons !== 0) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            mapManager.markInteracted();

            const rect = this.container.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            const now = performance.now();
            const timeSinceLast = now - this.lastWheelTime;
            this.lastWheelTime = now;

            const curZoom = this.map.getZoom();

            // If this is a new gesture sequence (> 140ms gap) or target has settled, reset pivot to current cursor
            if (timeSinceLast > 140 || this.targetZoom === null || Math.abs(curZoom - this.targetZoom) < 0.01) {
                this.targetZoom = curZoom;
                try {
                    const unprojected = this.map.unproject([screenX, screenY]);
                    this.activeAround = { lng: unprojected.lng, lat: unprojected.lat };
                } catch {
                    this.activeAround = null;
                }
                this.lastScreenX = screenX;
                this.lastScreenY = screenY;
            } else {
                // If cursor has moved significantly (> 16px) during continuous scrolling, update the pivot
                if (Math.hypot(screenX - this.lastScreenX, screenY - this.lastScreenY) > 16) {
                    try {
                        const unprojected = this.map.unproject([screenX, screenY]);
                        this.activeAround = { lng: unprojected.lng, lat: unprojected.lat };
                    } catch {}
                    this.lastScreenX = screenX;
                    this.lastScreenY = screenY;
                }
            }

            // Normalize deltaY across browsers and input modes
            let dy = e.deltaY;
            if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
                dy *= 20; // Firefox line delta
            } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
                dy *= 200;
            }

            // Device & gesture detection
            let deltaZ = 0;
            const isPinch = e.ctrlKey;
            const isDiscreteNotch =
                !isPinch &&
                Math.abs(dy) >= 40 &&
                (e.deltaMode !== 0 || Math.abs(dy) % 40 === 0 || Math.abs(dy) >= 100);

            if (isDiscreteNotch) {
                // Mechanical mouse wheel: crisp, comfortable, predictable step (~0.25 zoom levels per notch)
                const direction = dy < 0 ? 1 : -1;
                const notchCount = Math.max(1, Math.min(3, Math.round(Math.abs(dy) / 100)));
                deltaZ = direction * 0.25 * notchCount;
            } else if (isPinch) {
                // Trackpad pinch-to-zoom (macOS ctrlKey + wheel)
                deltaZ = -dy * 0.008;
                deltaZ = Math.max(-0.25, Math.min(0.25, deltaZ));
            } else {
                // Continuous high-frequency trackpad scrolling
                deltaZ = -dy * 0.0022;
                deltaZ = Math.max(-0.18, Math.min(0.18, deltaZ));
            }

            if (deltaZ === 0) return;

            // Update target zoom with Explosion Horizon Clamp
            let nextTarget = (this.targetZoom ?? curZoom) + deltaZ;

            // EXPLOSION SHIELD:
            // Bound the maximum leading horizon ahead of curZoom to ±1.15 zoom levels.
            // Even under an avalanche of events from a free-spinning wheel,
            // the zoom can never run away into deep space or microscopic zoom!
            const MAX_HORIZON = 1.15;
            nextTarget = Math.max(curZoom - MAX_HORIZON, Math.min(curZoom + MAX_HORIZON, nextTarget));

            // Clamp to map zoom bounds
            const minZ = this.map.getMinZoom();
            const maxZ = this.map.getMaxZoom();
            nextTarget = Math.max(minZ, Math.min(maxZ, nextTarget));

            this.targetZoom = nextTarget;

            // Smooth ease towards target around the pinned cursor coordinate
            const easeOptions: any = {
                zoom: nextTarget,
                duration: 140,
                easing: (t: number) => t * (2 - t), // smooth quadratic ease-out
            };

            if (this.activeAround) {
                easeOptions.around = [this.activeAround.lng, this.activeAround.lat];
            }

            this.map.easeTo(easeOptions);
        };

        this.container.addEventListener('wheel', this.wheelHandler, { passive: false, capture: true });
    }

    destroy() {
        if (this.wheelHandler) {
            this.container.removeEventListener('wheel', this.wheelHandler, { capture: true });
            this.wheelHandler = null;
        }
        this.targetZoom = null;
        this.activeAround = null;
    }
}

class MapManager {
    private map: MapLibreMap | null = null;
    private container: HTMLElement | null = null;
    private basemap: BasemapKey = 'bright';
    private cursorMarker: Marker | null = null;
    private userLocationMarker: Marker | null = null;
    private userLocationCoords: { lon: number; lat: number } | null = null;
    private scaleControl: ScaleControl | null = null;
    private styleReloadCallbacks = new Set<() => void>();
    private userInteracted = false;
    private saveViewportTimer: ReturnType<typeof setTimeout> | null = null;
    private scrollZoomController: SmoothScrollZoomController | null = null;

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

        // Completely disable MapLibre's built-in ScrollZoomHandler
        // to eliminate hardcoded maxScalePerFrame = 2 compounding zoom runaway!
        map.scrollZoom.disable();

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

        // Attach our custom Strava-grade SmoothScrollZoomController
        this.scrollZoomController = new SmoothScrollZoomController(map, container);

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
        this.scrollZoomController?.destroy();
        this.scrollZoomController = null;
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
