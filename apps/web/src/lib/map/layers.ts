import { type StyleSpecification } from 'maplibre-gl';
import bikerouterGravel from './custom/bikerouter-gravel.json';

export type OverlayCategory = 'trails' | 'infrastructure' | 'switzerland' | 'france';

export interface OverlayMeta {
    id: string;
    label: string;
    category: OverlayCategory;
    defaultOpacity?: number;
}

export const OVERLAYS: Record<string, StyleSpecification> = {
    cyclOSMlite: {
        version: 8,
        sources: {
            cyclOSMlite: {
                type: 'raster',
                tiles: [
                    'https://a.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png',
                    'https://b.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png',
                    'https://c.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png',
                ],
                tileSize: 256,
                maxzoom: 17,
                attribution:
                    '&copy; <a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            },
        },
        layers: [
            {
                id: 'cyclOSMlite',
                type: 'raster',
                source: 'cyclOSMlite',
            },
        ],
    },
    bikerouterGravel: bikerouterGravel as unknown as StyleSpecification,
    openRailwayMap: {
        version: 8,
        sources: {
            openRailwayMap: {
                type: 'raster',
                tiles: ['https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 19,
                attribution:
                    'Data <a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a>, Style: CC-BY-SA 2.0 OpenRailwayMap',
            },
        },
        layers: [
            {
                id: 'openRailwayMap',
                type: 'raster',
                source: 'openRailwayMap',
            },
        ],
    },
    mapterhornHillshade: {
        version: 8,
        sources: {
            mapterhornHillshade: {
                type: 'raster-dem',
                url: 'https://tiles.mapterhorn.com/tilejson.json',
            },
        },
        layers: [
            {
                id: 'mapterhornHillshade',
                type: 'hillshade',
                source: 'mapterhornHillshade',
            },
        ],
    },
    swisstopoSlope: {
        version: 8,
        sources: {
            swisstopoSlope: {
                type: 'raster',
                tiles: [
                    'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png',
                ],
                tileSize: 256,
                maxzoom: 17,
                attribution: '&copy; <a href="https://www.swisstopo.admin.ch" target="_blank">swisstopo</a>',
            },
        },
        layers: [
            {
                id: 'swisstopoSlope',
                type: 'raster',
                source: 'swisstopoSlope',
                paint: {
                    'raster-opacity': 0.4,
                },
            },
        ],
    },
    swisstopoHiking: {
        version: 8,
        sources: {
            swisstopoHiking: {
                type: 'raster',
                tiles: [
                    'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swisstlm3d-wanderwege/default/current/3857/{z}/{x}/{y}.png',
                ],
                tileSize: 256,
                maxzoom: 18,
                attribution: '&copy; <a href="https://www.swisstopo.admin.ch" target="_blank">swisstopo</a>',
            },
        },
        layers: [
            {
                id: 'swisstopoHiking',
                type: 'raster',
                source: 'swisstopoHiking',
            },
        ],
    },
    swisstopoHikingClosures: {
        version: 8,
        sources: {
            swisstopoHikingClosures: {
                type: 'raster',
                tiles: [
                    'https://wms.geo.admin.ch/?version=1.3.0&service=WMS&request=GetMap&sld_version=1.1.0&layers=ch.astra.wanderland-sperrungen_umleitungen&format=image/png&STYLE=default&bbox={bbox-epsg-3857}&width=256&height=256&crs=EPSG:3857&transparent=true',
                ],
                tileSize: 256,
                attribution: '&copy; <a href="https://www.swisstopo.admin.ch" target="_blank">swisstopo</a>',
            },
        },
        layers: [
            {
                id: 'swisstopoHikingClosures',
                type: 'raster',
                source: 'swisstopoHikingClosures',
            },
        ],
    },
    swisstopoCycling: {
        version: 8,
        sources: {
            swisstopoCycling: {
                type: 'raster',
                tiles: [
                    'https://wmts.geo.admin.ch/1.0.0/ch.astra.veloland/default/current/3857/{z}/{x}/{y}.png',
                ],
                tileSize: 256,
                maxzoom: 18,
                attribution: '&copy; <a href="https://www.swisstopo.admin.ch" target="_blank">swisstopo</a>',
            },
        },
        layers: [
            {
                id: 'swisstopoCycling',
                type: 'raster',
                source: 'swisstopoCycling',
            },
        ],
    },
    swisstopoCyclingClosures: {
        version: 8,
        sources: {
            swisstopoCyclingClosures: {
                type: 'raster',
                tiles: [
                    'https://wms.geo.admin.ch/?version=1.3.0&service=WMS&request=GetMap&sld_version=1.1.0&layers=ch.astra.veloland-sperrungen_umleitungen&format=image/png&STYLE=default&bbox={bbox-epsg-3857}&width=256&height=256&crs=EPSG:3857&transparent=true',
                ],
                tileSize: 256,
                attribution: '&copy; <a href="https://www.swisstopo.admin.ch" target="_blank">swisstopo</a>',
            },
        },
        layers: [
            {
                id: 'swisstopoCyclingClosures',
                type: 'raster',
                source: 'swisstopoCyclingClosures',
            },
        ],
    },
    swisstopoMountainBike: {
        version: 8,
        sources: {
            swisstopoMountainBike: {
                type: 'raster',
                tiles: [
                    'https://wmts.geo.admin.ch/1.0.0/ch.astra.mountainbikeland/default/current/3857/{z}/{x}/{y}.png',
                ],
                tileSize: 256,
                maxzoom: 18,
                attribution: '&copy; <a href="https://www.swisstopo.admin.ch" target="_blank">swisstopo</a>',
            },
        },
        layers: [
            {
                id: 'swisstopoMountainBike',
                type: 'raster',
                source: 'swisstopoMountainBike',
            },
        ],
    },
    swisstopoMountainBikeClosures: {
        version: 8,
        sources: {
            swisstopoMountainBikeClosures: {
                type: 'raster',
                tiles: [
                    'https://wms.geo.admin.ch/?version=1.3.0&service=WMS&request=GetMap&sld_version=1.1.0&layers=ch.astra.mountainbikeland-sperrungen_umleitungen&format=image/png&STYLE=default&bbox={bbox-epsg-3857}&width=256&height=256&crs=EPSG:3857&transparent=true',
                ],
                tileSize: 256,
                attribution: '&copy; <a href="https://www.swisstopo.admin.ch" target="_blank">swisstopo</a>',
            },
        },
        layers: [
            {
                id: 'swisstopoMountainBikeClosures',
                type: 'raster',
                source: 'swisstopoMountainBikeClosures',
            },
        ],
    },
    swisstopoSkiTouring: {
        version: 8,
        sources: {
            swisstopoSkiTouring: {
                type: 'raster',
                tiles: [
                    'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png',
                ],
                tileSize: 256,
                maxzoom: 17,
                attribution: '&copy; <a href="https://www.swisstopo.admin.ch" target="_blank">swisstopo</a>',
            },
        },
        layers: [
            {
                id: 'swisstopoSkiTouring',
                type: 'raster',
                source: 'swisstopoSkiTouring',
            },
        ],
    },
    ignFrCadastre: {
        version: 8,
        sources: {
            ignFrCadastre: {
                type: 'raster',
                tiles: [
                    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&TILEMATRIXSET=PM&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&LAYER=CADASTRALPARCELS.PARCELS&FORMAT=image/png&STYLE=normal',
                ],
                tileSize: 256,
                maxzoom: 20,
                attribution: 'IGN-F/Géoportail',
            },
        },
        layers: [
            {
                id: 'ignFrCadastre',
                type: 'raster',
                source: 'ignFrCadastre',
                paint: {
                    'raster-opacity': 0.5,
                },
            },
        ],
    },
    ignSlope: {
        version: 8,
        sources: {
            ignSlope: {
                type: 'raster',
                tiles: [
                    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&TileMatrixSet=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&Layer=GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN&FORMAT=image/png&Style=normal',
                ],
                tileSize: 256,
                attribution: 'IGN-F/Géoportail',
            },
        },
        layers: [
            {
                id: 'ignSlope',
                type: 'raster',
                source: 'ignSlope',
                paint: {
                    'raster-opacity': 0.4,
                },
            },
        ],
    },
    ignSkiTouring: {
        version: 8,
        sources: {
            ignSkiTouring: {
                type: 'raster',
                tiles: [
                    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&TileMatrixSet=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&Layer=TRACES.RANDO.HIVERNALE&FORMAT=image/png&Style=normal',
                ],
                tileSize: 256,
                maxzoom: 16,
                attribution: 'IGN-F/Géoportail',
            },
        },
        layers: [
            {
                id: 'ignSkiTouring',
                type: 'raster',
                source: 'ignSkiTouring',
            },
        ],
    },
    waymarkedTrailsHiking: {
        version: 8,
        sources: {
            waymarkedTrailsHiking: {
                type: 'raster',
                tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 18,
                attribution:
                    '&copy; <a href="https://www.waymarkedtrails.org" target="_blank">Waymarked Trails</a>',
            },
        },
        layers: [
            {
                id: 'waymarkedTrailsHiking',
                type: 'raster',
                source: 'waymarkedTrailsHiking',
            },
        ],
    },
    waymarkedTrailsCycling: {
        version: 8,
        sources: {
            waymarkedTrailsCycling: {
                type: 'raster',
                tiles: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 18,
                attribution:
                    '&copy; <a href="https://www.waymarkedtrails.org" target="_blank">Waymarked Trails</a>',
            },
        },
        layers: [
            {
                id: 'waymarkedTrailsCycling',
                type: 'raster',
                source: 'waymarkedTrailsCycling',
            },
        ],
    },
    waymarkedTrailsMTB: {
        version: 8,
        sources: {
            waymarkedTrailsMTB: {
                type: 'raster',
                tiles: ['https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 18,
                attribution:
                    '&copy; <a href="https://www.waymarkedtrails.org" target="_blank">Waymarked Trails</a>',
            },
        },
        layers: [
            {
                id: 'waymarkedTrailsMTB',
                type: 'raster',
                source: 'waymarkedTrailsMTB',
            },
        ],
    },
    waymarkedTrailsSkating: {
        version: 8,
        sources: {
            waymarkedTrailsSkating: {
                type: 'raster',
                tiles: ['https://tile.waymarkedtrails.org/skating/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 18,
                attribution:
                    '&copy; <a href="https://www.waymarkedtrails.org" target="_blank">Waymarked Trails</a>',
            },
        },
        layers: [
            {
                id: 'waymarkedTrailsSkating',
                type: 'raster',
                source: 'waymarkedTrailsSkating',
            },
        ],
    },
    waymarkedTrailsHorseRiding: {
        version: 8,
        sources: {
            waymarkedTrailsHorseRiding: {
                type: 'raster',
                tiles: ['https://tile.waymarkedtrails.org/riding/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 18,
                attribution:
                    '&copy; <a href="https://www.waymarkedtrails.org" target="_blank">Waymarked Trails</a>',
            },
        },
        layers: [
            {
                id: 'waymarkedTrailsHorseRiding',
                type: 'raster',
                source: 'waymarkedTrailsHorseRiding',
            },
        ],
    },
    waymarkedTrailsWinter: {
        version: 8,
        sources: {
            waymarkedTrailsWinter: {
                type: 'raster',
                tiles: ['https://tile.waymarkedtrails.org/slopes/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 18,
                attribution:
                    '&copy; <a href="https://www.waymarkedtrails.org" target="_blank">Waymarked Trails</a>',
            },
        },
        layers: [
            {
                id: 'waymarkedTrailsWinter',
                type: 'raster',
                source: 'waymarkedTrailsWinter',
            },
        ],
    },
};

export const OVERLAY_METAS: OverlayMeta[] = [
    // Trails & Sports
    { id: 'waymarkedTrailsCycling', label: 'Waymarked Cycling', category: 'trails' },
    { id: 'waymarkedTrailsHiking', label: 'Waymarked Hiking', category: 'trails' },
    { id: 'waymarkedTrailsMTB', label: 'Waymarked MTB', category: 'trails' },
    { id: 'cyclOSMlite', label: 'CyclOSM Lite', category: 'trails' },
    { id: 'bikerouterGravel', label: 'Gravel Roads', category: 'trails' },
    { id: 'waymarkedTrailsWinter', label: 'Winter Slopes', category: 'trails' },
    { id: 'waymarkedTrailsSkating', label: 'Inline Skating', category: 'trails' },
    { id: 'waymarkedTrailsHorseRiding', label: 'Horse Riding', category: 'trails' },

    // Infrastructure & Hillshade
    { id: 'mapterhornHillshade', label: 'Hillshade DEM', category: 'infrastructure' },
    { id: 'openRailwayMap', label: 'OpenRailwayMap', category: 'infrastructure' },

    // Switzerland
    { id: 'swisstopoSlope', label: 'Swisstopo Slope > 30°', category: 'switzerland', defaultOpacity: 0.4 },
    { id: 'swisstopoHiking', label: 'Swisstopo Hiking', category: 'switzerland' },
    { id: 'swisstopoCycling', label: 'Swisstopo Cycling', category: 'switzerland' },
    { id: 'swisstopoMountainBike', label: 'Swisstopo MTB', category: 'switzerland' },
    { id: 'swisstopoSkiTouring', label: 'Swisstopo Ski Touring', category: 'switzerland' },
    { id: 'swisstopoHikingClosures', label: 'Swisstopo Hiking Closures', category: 'switzerland' },
    { id: 'swisstopoCyclingClosures', label: 'Swisstopo Cycling Closures', category: 'switzerland' },
    { id: 'swisstopoMountainBikeClosures', label: 'Swisstopo MTB Closures', category: 'switzerland' },

    // France
    { id: 'ignSlope', label: 'IGN Slopes', category: 'france', defaultOpacity: 0.4 },
    { id: 'ignSkiTouring', label: 'IGN Ski Touring', category: 'france' },
    { id: 'ignFrCadastre', label: 'IGN Cadastre', category: 'france', defaultOpacity: 0.5 },
];
