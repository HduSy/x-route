import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { GPXFile, type GPXFileType } from '@x-route/gpx';
import { mapManager } from './MapManager';

// gpx.studio's file color palette (gpx-layer.ts)
const PALETTE = [
    '#ff0000',
    '#0000ff',
    '#46e646',
    '#00ccff',
    '#ff9900',
    '#ff00ff',
    '#ffff32',
    '#288228',
];

interface LayerFile {
    fileId: string;
    file: GPXFileType;
}

function fileToGeoJSON(fileId: string, file: GPXFileType, color: string, selected: boolean) {
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
                color,
                width: selected ? 7 : 4,
                opacity: selected ? 1 : 0.8,
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
    private colorIndex = 0;

    /** Set by the React layer; fires when a track line is clicked. */
    onFileClick: ((fileId: string) => void) | null = null;

    /** Layer ids currently on the map (used for hit-testing / delegation). */
    getLayerIds(): string[] {
        return Array.from(this.colors.keys());
    }

    private assignColor(fileId: string): string {
        let color = this.colors.get(fileId);
        if (!color) {
            color = PALETTE[this.colorIndex % PALETTE.length]!;
            this.colorIndex++;
            this.colors.set(fileId, color);
        }
        return color;
    }

    private lastFiles: LayerFile[] = [];
    private lastSelected: string | null = null;

    sync(files: LayerFile[], selectedFileId: string | null) {
        this.lastFiles = files;
        this.lastSelected = selectedFileId;
        mapManager.onReady((map) => {
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

    /** Fade unselected files when one is selected (source-project behavior). */
    applySelection(selectedFileId: string | null) {
        const map = mapManager.getMap();
        if (!map) return;
        for (const [fileId] of this.colors) {
            const layerId = this.lineLayerId(fileId);
            if (!map.getLayer(layerId)) continue;
            const selected = fileId === selectedFileId;
            map.setPaintProperty(layerId, 'line-opacity', selected ? 1 : 0.35);
            map.setPaintProperty(layerId, 'line-width', selected ? 7 : 4);
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

    private syncFileLayer(map: MapLibreMap, fileId: string, file: GPXFileType, selected: boolean) {
        const color = this.assignColor(fileId);
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
                    'line-color': ['get', 'color'],
                    'line-width': ['get', 'width'],
                    'line-opacity': ['get', 'opacity'],
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
            map.addLayer(
                {
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
                        'text-color': color,
                        'text-halo-width': 1,
                        'text-halo-color': '#ffffff',
                    },
                },
                this.lineLayerId(fileId)
            );
        }
    }

    private removeStaleLayers(map: MapLibreMap, files: LayerFile[]) {
        const alive = new Set(files.map((f) => f.fileId));
        for (const [fileId] of this.colors) {
            if (alive.has(fileId)) continue;
            for (const layerId of [this.directionLayerId(fileId), this.lineLayerId(fileId)]) {
                if (map.getLayer(layerId)) map.removeLayer(layerId);
            }
            if (map.getSource(fileId)) map.removeSource(fileId);
            this.colors.delete(fileId);
        }
    }
}

export const gpxLayers = new GPXLayerController();
