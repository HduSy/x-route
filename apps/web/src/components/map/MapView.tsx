import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Popup as MapLibrePopup, type MapMouseEvent } from 'maplibre-gl';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Compass, Layers, Minus, Plus, Route, Spline } from 'lucide-react';
import { GPXFile, type GPXFileType } from '@x-route/gpx';
import { db, type StoredGPXFile } from '@/lib/db';
import { BASEMAPS, mapManager, type BasemapKey } from '@/lib/map/MapManager';
import { gpxLayers } from '@/lib/map/gpx-layer';
import { routingLayer } from '@/lib/map/routing-layer';
import { useSelectionStore } from '@/store/selection-slice';
import { useRoutingStore } from '@/store/routing-slice';
import { useRoutingSync } from '@/hooks/use-routing-sync';
import { useT } from '@/store/i18n-slice';
import { cn } from '@/lib/utils';

// --- Track info popup bridged into MapLibre's DOM via createPortal (AD-6) ---

function TrackPopupContent({ file }: { file: GPXFileType }) {
    const { t } = useT();
    const { global } = useMemo(() => new GPXFile(file).getStatistics(), [file]);
    return (
        <div className="space-y-0.5 text-sm">
            <div className="font-semibold">{file.metadata?.name ?? t.untitled}</div>
            <div className="text-muted-foreground">
                {global.distance.total.toFixed(1)} km · ↑{Math.round(global.elevation.gain)} m
            </div>
        </div>
    );
}

const EMPTY_IDS: string[] = [];

export function MapView() {
    useRoutingSync();
    const { t } = useT();
    const containerRef = useRef<HTMLDivElement>(null);
    const popupContainerRef = useRef<HTMLDivElement | null>(null);
    const popupRef = useRef<MapLibrePopup | null>(null);
    const fileMapRef = useRef<Map<string, GPXFileType>>(new Map());
    const prevCountRef = useRef(0);
    const [popupFile, setPopupFile] = useState<GPXFileType | null>(null);
    const [is3D, setIs3D] = useState(false);
    const [bearing, setBearing] = useState(0);
    const [basemapOpen, setBasemapOpen] = useState(false);

    const active = useRoutingStore((s) => s.active);
    const setActive = useRoutingStore((s) => s.setActive);
    const sidebarCollapsed = useRoutingStore((s) => s.sidebarCollapsed);
    const manualMode = useRoutingStore((s) => s.manualMode);
    const setManualMode = useRoutingStore((s) => s.setManualMode);
    const units = useRoutingStore((s) => s.units);
    const selectedFileId = useSelectionStore((state) => state.selectedFileId);
    const selectFile = useSelectionStore((state) => state.selectFile);

    const fileIds = useLiveQuery(() => db.fileids.toArray()) ?? EMPTY_IDS;
    const files = useLiveQuery(() => db.files.toArray());
    const fileMap = useMemo(() => {
        const map = new Map<string, GPXFileType>();
        for (const file of files ?? []) {
            const id = (file as StoredGPXFile)._data?.id;
            if (typeof id === 'string') map.set(id, file);
        }
        return map;
    }, [files]);

    useEffect(() => {
        fileMapRef.current = fileMap;
    }, [fileMap]);

    useEffect(() => {
        gpxLayers.onFileClick = (fileId) => selectFile(fileId);
        return () => {
            gpxLayers.onFileClick = null;
        };
    }, [selectFile]);

    useEffect(() => {
        if (!containerRef.current) return;
        const map = mapManager.init(containerRef.current);
        routingLayer.wire(map);
        const unwireStyleReload = mapManager.onStyleReload(() => {
            gpxLayers.resync();
            routingLayer.resync();
        });

        const popup = new MapLibrePopup({ closeButton: false, offset: 8 });
        const popupContainer = document.createElement('div');
        popupContainerRef.current = popupContainer;
        popupRef.current = popup;

        const onRotate = () => {
            setBearing(map.getBearing());
        };
        map.on('rotate', onRotate);

        const onMapClick = (e: MapMouseEvent) => {
            if (useRoutingStore.getState().active) return;
            const layerIds = gpxLayers.getLayerIds().filter((id) => map.getLayer(id));
            const features = layerIds.length
                ? map.queryRenderedFeatures(e.point, { layers: layerIds })
                : [];
            const fileId = features[0]?.properties?.fileId as string | undefined;
            const file = fileId ? fileMapRef.current.get(fileId) : undefined;
            if (file) {
                setPopupFile(file);
                popup.setLngLat(e.lngLat).setDOMContent(popupContainer).addTo(map);
            }
        };
        map.on('click', onMapClick);

        return () => {
            unwireStyleReload();
            map.off('rotate', onRotate);
            map.off('click', onMapClick);
            popup.remove();
            popupRef.current = null;
            popupContainerRef.current = null;
            routingLayer.unwire();
            mapManager.destroy();
        };
    }, []);

    useEffect(() => {
        mapManager.setScaleUnit(units === 'mi' ? 'imperial' : 'metric');
    }, [units]);

    useEffect(() => {
        const layerFiles = fileIds
            .map((id) => ({ fileId: id, file: fileMap.get(id) }))
            .filter((entry): entry is { fileId: string; file: GPXFileType } => !!entry.file);
        gpxLayers.sync(layerFiles, selectedFileId);

        if (layerFiles.length > prevCountRef.current) {
            const bounds = gpxLayers.getBounds(layerFiles);
            if (bounds) mapManager.fitBounds(bounds);
        }
        prevCountRef.current = layerFiles.length;
    }, [fileIds, fileMap, selectedFileId]);

    // Zoom & 3D handlers
    const handleZoomIn = () => mapManager.getMap()?.zoomIn();
    const handleZoomOut = () => mapManager.getMap()?.zoomOut();
    const handleResetCompass = () => {
        const map = mapManager.getMap();
        map?.resetNorthPitch({ duration: 600 });
        setBearing(0);
    };
    const handleToggle3D = () => {
        const map = mapManager.getMap();
        if (!map) return;
        if (is3D) {
            map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
            setIs3D(false);
            setBearing(0);
        } else {
            map.easeTo({ pitch: 60, bearing: -20, duration: 600 });
            setIs3D(true);
            setBearing(-20);
        }
    };

    return (
        <div className="relative h-full w-full">
            <div
                ref={containerRef}
                className={cn('h-full w-full', active && 'route-building-cursor', !sidebarCollapsed && 'sidebar-open')}
            />

            {/* Strava style Vertical Map Controls (Draw mode, Zoom in, Zoom out, Compass) */}
            <div
                className={cn(
                    'absolute top-13 sm:top-16 z-10 flex flex-col gap-1 rounded-lg border border-border bg-white dark:bg-card p-1 shadow-sm select-none transition-[left] duration-200 ease-in-out',
                    sidebarCollapsed ? 'left-2 sm:left-3' : 'left-2 sm:left-[332px]'
                )}
            >
                {/* Route planning / creation mode toggle */}
                <button
                    onClick={() => setActive(!active)}
                    className={cn(
                        'flex size-7 items-center justify-center rounded-md transition cursor-pointer',
                        active
                            ? 'bg-[#863BFF] text-white shadow-xs'
                            : 'text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF]'
                    )}
                    title={
                        active
                            ? t.drawRouteTooltipActive
                            : t.drawRouteTooltipInactive
                    }
                >
                    <Route className="size-4" />
                </button>

                {/* Manual straight line drawing mode toggle */}
                <button
                    onClick={() => setManualMode(!manualMode)}
                    className={cn(
                        'flex size-7 items-center justify-center rounded-md transition cursor-pointer',
                        manualMode
                            ? 'bg-[#863BFF] text-white shadow-xs'
                            : 'text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF]'
                    )}
                    title={
                        manualMode
                            ? t.manualMode + ' (Active)'
                            : t.manualMode + ' (Click to draw manual straight lines)'
                    }
                >
                    <Spline className="size-4" />
                </button>
                <div className="h-px w-full bg-border" />
                <button
                    onClick={handleZoomIn}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] transition cursor-pointer"
                    title="Zoom in"
                >
                    <Plus className="size-4" />
                </button>
                <button
                    onClick={handleZoomOut}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] transition cursor-pointer"
                    title="Zoom out"
                >
                    <Minus className="size-4" />
                </button>
                <div className="h-px w-full bg-border" />
                <button
                    onClick={handleResetCompass}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] transition cursor-pointer"
                    title="Reset bearing to North"
                >
                    <Compass
                        className="size-4 transition-transform duration-75"
                        style={{ transform: `rotate(${-bearing}deg)` }}
                    />
                </button>
            </div>

            {/* Bottom-left Map Style & 3D Controls (Stacked neatly above the scale bar) */}
            <div
                className={cn(
                    'absolute bottom-8 sm:bottom-9 z-10 flex flex-col gap-1 select-none transition-[left] duration-200 ease-in-out',
                    sidebarCollapsed ? 'left-2 sm:left-3' : 'left-2 sm:left-[332px]'
                )}
            >
                {/* Basemap selector popover button */}
                <div className="relative">
                    <button
                        onClick={() => setBasemapOpen(!basemapOpen)}
                        className={cn(
                            'flex size-8 items-center justify-center rounded-lg border border-border bg-white dark:bg-card shadow-sm transition hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer',
                            basemapOpen ? 'border-[#863BFF] text-[#863BFF]' : 'text-muted-foreground'
                        )}
                        title={t.basemap}
                    >
                        <Layers className="size-4" />
                    </button>
                    {basemapOpen && (
                        <div className="absolute bottom-10 left-0 z-50 min-w-40 rounded-lg border border-border bg-white dark:bg-card p-1 shadow-xl animate-in fade-in zoom-in-95">
                            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                {t.basemap}
                            </div>
                            {(Object.keys(BASEMAPS) as BasemapKey[]).map((key) => {
                                const isCurrent = mapManager.getBasemap() === key;
                                return (
                                    <button
                                        key={key}
                                        onClick={() => {
                                            mapManager.setBasemap(key);
                                            setBasemapOpen(false);
                                        }}
                                        className={cn(
                                            'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition cursor-pointer',
                                            isCurrent
                                                ? 'bg-[#863BFF]/10 font-bold text-[#863BFF]'
                                                : 'hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] text-foreground'
                                        )}
                                    >
                                        <span>
                                            {t.basemaps[key as keyof typeof t.basemaps] ??
                                                BASEMAPS[key].label}
                                        </span>
                                        {isCurrent && <Check className="size-3 text-[#863BFF]" />}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* 3D toggle button */}
                <button
                    onClick={handleToggle3D}
                    className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white dark:bg-card text-xs font-black shadow-sm transition hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer active:scale-98',
                        is3D ? 'bg-[#863BFF]/15 text-[#863BFF] border-[#863BFF]' : 'text-foreground'
                    )}
                    title="Toggle 2D / 3D tilt"
                >
                    {is3D ? '2D' : '3D'}
                </button>
            </div>

            {popupFile && popupContainerRef.current
                ? createPortal(<TrackPopupContent file={popupFile} />, popupContainerRef.current)
                : null}
        </div>
    );
}
