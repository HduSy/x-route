import { Marker, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { mapManager } from './MapManager';
import type { RoutingAnchor, UnitType } from '@/store/routing-slice';
import { TrackPoint, distance } from '@x-route/gpx';
import { getClosestLinePoint, type ClosestPointDetails } from '@/lib/utils';

// Strava Route Builder imperative routing layer:
// - Strava signature energetic orange route polyline with casing
// - Crisp numbered/styled start, via, and finish markers
// - Interactive ghost marker for mid-segment insertion
// - Distance milestone badges (1km, 2km, ...) along the route

const SOURCE_ID = 'x-route-routing';
const LINE_CASING_LAYER_ID = 'x-route-routing-casing';
const LINE_LAYER_ID = 'x-route-routing-line';

function anchorElement(kind: 'start' | 'end' | 'via', _index: number, _total: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'x-route-anchor-marker';

    if (kind === 'start') {
        // Strava signature green starting node
        el.style.cssText = `
            width: 20px;
            height: 20px;
            border-radius: 9999px;
            background-color: #00B548;
            border: 2.5px solid #ffffff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.35);
            cursor: grab;
            user-select: none;
            transition: transform 0.1s ease;
        `;
    } else if (kind === 'end') {
        // Strava signature checkered finish line flag node 🏁
        el.style.cssText = `
            width: 20px;
            height: 20px;
            border-radius: 9999px;
            background: repeating-conic-gradient(#18181b 0% 25%, #ffffff 0% 50%) 50% / 6px 6px;
            border: 2.5px solid #ffffff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.45);
            cursor: grab;
            user-select: none;
            transition: transform 0.1s ease;
        `;
    } else {
        // Intermediate waypoint node
        el.style.cssText = `
            width: 12px;
            height: 12px;
            border-radius: 9999px;
            background-color: #ffffff;
            border: 3px solid #863bff;
            box-shadow: 0 1px 4px rgba(0,0,0,0.35);
            cursor: grab;
            user-select: none;
            transition: transform 0.1s ease;
        `;
    }

    el.addEventListener('mouseenter', () => {
        el.style.transform = 'scale(1.18)';
    });
    el.addEventListener('mouseleave', () => {
        el.style.transform = 'scale(1.0)';
    });
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
        width: 16px;
        height: 16px;
        border-radius: 9999px;
        background-color: rgba(134, 59, 255, 0.85);
        border: 2.5px solid #ffffff;
        box-shadow: 0 2px 6px rgba(134, 59, 255, 0.5);
        cursor: pointer;
        transition: transform 0.12s ease;
    `;
    el.onmouseenter = () => {
        el.style.transform = 'scale(1.3)';
        el.style.backgroundColor = '#863bff';
    };
    el.onmouseleave = () => {
        el.style.transform = 'scale(1.0)';
        el.style.backgroundColor = 'rgba(134, 59, 255, 0.85)';
    };
    return el;
}

function distanceMarkerElement(label: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `
        background-color: #ffffff;
        color: #262626;
        font-size: 10px;
        font-weight: 700;
        border-radius: 9999px;
        padding: 1px 5px;
        border: 1.5px solid #863bff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        pointer-events: none;
        user-select: none;
        white-space: nowrap;
        line-height: 1.2;
    `;
    el.innerText = label;
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
    private distanceMarkers: Marker[] = [];
    private ghostMarker: Marker | null = null;
    private currentInsertIndex: number = 1;
    private isDraggingGhost = false;
    private currentAnchors: RoutingAnchor[] = [];
    private currentPoints: TrackPoint[] = [];

    // Display options
    private showDistanceMarkers = true;
    private showRoutePath = true;
    private units: UnitType = 'km';

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

    private removeDistanceMarkers() {
        for (const m of this.distanceMarkers) {
            m.remove();
        }
        this.distanceMarkers = [];
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
        for (const marker of this.markers) marker.remove();
        this.markers = anchors.map((anchor, index) =>
            this.createMarker(map, anchor, index, anchors.length)
        );
    }

    private createMarker(
        map: MapLibreMap,
        anchor: RoutingAnchor,
        index: number,
        total: number
    ): Marker {
        const kind = index === 0 ? 'start' : index === total - 1 ? 'end' : 'via';
        const el = anchorElement(kind, index, total);
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
    }

    setOptions(options: { showDistanceMarkers?: boolean; showRoutePath?: boolean; units?: UnitType }) {
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
        this.updateDistanceMarkers();
    }

    private updateDistanceMarkers() {
        this.removeDistanceMarkers();
        if (!this.showDistanceMarkers || this.currentPoints.length < 2) return;

        const map = mapManager.getMap();
        if (!map) return;

        const intervalKm = this.units === 'mi' ? 1.60934 : 1.0;
        let accumulatedKm = 0;
        let nextMarkerKm = intervalKm;
        let markerCount = 1;

        for (let i = 1; i < this.currentPoints.length; i++) {
            const p1 = this.currentPoints[i - 1]!;
            const p2 = this.currentPoints[i]!;
            const c1 = { lat: p1.attributes.lat, lon: p1.attributes.lon };
            const c2 = { lat: p2.attributes.lat, lon: p2.attributes.lon };
            const segDistKm = distance(c1, c2) / 1000;

            while (accumulatedKm + segDistKm >= nextMarkerKm) {
                const fraction = (nextMarkerKm - accumulatedKm) / segDistKm;
                const lon = c1.lon + (c2.lon - c1.lon) * fraction;
                const lat = c1.lat + (c2.lat - c1.lat) * fraction;

                const el = distanceMarkerElement(String(markerCount));
                const marker = new Marker({ element: el, anchor: 'center' })
                    .setLngLat([lon, lat])
                    .addTo(map);

                this.distanceMarkers.push(marker);
                markerCount++;
                nextMarkerKm += intervalKm;
            }

            accumulatedKm += segDistKm;
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
                this.removeDistanceMarkers();
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
        });
    }

    /** Soft clear: drop markers and the result line, keep click listener wired */
    clear() {
        for (const marker of this.markers) marker.remove();
        this.markers = [];
        this.currentPoints = [];
        this.currentAnchors = [];
        this.removeGhostMarker();
        this.removeDistanceMarkers();
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
            if (map.getLayer(LINE_CASING_LAYER_ID)) map.removeLayer(LINE_CASING_LAYER_ID);
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
