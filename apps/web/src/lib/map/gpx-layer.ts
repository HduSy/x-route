import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { GPXFile, type GPXFileType } from '@x-route/gpx';
import { mapManager } from './MapManager';

// Unified route color across x-route (signature vibrant purple)
export const UNIFIED_ROUTE_COLOR = '#863BFF';

interface LayerFile {
    fileId: string;
    file: GPXFileType;
}

function fileToGeoJSON(fileId: string, file: GPXFileType, _color: string, _selected: boolean) {
    const gpxFile = new GPXFile(file);
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

    gpxFile.forEachSegment((segment, trackIndex, segmentIndex) => {
        const coordinates = segment.trkpt.map((point) => {
            const c = point.getCoordinates();
            return [c.lon, c.lat] as [number, number];
        });
        if (coordinates.length < 2) return;

        features.push({
            type: 'Feature',
            properties: {
                fileId,
                color: UNIFIED_ROUTE_COLOR,
                width: 5,
                opacity: 0.95,
                trackSegmentId: `${trackIndex}-${segmentIndex}`,
                name: gpxFile.metadata?.name ?? 'Untitled',
            },
            geometry: { type: 'LineString', coordinates },
        });
    });

    return { type: 'FeatureCollection' as const, features };
}

class GPXLayerController {
    private colors = new Map<string, string>();

    /** Set by the React layer; fires when a track line is clicked. */
    onFileClick: ((fileId: string) => void) | null = null;

    /** Layer ids currently on the map (used for hit-testing / delegation). */
    getLayerIds(): string[] {
        return Array.from(this.colors.keys());
    }

    private lastFiles: LayerFile[] = [];
    private lastSelected: string | null = null;

    sync(files: LayerFile[], selectedFileId: string | null) {
        this.lastFiles = files;
        this.lastSelected = selectedFileId;
        mapManager.onReady((map) => {
            if (!map.getStyle()) {
                throw new Error('Map style is not loaded yet');
            }
            // Removals are safe in any style state and must never be deferred —
            // a deferred sync could leave a deleted track on screen forever.
            this.removeStaleLayers(map, files);
            for (const { fileId, file } of files) {
                this.syncFileLayer(map, fileId, file, selectedFileId === fileId);
            }
        });
    }

    /** Re-apply the last sync after a setStyle wiped dynamic layers. */
    resync() {
        if (this.lastFiles.length > 0) {
            this.sync(this.lastFiles, this.lastSelected);
        }
    }

    /** Emphasize selected file; if no selection, show all at full opacity. */
    applySelection(selectedFileId: string | null) {
        this.lastSelected = selectedFileId;
        const map = mapManager.getMap();
        if (!map || !map.getStyle()) return;
        for (const [fileId] of this.colors) {
            const layerId = this.lineLayerId(fileId);
            if (!map.getLayer(layerId)) continue;
            const isHighlight = selectedFileId === null || fileId === selectedFileId;
            map.setPaintProperty(layerId, 'line-opacity', isHighlight ? 0.95 : 0.45);
            map.setPaintProperty(layerId, 'line-width', fileId === selectedFileId ? 6 : 5);
        }
    }

    getBounds(files: LayerFile[]): [[number, number], [number, number]] | null {
        let west: number | undefined;
        let south: number | undefined;
        let east: number | undefined;
        let north: number | undefined;

        for (const { file } of files) {
            const { global } = new GPXFile(file).getStatistics();
            const sw = global.bounds.southWest;
            const ne = global.bounds.northEast;
            if (west === undefined || sw.lon < west) west = sw.lon;
            if (south === undefined || sw.lat < south) south = sw.lat;
            if (east === undefined || ne.lon > east) east = ne.lon;
            if (north === undefined || ne.lat > north) north = ne.lat;
        }

        if (west === undefined || south === undefined || east === undefined || north === undefined) {
            return null;
        }
        return [
            [west, south],
            [east, north],
        ];
    }

    private lineLayerId(fileId: string) {
        return fileId;
    }

    private directionLayerId(fileId: string) {
        return `${fileId}-direction`;
    }

    private casingLayerId(fileId: string) {
        return `${fileId}-casing`;
    }

    private syncFileLayer(map: MapLibreMap, fileId: string, file: GPXFileType, selected: boolean) {
        const color = UNIFIED_ROUTE_COLOR;
        this.colors.set(fileId, color);
        const geojson = fileToGeoJSON(fileId, file, color, selected);
        if (geojson.features.length === 0) return;

        // Fast path keyed on LAYER presence, not source: during a setStyle
        // transition getSource() can still return the previous style's source
        // instance, which would make us skip re-adding and end up empty.
        if (map.getLayer(this.lineLayerId(fileId))) {
            const source = map.getSource(fileId) as GeoJSONSource | undefined;
            source?.setData(geojson);
        } else {
            if (!map.getSource(fileId)) {
                map.addSource(fileId, { type: 'geojson', data: geojson });
            }
            const source = map.getSource(fileId) as GeoJSONSource | undefined;
            source?.setData(geojson);
        }

        // White casing underlay for crisp contrast across all basemap styles
        if (!map.getLayer(this.casingLayerId(fileId))) {
            map.addLayer(
                {
                    id: this.casingLayerId(fileId),
                    type: 'line',
                    source: fileId,
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round',
                    },
                    paint: {
                        'line-color': '#FFFFFF',
                        'line-width': 8,
                        'line-opacity': 0.9,
                    },
                },
                map.getLayer(this.lineLayerId(fileId)) ? this.lineLayerId(fileId) : undefined
            );
        }

        if (!map.getLayer(this.lineLayerId(fileId))) {
            map.addLayer({
                id: this.lineLayerId(fileId),
                type: 'line',
                source: fileId,
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round',
                },
                paint: {
                    'line-color': UNIFIED_ROUTE_COLOR,
                    'line-width': selected ? 6 : 5,
                    'line-opacity': 0.95,
                },
            });

            // Selection on click, cursor feedback on hover
            map.on('click', this.lineLayerId(fileId), (e) => {
                const feature = e.features?.[0];
                const id = feature?.properties?.fileId as string | undefined;
                if (id) {
                    this.onFileClick?.(id);
                }
            });
            map.on('mouseenter', this.lineLayerId(fileId), () => {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', this.lineLayerId(fileId), () => {
                map.getCanvas().style.cursor = '';
            });
        }

        if (!map.getLayer(this.directionLayerId(fileId))) {
            map.addLayer({
                id: this.directionLayerId(fileId),
                type: 'symbol',
                source: fileId,
                layout: {
                    'text-field': '»',
                    'text-offset': [0, -0.1],
                    'text-keep-upright': false,
                    'text-max-angle': 361,
                    'text-allow-overlap': true,
                    'symbol-placement': 'line',
                    'symbol-spacing': 80,
                },
                paint: {
                    'text-color': '#FFFFFF',
                    'text-halo-width': 1,
                    'text-halo-color': UNIFIED_ROUTE_COLOR,
                },
            });
        }
    }

    private removeStaleLayers(map: MapLibreMap, files: LayerFile[]) {
        const alive = new Set(files.map((f) => f.fileId));
        for (const [fileId] of this.colors) {
            if (alive.has(fileId)) continue;
            for (const layerId of [this.directionLayerId(fileId), this.lineLayerId(fileId), this.casingLayerId(fileId)]) {
                if (map.getLayer(layerId)) map.removeLayer(layerId);
            }
            if (map.getSource(fileId)) map.removeSource(fileId);
            this.colors.delete(fileId);
        }
    }
}

export const gpxLayers = new GPXLayerController();
(globalThis as { __xroute_gpx?: GPXLayerController }).__xroute_gpx = gpxLayers;
