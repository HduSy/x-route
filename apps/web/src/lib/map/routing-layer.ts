import { Marker, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { mapManager } from './MapManager';
import type { RoutingAnchor, UnitType } from '@/store/routing-slice';
import { TrackPoint, distance } from '@x-route/gpx';
import { getClosestLinePoint } from '@/lib/utils';

// Strava Route Builder imperative routing layer:
// - Strava signature energetic orange route polyline with casing
// - Crisp numbered/styled start, via, and finish markers
// - Interactive ghost marker for mid-segment insertion
// - Distance milestone badges (1km, 2km, ...) along the route

const SOURCE_ID = 'x-route-routing';
const LINE_CASING_LAYER_ID = 'x-route-routing-casing';
const LINE_LAYER_ID = 'x-route-routing-line';
const LINE_HIT_AREA_LAYER_ID = 'x-route-routing-hit-area';

const MILESTONE_SIZE = 18;

function anchorElement(kind: 'start' | 'end' | 'via', _index: number, _total: number): HTMLElement {
    // Outer container: MapLibre manages transform: translate(...) here. NEVER modify el.style.transform directly!
    const el = document.createElement('div');
    el.className = `x-route-anchor-marker x-route-anchor-${kind}`;
    const size = kind === 'via' ? 12 : MILESTONE_SIZE;
    el.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        user-select: none;
        box-sizing: border-box;
    `;

    const dot = document.createElement('div');
    dot.className = 'x-route-anchor-dot';

    if (kind === 'start') {
        // Strava signature green starting node (matching kilometer circle diameter)
        dot.style.cssText = `
            width: ${MILESTONE_SIZE}px;
            height: ${MILESTONE_SIZE}px;
            border-radius: 9999px;
            background-color: #00B548;
            border: 2px solid #ffffff;
            box-shadow: 0 2px 5px rgba(0,0,0,0.35);
            transition: transform 0.15s ease;
            box-sizing: border-box;
        `;
    } else if (kind === 'end') {
        // Strava signature checkered finish line flag node 🏁 (matching kilometer circle diameter)
        dot.style.cssText = `
            width: ${MILESTONE_SIZE}px;
            height: ${MILESTONE_SIZE}px;
            border-radius: 9999px;
            background: repeating-conic-gradient(#18181b 0% 25%, #ffffff 0% 50%) 50% / 5px 5px;
            border: 2px solid #ffffff;
            box-shadow: 0 2px 5px rgba(0,0,0,0.45);
            transition: transform 0.15s ease;
            box-sizing: border-box;
        `;
    } else {
        // Intermediate waypoint node
        dot.style.cssText = `
            width: 12px;
            height: 12px;
            border-radius: 9999px;
            background-color: #ffffff;
            border: 2.5px solid #863bff;
            box-shadow: 0 1px 4px rgba(0,0,0,0.35);
            transition: transform 0.15s ease;
            box-sizing: border-box;
        `;
    }

    el.appendChild(dot);

    el.addEventListener('mousedown', () => {
        el.style.cursor = 'grabbing';
    });
    el.addEventListener('mouseup', () => {
        el.style.cursor = 'grab';
    });

    return el;
}

function ghostAnchorElement(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'x-route-ghost-marker';
    el.style.cssText = `
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        user-select: none;
        box-sizing: border-box;
    `;
    const dot = document.createElement('div');
    dot.className = 'x-route-ghost-dot';
    dot.style.cssText = `
        width: 14px;
        height: 14px;
        border-radius: 9999px;
        background-color: #863BFF;
        border: 2.5px solid #ffffff;
        box-shadow: 0 2px 8px rgba(134, 59, 255, 0.65), 0 1px 3px rgba(0,0,0,0.3);
        box-sizing: border-box;
    `;
    el.appendChild(dot);
    return el;
}

const MILESTONES_SOURCE_ID = 'x-route-milestones';
const MILESTONES_LAYER_ID = 'x-route-milestones-symbol';
const BADGE_IMAGE_ID = 'x-route-milestone-badge';
const BADGE_IMAGE_WIDE_ID = 'x-route-milestone-badge-wide';

const RUBBER_BAND_SOURCE_ID = 'x-route-rubber-band';
const RUBBER_BAND_LAYER_ID = 'x-route-rubber-band-line';

function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function ensureBadgeImages(map: MapLibreMap) {
    // 1. Standard circular milestone badge (for 1-99)
    if (!map.hasImage(BADGE_IMAGE_ID)) {
        const size = 48; // 24px CSS diameter @ 2x pixelRatio
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, size, size);
            const center = size / 2;
            const radius = 17;

            // Soft drop shadow
            ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetY = 1.5;

            // White disc fill
            ctx.beginPath();
            ctx.arc(center, center, radius, 0, 2 * Math.PI);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();

            // Crisp purple border
            ctx.shadowColor = 'transparent';
            ctx.lineWidth = 3.5;
            ctx.strokeStyle = '#863BFF';
            ctx.stroke();

            const imageData = ctx.getImageData(0, 0, size, size);
            map.addImage(BADGE_IMAGE_ID, imageData, { pixelRatio: 2 });
        }
    }

    // 2. Wide pill milestone badge (for 100+)
    if (!map.hasImage(BADGE_IMAGE_WIDE_ID)) {
        const width = 60; // 30px CSS width @ 2x pixelRatio
        const height = 48; // 24px CSS height @ 2x pixelRatio
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, width, height);

            // Soft drop shadow
            ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetY = 1.5;

            // Pill fill
            const x = 6;
            const y = 7;
            const w = width - 12;
            const h = 34;
            const r = 17;

            drawRoundedRect(ctx, x, y, w, h, r);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();

            // Crisp purple border
            ctx.shadowColor = 'transparent';
            ctx.lineWidth = 3.5;
            ctx.strokeStyle = '#863BFF';
            ctx.stroke();

            const imageData = ctx.getImageData(0, 0, width, height);
            map.addImage(BADGE_IMAGE_WIDE_ID, imageData, { pixelRatio: 2 });
        }
    }
}

function getPreferredFontStack(map: MapLibreMap): string[] {
    const style = map.getStyle();
    if (style && style.layers) {
        for (const layer of style.layers) {
            if (layer.type === 'symbol' && layer.layout && 'text-font' in layer.layout) {
                const font = (layer.layout as any)['text-font'];
                if (Array.isArray(font) && font.length > 0 && typeof font[0] === 'string') {
                    const boldFont = font.find((f: string) => f.includes('Bold'));
                    if (boldFont) return [boldFont];
                    return font;
                }
            }
        }
    }
    return ['Noto Sans Bold', 'Noto Sans Regular'];
}

function findInsertIndex(
    points: TrackPoint[],
    anchors: RoutingAnchor[],
    pointIndex: number
): number {
    if (anchors.length <= 1) return anchors.length;
    if (anchors.length === 2) return 1;
    if (points.length < 2) return anchors.length;

    // Map each anchor 0..m-1 to an index in points.
    // Anchor 0 is always at index 0, and Anchor m-1 is always at points.length - 1.
    // Intermediate anchors are matched monotonically along the path.
    const anchorPointIndices: number[] = [0];
    let searchStart = 0;
    for (let a = 1; a < anchors.length - 1; a++) {
        const anchor = anchors[a]!;
        let bestIdx = searchStart;
        let bestDist = Number.MAX_VALUE;
        for (let i = searchStart; i < points.length; i++) {
            const pt = points[i]!;
            const d = distance(
                { lat: pt.attributes.lat, lon: pt.attributes.lon },
                anchor
            );
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        anchorPointIndices.push(bestIdx);
        searchStart = bestIdx;
    }
    anchorPointIndices.push(points.length - 1);

    // Find the segment [k, k+1] that contains pointIndex
    for (let k = 0; k < anchorPointIndices.length - 1; k++) {
        const endIdx = anchorPointIndices[k + 1]!;
        if (pointIndex <= endIdx) {
            return k + 1;
        }
    }

    return Math.max(1, anchors.length - 1);
}

export class RoutingLayerController {
    private markers: Marker[] = [];
    private ghostMarker: Marker | null = null;
    private isHoveringLine = false;
    private isDraggingLine = false;
    private dragInsertIndex = 1;
    private containerPointerDownHandler: ((e: MouseEvent | PointerEvent) => void) | null = null;
    private containerMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
    private containerMouseLeaveHandler: (() => void) | null = null;
    /** Set to true for one tick after a drag ends, to suppress the click that fires on mouseup. */
    private justFinishedGhostDrag = false;
    private currentAnchors: RoutingAnchor[] = [];
    private currentPoints: TrackPoint[] = [];

    // Display options
    private showDistanceMarkers = true;
    private showRoutePath = true;
    private units: UnitType = 'km';
    private isDrawMode = false;

    private clickHandler:
        | ((e: { lngLat: { lng: number; lat: number } }) => void)
        | null = null;

    /** Flag to temporarily suppress map click (e.g. during space-bar pan mode or right after marker drag) */
    suppressClick = false;

    /** Set by the React layer. */
    onMapClick: ((lngLat: { lon: number; lat: number }) => void) | null = null;
    onInsertAnchor: ((index: number, lngLat: { lon: number; lat: number }) => void) | null = null;
    onMarkerDrag: ((index: number, lngLat: { lon: number; lat: number }) => void) | null = null;
    onMarkerRightClick: ((index: number) => void) | null = null;

    private wiredMap: MapLibreMap | null = null;

    /**
     * Synchronously tests if (screenX, screenY) in canvas pixel space is on the route line.
     * Returns the closest line point and insert index, or null if outside hit threshold or near an anchor.
     */
    private getLineHit(
        screenX: number,
        screenY: number,
        map: MapLibreMap
    ): { closestLngLat: { lng: number; lat: number }; insertIndex: number } | null {
        if (this.currentPoints.length < 2) return null;

        // 1. Avoid triggering line hit when the cursor is near any existing anchor marker (radius 22px)
        for (const anchor of this.currentAnchors) {
            const ap = map.project([anchor.lon, anchor.lat]);
            if (Math.hypot(ap.x - screenX, ap.y - screenY) < 22) {
                return null;
            }
        }

        const HIT_RADIUS = 18; // pixels for comfortable, responsive snapping

        // 2. Fast GPU-backed layer check if layers exist to avoid expensive projection loops on large polylines
        try {
            if (map.getLayer(LINE_HIT_AREA_LAYER_ID) || map.getLayer(LINE_LAYER_ID)) {
                const queryLayers: string[] = [];
                if (map.getLayer(LINE_HIT_AREA_LAYER_ID)) queryLayers.push(LINE_HIT_AREA_LAYER_ID);
                if (map.getLayer(LINE_LAYER_ID)) queryLayers.push(LINE_LAYER_ID);

                const bbox: [[number, number], [number, number]] = [
                    [screenX - HIT_RADIUS, screenY - HIT_RADIUS],
                    [screenX + HIT_RADIUS, screenY + HIT_RADIUS],
                ];
                const hits = map.queryRenderedFeatures(bbox, { layers: queryLayers });
                if (hits.length === 0) {
                    return null;
                }
            }
        } catch {
            // Fallback to geometric check if queryRenderedFeatures encounters any transient style issue
        }

        // 3. Iterate segments with screen-space bounding box to find the exact closest coordinate & insertIndex
        let bestDistSq = Infinity;
        let bestSegmentIndex = 0;
        let bestT = 0;
        const HIT_RADIUS_SQ = HIT_RADIUS * HIT_RADIUS;

        const pts = this.currentPoints;
        let prevScreenPt = map.project([pts[0]!.attributes.lon, pts[0]!.attributes.lat]);

        for (let i = 0; i < pts.length - 1; i++) {
            const nextPt = pts[i + 1]!;
            const nextScreenPt = map.project([nextPt.attributes.lon, nextPt.attributes.lat]);

            const s1 = prevScreenPt;
            const s2 = nextScreenPt;
            prevScreenPt = nextScreenPt;

            // Quick AABB reject per segment with margin
            const minX = Math.min(s1.x, s2.x) - HIT_RADIUS;
            const maxX = Math.max(s1.x, s2.x) + HIT_RADIUS;
            const minY = Math.min(s1.y, s2.y) - HIT_RADIUS;
            const maxY = Math.max(s1.y, s2.y) + HIT_RADIUS;
            if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY) {
                continue;
            }

            const dx = s2.x - s1.x;
            const dy = s2.y - s1.y;
            const lenSq = dx * dx + dy * dy;

            let t = 0;
            let distSq = 0;
            if (lenSq === 0) {
                distSq = (screenX - s1.x) * (screenX - s1.x) + (screenY - s1.y) * (screenY - s1.y);
            } else {
                t = Math.max(0, Math.min(1, ((screenX - s1.x) * dx + (screenY - s1.y) * dy) / lenSq));
                const projX = s1.x + t * dx;
                const projY = s1.y + t * dy;
                distSq = (screenX - projX) * (screenX - projX) + (screenY - projY) * (screenY - projY);
            }

            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestSegmentIndex = i;
                bestT = t;
            }
        }

        if (bestDistSq > HIT_RADIUS_SQ) {
            return null;
        }

        const p1 = pts[bestSegmentIndex]!;
        const p2 = pts[bestSegmentIndex + 1]!;
        const interpLon = p1.attributes.lon + bestT * (p2.attributes.lon - p1.attributes.lon);
        const interpLat = p1.attributes.lat + bestT * (p2.attributes.lat - p1.attributes.lat);

        const insertIndex = findInsertIndex(
            this.currentPoints,
            this.currentAnchors,
            bestSegmentIndex
        );

        return {
            closestLngLat: { lng: interpLon, lat: interpLat },
            insertIndex,
        };
    }

    wire(map: MapLibreMap) {
        if (this.wiredMap === map) return;
        if (this.wiredMap) {
            this.unwire();
        }
        this.wiredMap = map;

        this.clickHandler = (e) => {
            if (!this.onMapClick || this.suppressClick) return;
            // Suppress the click that MapLibre fires right after a drag ends
            if (this.justFinishedGhostDrag) {
                this.justFinishedGhostDrag = false;
                return;
            }
            this.onMapClick({ lon: e.lngLat.lng, lat: e.lngLat.lat });
        };
        map.on('click', this.clickHandler);

        const container = map.getCanvasContainer();

        this.containerMouseMoveHandler = (e: MouseEvent) => {
            if (this.isDraggingLine) return;
            if (map.isMoving() || map.isZooming()) return;
            if (this.currentPoints.length < 2) return;

            const rect = map.getCanvas().getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            const hit = this.getLineHit(screenX, screenY, map);
            if (hit) {
                this.isHoveringLine = true;
                this.ensureGhostMarker(map, hit.closestLngLat);
                if (this.ghostMarker) {
                    this.showGhostTooltip(this.ghostMarker, 'hover');
                }
                map.getCanvas().style.cursor = 'grab';
            } else if (this.isHoveringLine) {
                this.isHoveringLine = false;
                this.removeGhostMarker();
                map.getCanvas().style.cursor = '';
            }
        };

        this.containerMouseLeaveHandler = () => {
            if (this.isDraggingLine) return;
            this.isHoveringLine = false;
            this.removeGhostMarker();
            map.getCanvas().style.cursor = '';
        };

        // Strava-grade Route Dragging & Direct Line Click:
        // Captures pointerdown AND mousedown on the map container when clicking on the route line.
        // Synchronously stops propagation and disables map dragPan BEFORE MapLibre can initiate a map pan!
        this.containerPointerDownHandler = (e: MouseEvent | PointerEvent) => {
            if (e.button !== 0) return;
            if (this.isDraggingLine) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                return;
            }
            if (this.currentPoints.length < 2) return;

            const canvas = map.getCanvas();
            const rect = canvas.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            const hit = this.getLineHit(screenX, screenY, map);
            if (!hit) return;

            // Stop propagation and prevent default IMMEDIATELY in capture phase: MapLibre will NEVER see this down event!
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();

            mapManager.markInteracted();

            // Freeze map panning completely - 100% immune to map drift
            map.dragPan.disable();

            this.isDraggingLine = true;
            this.suppressClick = true;
            this.dragInsertIndex = hit.insertIndex;
            map.getCanvas().style.cursor = 'grabbing';

            const startClientX = e.clientX;
            const startClientY = e.clientY;

            const getRubberBandCoords = (lngLat: { lng: number; lat: number }) => {
                const coords: [number, number][] = [];
                const idx = this.dragInsertIndex;
                if (idx > 0 && this.currentAnchors[idx - 1]) {
                    const prev = this.currentAnchors[idx - 1]!;
                    coords.push([prev.lon, prev.lat]);
                }
                coords.push([lngLat.lng, lngLat.lat]);
                if (idx < this.currentAnchors.length && this.currentAnchors[idx]) {
                    const next = this.currentAnchors[idx]!;
                    coords.push([next.lon, next.lat]);
                }
                return coords;
            };

            const removeAllListeners = () => {
                window.removeEventListener('pointermove', onWindowMove, { capture: true });
                window.removeEventListener('mousemove', onWindowMove, { capture: true });
                window.removeEventListener('pointerup', onWindowUp, { capture: true });
                window.removeEventListener('mouseup', onWindowUp, { capture: true });
                window.removeEventListener('keydown', onKeyDown, { capture: true });
                window.removeEventListener('blur', onBlur);
            };

            const cleanupState = () => {
                try {
                    map.dragPan.enable();
                } catch {}
                map.getCanvas().style.cursor = '';
                this.isDraggingLine = false;
                this.isHoveringLine = false;
                this.clearRubberBand();
                if (this.ghostMarker) {
                    this.hideDragTooltip(this.ghostMarker);
                }
                this.removeGhostMarker();
                setTimeout(() => {
                    this.suppressClick = false;
                    this.justFinishedGhostDrag = false;
                }, 250);
            };

            const onWindowMove = (we: MouseEvent | PointerEvent) => {
                if (!this.isDraggingLine) return;
                we.stopPropagation();
                we.stopImmediatePropagation();
                we.preventDefault();
                const curRect = canvas.getBoundingClientRect();
                const curLngLat = map.unproject([we.clientX - curRect.left, we.clientY - curRect.top]);
                this.ghostMarker?.setLngLat([curLngLat.lng, curLngLat.lat]);
                if (this.ghostMarker) {
                    this.showGhostTooltip(this.ghostMarker, 'drag');
                }
                this.setRubberBand(getRubberBandCoords(curLngLat));
            };

            const onWindowUp = (we: MouseEvent | PointerEvent) => {
                removeAllListeners();

                if (!this.isDraggingLine) return;
                we.stopPropagation();
                we.stopImmediatePropagation();
                we.preventDefault();

                const curRect = canvas.getBoundingClientRect();
                const finalLngLat = map.unproject([we.clientX - curRect.left, we.clientY - curRect.top]);

                // Calculate move distance in pixels
                const moveDist = Math.hypot(we.clientX - startClientX, we.clientY - startClientY);
                this.justFinishedGhostDrag = true;

                if (moveDist >= 6) {
                    // Dragged to a new location on the map: insert custom waypoint at released map location
                    this.onInsertAnchor?.(this.dragInsertIndex, { lon: finalLngLat.lng, lat: finalLngLat.lat });
                } else {
                    // Direct click/selection on route line: insert waypoint right at clicked line position
                    this.onInsertAnchor?.(this.dragInsertIndex, { lon: hit.closestLngLat.lng, lat: hit.closestLngLat.lat });
                }

                cleanupState();
            };

            const onKeyDown = (ke: KeyboardEvent) => {
                if (ke.key === 'Escape') {
                    removeAllListeners();
                    cleanupState();
                }
            };

            const onBlur = () => {
                removeAllListeners();
                cleanupState();
            };

            try {
                this.ensureGhostMarker(map, hit.closestLngLat);
                if (this.ghostMarker) {
                    this.showGhostTooltip(this.ghostMarker, 'hover');
                }
                this.setRubberBand(getRubberBandCoords(hit.closestLngLat));

                window.addEventListener('pointermove', onWindowMove, { capture: true });
                window.addEventListener('mousemove', onWindowMove, { capture: true });
                window.addEventListener('pointerup', onWindowUp, { capture: true });
                window.addEventListener('mouseup', onWindowUp, { capture: true });
                window.addEventListener('keydown', onKeyDown, { capture: true });
                window.addEventListener('blur', onBlur);
            } catch (err) {
                console.error('[RoutingLayer] Error during drag initiation:', err);
                removeAllListeners();
                cleanupState();
            }
        };

        container.addEventListener('pointerdown', this.containerPointerDownHandler, { capture: true });
        container.addEventListener('mousedown', this.containerPointerDownHandler, { capture: true });
        container.addEventListener('mousemove', this.containerMouseMoveHandler);
        container.addEventListener('mouseleave', this.containerMouseLeaveHandler);
    }

    unwire() {
        if (this.wiredMap) {
            this.wiredMap.dragPan.enable();
            const container = this.wiredMap.getCanvasContainer();
            if (this.containerPointerDownHandler) {
                container.removeEventListener('pointerdown', this.containerPointerDownHandler, { capture: true });
                container.removeEventListener('mousedown', this.containerPointerDownHandler, { capture: true });
                this.containerPointerDownHandler = null;
            }
            if (this.containerMouseMoveHandler) {
                container.removeEventListener('mousemove', this.containerMouseMoveHandler);
                this.containerMouseMoveHandler = null;
            }
            if (this.containerMouseLeaveHandler) {
                container.removeEventListener('mouseleave', this.containerMouseLeaveHandler);
                this.containerMouseLeaveHandler = null;
            }
            if (this.clickHandler) {
                this.wiredMap.off('click', this.clickHandler);
            }
        }
        this.clearRubberBand();
        this.removeGhostMarker();
        this.isDraggingLine = false;
        this.isHoveringLine = false;
        this.clickHandler = null;
        this.wiredMap = null;
    }

    private removeGhostMarker() {
        if (this.ghostMarker) {
            try {
                this.ghostMarker.remove();
            } catch (err) {
                console.error('[RoutingLayer] Error removing ghost marker:', err);
            }
            this.ghostMarker = null;
        }
    }

    private showDragTooltip(marker: Marker, index: number, total: number) {
        const el = marker.getElement();
        let label = '📌 调整途经点';
        if (index === 0) label = '📍 调整起点';
        else if (index === total - 1) label = '🏁 调整终点';

        const tip = document.createElement('div');
        tip.className = 'x-route-drag-tip';
        tip.style.cssText = `
            position: absolute;
            bottom: calc(100% + 8px);
            left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 23, 42, 0.92);
            color: #fff;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 500;
            white-space: nowrap;
            pointer-events: none;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
            z-index: 100;
            backdrop-filter: blur(4px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            animation: x-route-tip-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
        `;
        tip.textContent = label;
        el.appendChild(tip);
    }

    private showGhostTooltip(marker: Marker, mode: 'hover' | 'drag' = 'hover') {
        const el = marker.getElement();
        this.hideDragTooltip(marker);
        const tip = document.createElement('div');
        tip.className = 'x-route-drag-tip';
        tip.style.cssText = `
            position: absolute;
            bottom: calc(100% + 8px);
            left: 50%;
            transform: translateX(-50%);
            background: ${mode === 'drag' ? 'rgba(37, 99, 235, 0.95)' : 'rgba(15, 23, 42, 0.92)'};
            color: #fff;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            pointer-events: none;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
            z-index: 100;
            backdrop-filter: blur(4px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            animation: x-route-tip-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
        `;
        tip.textContent = mode === 'drag' ? '🎯 释放以新增途经点' : '📍 点击或拖拽以调整路线';
        el.appendChild(tip);
    }

    private hideDragTooltip(marker?: Marker | null) {
        if (marker) {
            const el = marker.getElement();
            const tip = el.querySelector('.x-route-drag-tip');
            tip?.remove();
        }
        document.querySelectorAll('.x-route-drag-tip').forEach((t) => t.remove());
    }

    private setRubberBand(coords: [number, number][]) {
        const map = mapManager.getMap();
        if (!map) return;
        const source = map.getSource(RUBBER_BAND_SOURCE_ID) as GeoJSONSource | undefined;
        if (!source) return;
        if (coords.length < 2) {
            source.setData({ type: 'FeatureCollection', features: [] });
            return;
        }
        source.setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: coords,
                    },
                },
            ],
        });
    }

    private clearRubberBand() {
        this.setRubberBand([]);
    }

    private ensureGhostMarker(map: MapLibreMap, lngLat: { lng: number; lat: number }) {
        if (!Number.isFinite(lngLat.lng) || !Number.isFinite(lngLat.lat)) return;
        if (this.ghostMarker) {
            this.ghostMarker.setLngLat([lngLat.lng, lngLat.lat]);
            return;
        }
        const el = ghostAnchorElement();
        const marker = new Marker({
            element: el,
            draggable: false, // Purely visual projection node; drag is managed directly on canvas/window!
            anchor: 'center',
            subpixelPositioning: true,
        });
        // CRITICAL: MUST setLngLat BEFORE addTo(map), because addTo(map) synchronously
        // executes _update() which immediately accesses marker._lngLat.lng!
        // Calling addTo without lngLat throws TypeError and breaks all map rendering and animation frames!
        marker.setLngLat([lngLat.lng, lngLat.lat]);
        marker.addTo(map);
        this.ghostMarker = marker;
    }

    sync(anchors: RoutingAnchor[]) {
        this.currentAnchors = anchors;
        mapManager.onReady((map) => {
            this.wire(map);
            this.syncMarkers(map, anchors);
            this.ensureLayers(map);
        });
    }

    private syncMarkers(map: MapLibreMap, anchors: RoutingAnchor[]) {
        for (const marker of this.markers) marker.remove();
        this.markers = anchors.map((anchor, index) =>
            this.createMarker(map, anchor, index, anchors.length)
        );
        // Note: alignMarkersToRoute() is called in setResult() after route geometry has arrived
    }

    private alignMarkersToRoute() {
        if (this.currentPoints.length < 2 || this.markers.length === 0) return;
        const firstPt = this.currentPoints[0]!;
        const lastPt = this.currentPoints[this.currentPoints.length - 1]!;

        // Snap start marker directly to the route line's starting endpoint
        this.markers[0]?.setLngLat([firstPt.attributes.lon, firstPt.attributes.lat]);

        // Snap end marker directly to the route line's ending endpoint
        if (this.markers.length > 1) {
            this.markers[this.markers.length - 1]?.setLngLat([
                lastPt.attributes.lon,
                lastPt.attributes.lat,
            ]);
        }

        // For intermediate waypoints, snap to the closest route coordinate
        if (this.markers.length > 2) {
            for (let i = 1; i < this.markers.length - 1; i++) {
                const anchor = this.currentAnchors[i];
                if (!anchor) continue;
                const closest = getClosestLinePoint(this.currentPoints, anchor);
                if (closest) {
                    this.markers[i]?.setLngLat([
                        closest.attributes.lon,
                        closest.attributes.lat,
                    ]);
                }
            }
        }
    }

    private createMarker(
        map: MapLibreMap,
        anchor: RoutingAnchor,
        index: number,
        total: number
    ): Marker {
        const kind = index === 0 ? 'start' : index === total - 1 ? 'end' : 'via';
        const el = anchorElement(kind, index, total);
        const marker = new Marker({
            element: el,
            draggable: true,
            anchor: 'center',
            subpixelPositioning: true,
        })
            .setLngLat([anchor.lon, anchor.lat])
            .addTo(map);

        el.addEventListener('pointerdown', () => {
            el.style.cursor = 'grabbing';
        });

        el.addEventListener('mousedown', () => {
            el.style.cursor = 'grabbing';
        });

        el.addEventListener('mouseup', () => {
            el.style.cursor = 'grab';
            // Safety: guarantee map panning is never stuck disabled if a click did not start a drag
            map.dragPan.enable();
            this.suppressClick = false;
        });

        marker.on('dragstart', () => {
            mapManager.markInteracted();
            map.dragPan.disable();
            this.suppressClick = true;
            this.showDragTooltip(marker, index, total);
        });

        marker.on('drag', () => {
            const lngLat = marker.getLngLat();
            const coords: [number, number][] = [];
            if (index > 0 && this.currentAnchors[index - 1]) {
                const prev = this.currentAnchors[index - 1]!;
                coords.push([prev.lon, prev.lat]);
            }
            coords.push([lngLat.lng, lngLat.lat]);
            if (index < this.currentAnchors.length - 1 && this.currentAnchors[index + 1]) {
                const next = this.currentAnchors[index + 1]!;
                coords.push([next.lon, next.lat]);
            }
            this.setRubberBand(coords);
        });

        marker.on('dragend', () => {
            mapManager.markInteracted();
            map.dragPan.enable();
            el.style.cursor = 'grab';
            this.hideDragTooltip(marker);
            this.clearRubberBand();
            const lngLat = marker.getLngLat();
            this.onMarkerDrag?.(index, { lon: lngLat.lng, lat: lngLat.lat });
            setTimeout(() => {
                this.suppressClick = false;
            }, 250);
        });

        el.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.onMarkerRightClick?.(index);
        });

        return marker;
    }

    private ensureLayers(map: MapLibreMap) {
        if (!map.isStyleLoaded()) {
            map.once('styledata', () => this.ensureLayers(map));
            return;
        }

        ensureBadgeImages(map);

        if (!map.getSource(SOURCE_ID)) {
            map.addSource(SOURCE_ID, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
        }

        // Casing underlay for high contrast
        if (!map.getLayer(LINE_CASING_LAYER_ID)) {
            map.addLayer({
                id: LINE_CASING_LAYER_ID,
                type: 'line',
                source: SOURCE_ID,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#FFFFFF',
                    'line-width': 8,
                    'line-opacity': this.showRoutePath ? 0.9 : 0,
                },
            });
        }

        // Strava signature route polyline
        if (!map.getLayer(LINE_LAYER_ID)) {
            map.addLayer({
                id: LINE_LAYER_ID,
                type: 'line',
                source: SOURCE_ID,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#863BFF',
                    'line-width': 5,
                    'line-opacity': this.showRoutePath ? 0.95 : 0,
                },
            });
        }

        // Invisible wide hit-area layer for easy, butter-smooth hovering
        if (!map.getLayer(LINE_HIT_AREA_LAYER_ID)) {
            map.addLayer({
                id: LINE_HIT_AREA_LAYER_ID,
                type: 'line',
                source: SOURCE_ID,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#863BFF',
                    'line-width': 26,
                    'line-opacity': 0.0001,
                },
            });
        }

        // WebGL Distance Milestones (GeoJSON Vector Source + Symbol Layer with dynamic collision avoidance)
        if (!map.getSource(MILESTONES_SOURCE_ID)) {
            map.addSource(MILESTONES_SOURCE_ID, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
        }

        // Live rubber-band preview line during drag
        if (!map.getSource(RUBBER_BAND_SOURCE_ID)) {
            map.addSource(RUBBER_BAND_SOURCE_ID, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
        }

        if (!map.getLayer(RUBBER_BAND_LAYER_ID)) {
            map.addLayer({
                id: RUBBER_BAND_LAYER_ID,
                type: 'line',
                source: RUBBER_BAND_SOURCE_ID,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#863BFF',
                    'line-width': 3,
                    'line-dasharray': [3, 2],
                    'line-opacity': 0.85,
                },
            });
        }

        if (!map.getLayer(MILESTONES_LAYER_ID)) {
            const fontStack = getPreferredFontStack(map);
            map.addLayer({
                id: MILESTONES_LAYER_ID,
                type: 'symbol',
                source: MILESTONES_SOURCE_ID,
                filter: ['<=', ['get', 'minzoom'], ['zoom']],
                layout: {
                    'icon-image': [
                        'case',
                        ['>=', ['get', 'distance'], 100],
                        BADGE_IMAGE_WIDE_ID,
                        BADGE_IMAGE_ID,
                    ],
                    'icon-size': 1,
                    'icon-anchor': 'center',
                    'icon-pitch-alignment': 'viewport',
                    'icon-rotation-alignment': 'viewport',
                    'icon-allow-overlap': false,
                    'icon-ignore-placement': false,

                    'text-field': ['to-string', ['get', 'distance']],
                    'text-font': fontStack,
                    'text-size': [
                        'step',
                        ['get', 'distance'],
                        9.5,
                        10,
                        8.5,
                        100,
                        7.5,
                    ],
                    'text-anchor': 'center',
                    'text-justify': 'center',
                    'text-pitch-alignment': 'viewport',
                    'text-rotation-alignment': 'viewport',
                    'text-allow-overlap': false,
                    'text-ignore-placement': false,
                    'symbol-sort-key': ['get', 'sort_key'],
                    'visibility': this.showDistanceMarkers && this.showRoutePath ? 'visible' : 'none',
                },
                paint: {
                    'text-color': '#18181B',
                    'text-opacity': 1,
                    'icon-opacity': 1,
                },
            });
        }
    }

    setOptions(options: {
        showDistanceMarkers?: boolean;
        showRoutePath?: boolean;
        units?: UnitType;
        isDrawMode?: boolean;
    }) {
        if (options.isDrawMode !== undefined && this.isDrawMode !== options.isDrawMode) {
            this.isDrawMode = options.isDrawMode;
        }
        if (options.showDistanceMarkers !== undefined) {
            this.showDistanceMarkers = options.showDistanceMarkers;
        }
        if (options.showRoutePath !== undefined) {
            this.showRoutePath = options.showRoutePath;
            mapManager.onReady((map) => {
                if (map.getLayer(LINE_LAYER_ID)) {
                    map.setPaintProperty(LINE_LAYER_ID, 'line-opacity', this.showRoutePath ? 0.95 : 0);
                }
                if (map.getLayer(LINE_CASING_LAYER_ID)) {
                    map.setPaintProperty(LINE_CASING_LAYER_ID, 'line-opacity', this.showRoutePath ? 0.9 : 0);
                }
            });
        }
        if (options.units !== undefined) {
            this.units = options.units;
        }
        mapManager.onReady((map) => {
            if (map.getLayer(MILESTONES_LAYER_ID)) {
                map.setLayoutProperty(
                    MILESTONES_LAYER_ID,
                    'visibility',
                    this.showDistanceMarkers && this.showRoutePath ? 'visible' : 'none'
                );
            }
        });
        this.updateDistanceMarkers();
    }

    private updateDistanceMarkers() {
        const map = mapManager.getMap();
        if (!map) return;

        const source = map.getSource(MILESTONES_SOURCE_ID) as GeoJSONSource | undefined;
        if (!source) return;

        if (!this.showDistanceMarkers || this.currentPoints.length < 2) {
            source.setData({ type: 'FeatureCollection', features: [] });
            return;
        }

        const isImperial = this.units === 'mi';
        const unitFactorMeters = isImperial ? 1609.344 : 1000.0;

        const points = this.currentPoints;
        const accumulatedDistances: number[] = [0];
        let totalMeters = 0;

        for (let i = 1; i < points.length; i++) {
            const p1 = points[i - 1]!;
            const p2 = points[i]!;
            const segDist = distance(
                { lat: p1.attributes.lat, lon: p1.attributes.lon },
                { lat: p2.attributes.lat, lon: p2.attributes.lon }
            );
            totalMeters += segDist;
            accumulatedDistances.push(totalMeters);
        }

        const totalUnits = totalMeters / unitFactorMeters;
        let step = 1;
        if (totalUnits > 300) step = 10;
        else if (totalUnits > 150) step = 5;
        else if (totalUnits > 60) step = 2;
        else step = 1;

        const stepMeters = step * unitFactorMeters;
        const features: any[] = [];

        let currentMilestoneVal = step;
        let targetMeters = stepMeters;
        let segIndex = 1;

        const startPt = { lat: points[0]!.attributes.lat, lon: points[0]!.attributes.lon };
        const endPt = {
            lat: points[points.length - 1]!.attributes.lat,
            lon: points[points.length - 1]!.attributes.lon,
        };

        while (targetMeters <= totalMeters && segIndex < points.length) {
            while (segIndex < points.length && accumulatedDistances[segIndex]! < targetMeters) {
                segIndex++;
            }
            if (segIndex >= points.length) break;

            const segStartMeters = accumulatedDistances[segIndex - 1]!;
            const segEndMeters = accumulatedDistances[segIndex]!;
            const segLen = segEndMeters - segStartMeters;

            const p1 = points[segIndex - 1]!;
            const p2 = points[segIndex]!;

            let lon: number;
            let lat: number;

            if (segLen <= 0) {
                lon = p1.attributes.lon;
                lat = p1.attributes.lat;
            } else {
                const fraction = Math.max(0, Math.min(1, (targetMeters - segStartMeters) / segLen));
                lon = p1.attributes.lon + (p2.attributes.lon - p1.attributes.lon) * fraction;
                lat = p1.attributes.lat + (p2.attributes.lat - p1.attributes.lat) * fraction;
            }

            // Avoid overlapping Start or Finish nodes (within 65m)
            const distFromStart = distance(startPt, { lat, lon });
            const distFromEnd = distance(endPt, { lat, lon });

            if (distFromStart > 65 && distFromEnd > 65) {
                let sort_key = 10;
                let minzoom = 12.5;

                if (currentMilestoneVal % 50 === 0) {
                    sort_key = 1;
                    minzoom = 5;
                } else if (currentMilestoneVal % 20 === 0) {
                    sort_key = 2;
                    minzoom = 7;
                } else if (currentMilestoneVal % 10 === 0) {
                    sort_key = 3;
                    minzoom = 8.5;
                } else if (currentMilestoneVal % 5 === 0) {
                    sort_key = 4;
                    minzoom = 10;
                } else if (currentMilestoneVal % 2 === 0) {
                    sort_key = 5;
                    minzoom = 11.5;
                }

                features.push({
                    type: 'Feature',
                    properties: {
                        distance: currentMilestoneVal,
                        sort_key,
                        minzoom,
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [lon, lat],
                    },
                });
            }

            currentMilestoneVal += step;
            targetMeters += stepMeters;
        }

        source.setData({
            type: 'FeatureCollection',
            features,
        });
    }

    setResult(points: TrackPoint[]) {
        this.currentPoints = points;
        mapManager.onReady((map) => {
            this.ensureLayers(map);
            const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
            if (!source) return;
            if (points.length < 2) {
                source.setData({ type: 'FeatureCollection', features: [] });
                this.removeGhostMarker();
                this.updateDistanceMarkers();
                return;
            }
            source.setData({
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: {},
                        geometry: {
                            type: 'LineString',
                            coordinates: points.map((p) => [
                                p.attributes.lon,
                                p.attributes.lat,
                            ]),
                        },
                    },
                ],
            });
            this.updateDistanceMarkers();
            this.alignMarkersToRoute();
        });
    }

    /** Re-apply layers and markers after style reload */
    resync() {
        const map = mapManager.getMap();
        if (!map) return;
        this.wire(map);
        this.ensureLayers(map);
        this.syncMarkers(map, this.currentAnchors);
        if (this.currentPoints.length >= 2) {
            this.setResult(this.currentPoints);
        }
    }

    /** Soft clear: drop markers and the result line, keep click listener wired */
    clear() {
        const map = this.wiredMap ?? mapManager.getMap();
        map?.dragPan.enable();
        this.isDraggingLine = false;
        this.isHoveringLine = false;
        for (const marker of this.markers) marker.remove();
        this.markers = [];
        this.currentPoints = [];
        this.currentAnchors = [];
        this.removeGhostMarker();
        this.clearRubberBand();
        this.hideDragTooltip();
        this.setResult([]);
    }

    /** Full teardown — called when the map itself goes away. */
    destroy() {
        this.clear();
        this.unwire();
        const map = mapManager.getMap();
        if (map) {
            try {
                if (map.getLayer(LINE_HIT_AREA_LAYER_ID)) map.removeLayer(LINE_HIT_AREA_LAYER_ID);
                if (map.getLayer(RUBBER_BAND_LAYER_ID)) map.removeLayer(RUBBER_BAND_LAYER_ID);
                if (map.getLayer(MILESTONES_LAYER_ID)) map.removeLayer(MILESTONES_LAYER_ID);
                if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
                if (map.getLayer(LINE_CASING_LAYER_ID)) map.removeLayer(LINE_CASING_LAYER_ID);
                if (map.getSource(RUBBER_BAND_SOURCE_ID)) map.removeSource(RUBBER_BAND_SOURCE_ID);
                if (map.getSource(MILESTONES_SOURCE_ID)) map.removeSource(MILESTONES_SOURCE_ID);
                if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
                if (map.hasImage(BADGE_IMAGE_ID)) map.removeImage(BADGE_IMAGE_ID);
                if (map.hasImage(BADGE_IMAGE_WIDE_ID)) map.removeImage(BADGE_IMAGE_WIDE_ID);
            } catch {
                // Ignore cleanup errors
            }
        }
    }
}

export const routingLayer = new RoutingLayerController();
(globalThis as { __xroute_routing?: RoutingLayerController }).__xroute_routing = routingLayer;
