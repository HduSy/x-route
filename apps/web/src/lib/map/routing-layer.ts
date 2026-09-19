import { Marker, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { mapManager } from './MapManager';
import type { RoutingAnchor } from '@/store/routing-slice';
import { TrackPoint, distance } from '@x-route/gpx';
import { getClosestLinePoint, type ClosestPointDetails } from '@/lib/utils';

// AD-6 imperative routing layer: anchor markers are plain DOM circles driven
// by MapLibre Marker (drag support for free); the computed route renders as a
// GeoJSON line source. All interaction lands in the store via callbacks.

const SOURCE_ID = 'x-route-routing';
const LINE_LAYER_ID = 'x-route-routing-line';

function anchorElement(kind: 'start' | 'end' | 'via'): HTMLElement {
    const el = document.createElement('div');
    const colors = { start: '#198836', end: '#D53F2C', via: '#3B82F6' };
    el.style.cssText = `
        width: ${kind === 'via' ? 12 : 15}px;
        height: ${kind === 'via' ? 12 : 15}px;
        border-radius: 9999px;
        background-color: ${colors[kind]};
        border: 2px solid #ffffff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        cursor: grab;
    `;
    return el;
}

function ghostAnchorElement(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `
        width: 14px;
        height: 14px;
        border-radius: 9999px;
        background-color: rgba(59, 130, 246, 0.75);
        border: 2px solid #ffffff;
        box-shadow: 0 1px 4px rgba(0,0,0,0.5);
        cursor: pointer;
        transition: transform 0.1s ease;
    `;
    el.onmouseenter = () => {
        el.style.transform = 'scale(1.25)';
        el.style.backgroundColor = 'rgba(59, 130, 246, 1)';
    };
    el.onmouseleave = () => {
        el.style.transform = 'scale(1.0)';
        el.style.backgroundColor = 'rgba(59, 130, 246, 0.75)';
    };
    return el;
}

function findInsertIndex(
    points: TrackPoint[],
    anchors: RoutingAnchor[],
    pointIndex: number
): number {
    if (anchors.length <= 1) return anchors.length;
    if (anchors.length === 2) return 1;

    const anchorPointIndices: number[] = [];
    let searchStart = 0;
    for (const anchor of anchors) {
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

    for (let k = 0; k < anchorPointIndices.length - 1; k++) {
        const startIdx = anchorPointIndices[k]!;
        const endIdx = anchorPointIndices[k + 1]!;
        if (pointIndex >= startIdx && pointIndex <= endIdx) {
            return k + 1;
        }
    }

    return anchors.length - 1;
}

export class RoutingLayerController {
    private markers: Marker[] = [];
    private ghostMarker: Marker | null = null;
    private currentInsertIndex: number = 1;
    private isDraggingGhost = false;
    private currentAnchors: RoutingAnchor[] = [];
    private currentPoints: TrackPoint[] = [];

    private clickHandler:
        | ((e: { lngLat: { lng: number; lat: number } }) => void)
        | null = null;
    private lineMouseMoveHandler: ((e: any) => void) | null = null;
    private lineMouseLeaveHandler: (() => void) | null = null;

    /** Set by the React layer. */
    onMapClick: ((lngLat: { lon: number; lat: number }) => void) | null = null;
    onInsertAnchor: ((index: number, lngLat: { lon: number; lat: number }) => void) | null = null;
    onMarkerDrag: ((index: number, lngLat: { lon: number; lat: number }) => void) | null = null;
    onMarkerRightClick: ((index: number) => void) | null = null;

    private wired = false;

    private wire(map: MapLibreMap) {
        if (this.wired) return;
        this.wired = true;

        this.clickHandler = (e) => {
            if (!this.onMapClick) return;
            this.onMapClick({ lon: e.lngLat.lng, lat: e.lngLat.lat });
        };
        map.on('click', this.clickHandler);

        this.lineMouseMoveHandler = (e: any) => {
            if (this.isDraggingGhost) return;
            if (this.currentPoints.length < 2) return;

            const details: Partial<ClosestPointDetails> = {};
            const closest = getClosestLinePoint(
                this.currentPoints,
                { lat: e.lngLat.lat, lon: e.lngLat.lng },
                details
            );
            if (!closest) return;

            const lon = closest.attributes.lon;
            const lat = closest.attributes.lat;
            this.currentInsertIndex = findInsertIndex(
                this.currentPoints,
                this.currentAnchors,
                details.index ?? 0
            );

            this.ensureGhostMarker(map);
            this.ghostMarker?.setLngLat([lon, lat]);
        };

        this.lineMouseLeaveHandler = () => {
            if (!this.isDraggingGhost) {
                this.removeGhostMarker();
            }
        };

        map.on('mousemove', LINE_LAYER_ID, this.lineMouseMoveHandler);
        map.on('mouseleave', LINE_LAYER_ID, this.lineMouseLeaveHandler);
    }

    private removeGhostMarker() {
        if (this.ghostMarker) {
            this.ghostMarker.remove();
            this.ghostMarker = null;
        }
    }

    private ensureGhostMarker(map: MapLibreMap) {
        if (this.ghostMarker) return;
        const el = ghostAnchorElement();
        const marker = new Marker({ element: el, draggable: true });

        marker.on('dragstart', () => {
            this.isDraggingGhost = true;
        });

        marker.on('dragend', () => {
            this.isDraggingGhost = false;
            const pos = marker.getLngLat();
            const targetIndex = this.currentInsertIndex;
            this.removeGhostMarker();
            this.onInsertAnchor?.(targetIndex, { lon: pos.lng, lat: pos.lat });
        });

        marker.getElement().addEventListener('click', (e) => {
            e.stopPropagation();
            const pos = marker.getLngLat();
            const targetIndex = this.currentInsertIndex;
            this.removeGhostMarker();
            this.onInsertAnchor?.(targetIndex, { lon: pos.lng, lat: pos.lat });
        });

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
        // Rebuild markers when the anchor count changed (last anchor restyles
        // from via to end); otherwise just reposition existing ones.
        if (this.markers.length !== anchors.length) {
            for (const marker of this.markers) marker.remove();
            this.markers = anchors.map((anchor, index) =>
                this.createMarker(map, anchor, index, anchors.length)
            );
        } else {
            anchors.forEach((anchor, index) => {
                this.markers[index]?.setLngLat([anchor.lon, anchor.lat]);
            });
        }
    }

    private createMarker(
        map: MapLibreMap,
        anchor: RoutingAnchor,
        index: number,
        total: number
    ): Marker {
        const kind = index === 0 ? 'start' : index === total - 1 ? 'end' : 'via';
        const el = anchorElement(kind);
        const marker = new Marker({ element: el, draggable: true })
            .setLngLat([anchor.lon, anchor.lat])
            .addTo(map);

        marker.on('dragend', () => {
            const lngLat = marker.getLngLat();
            this.onMarkerDrag?.(index, { lon: lngLat.lng, lat: lngLat.lat });
        });
        el.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.onMarkerRightClick?.(index);
        });

        return marker;
    }

    private ensureLayers(map: MapLibreMap) {
        if (!map.getSource(SOURCE_ID)) {
            map.addSource(SOURCE_ID, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
        }
        if (!map.getLayer(LINE_LAYER_ID)) {
            map.addLayer({
                id: LINE_LAYER_ID,
                type: 'line',
                source: SOURCE_ID,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#3B82F6',
                    'line-width': 5,
                    'line-opacity': 0.85,
                },
            });
        }
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
        });
    }

    /** Soft clear: drop markers and the result line, keep the click listener
     *  wired so the tool can be re-activated without re-syncing. */
    clear() {
        for (const marker of this.markers) marker.remove();
        this.markers = [];
        this.currentPoints = [];
        this.currentAnchors = [];
        this.removeGhostMarker();
        this.setResult([]);
    }

    /** Full teardown — called when the map itself goes away. */
    destroy() {
        this.clear();
        const map = mapManager.getMap();
        if (map) {
            if (this.clickHandler) map.off('click', this.clickHandler);
            if (this.lineMouseMoveHandler) map.off('mousemove', LINE_LAYER_ID, this.lineMouseMoveHandler);
            if (this.lineMouseLeaveHandler) map.off('mouseleave', LINE_LAYER_ID, this.lineMouseLeaveHandler);
            if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
            if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        }
        this.clickHandler = null;
        this.lineMouseMoveHandler = null;
        this.lineMouseLeaveHandler = null;
        this.wired = false;
    }
}

export const routingLayer = new RoutingLayerController();
(globalThis as { __xroute_routing?: RoutingLayerController }).__xroute_routing = routingLayer;
