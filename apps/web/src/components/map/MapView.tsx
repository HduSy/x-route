import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Popup as MapLibrePopup, type MapMouseEvent } from 'maplibre-gl';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Check, Compass, Focus, Layers, Minus, Plus, Route, Spline } from 'lucide-react';
import { GPXFile, type GPXFileType } from '@x-route/gpx';
import { db, type StoredGPXFile } from '@/lib/db';
import { BASEMAPS, mapManager, type BasemapKey } from '@/lib/map/MapManager';
import { gpxLayers } from '@/lib/map/gpx-layer';
import { routingLayer } from '@/lib/map/routing-layer';
import { lassoModeStore } from '@/store/lasso-store';
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
    const layerPopoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!basemapOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (layerPopoverRef.current && !layerPopoverRef.current.contains(e.target as Node)) {
                setBasemapOpen(false);
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => window.removeEventListener('mousedown', handleClickOutside);
    }, [basemapOpen]);

    const [lassoRect, setLassoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const lassoStartRef = useRef<{ x: number; y: number } | null>(null);
    const isLassoActiveRef = useRef(false);
    const [lassoConfirmIndices, setLassoConfirmIndices] = useState<number[] | null>(null);

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
            // Only auto-fit while the viewport is still pristine (hydration /
            // first import). Never yank the camera away from a user who is
            // inspecting their route or actively creating one.
            if (bounds && !mapManager.hasUserInteracted() && useRoutingStore.getState().anchors.length === 0) {
                mapManager.fitBounds(bounds, 60, true);
            }
        }
        prevCountRef.current = layerFiles.length;
    }, [fileIds, fileMap, selectedFileId]);

    // Lasso box-select: attach canvas events when lassoMode is active
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let unsubscribe: (() => void) | null = null;

        const onLassoChange = (enabled: boolean) => {
            isLassoActiveRef.current = enabled;
            // Toggle MapLibre's built-in drag-pan when lasso is active
            const map = mapManager.getMap();
            if (map) {
                if (enabled) {
                    map.dragPan.disable();
                } else {
                    map.dragPan.enable();
                }
            }
        };

        unsubscribe = lassoModeStore.subscribe(onLassoChange);

        const onMouseDown = (e: MouseEvent) => {
            if (!isLassoActiveRef.current || routingLayer.suppressClick) return;
            // Only left-button and only on map canvas itself
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = container.getBoundingClientRect();
            lassoStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            setLassoRect({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0 });
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isLassoActiveRef.current || !lassoStartRef.current) return;
            const rect = container.getBoundingClientRect();
            const curX = e.clientX - rect.left;
            const curY = e.clientY - rect.top;
            const x = Math.min(lassoStartRef.current.x, curX);
            const y = Math.min(lassoStartRef.current.y, curY);
            const w = Math.abs(curX - lassoStartRef.current.x);
            const h = Math.abs(curY - lassoStartRef.current.y);
            setLassoRect({ x, y, w, h });
        };

        const onMouseUp = (e: MouseEvent) => {
            if (!isLassoActiveRef.current || !lassoStartRef.current) return;
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            const curX = e.clientX - rect.left;
            const curY = e.clientY - rect.top;
            const x0 = Math.min(lassoStartRef.current.x, curX);
            const y0 = Math.min(lassoStartRef.current.y, curY);
            const x1 = Math.max(lassoStartRef.current.x, curX);
            const y1 = Math.max(lassoStartRef.current.y, curY);

            lassoStartRef.current = null;
            setLassoRect(null);

            // Only proceed if the box has a meaningful size (not just a click)
            if (x1 - x0 < 5 || y1 - y0 < 5) return;

            const map = mapManager.getMap();
            if (!map) return;

            // Project anchors to screen pixel space (handles rotation, pitch, and road snapping accurately)
            const { anchors, resultPoints } = useRoutingStore.getState();
            const toRemove: number[] = [];
            const MARGIN = 12;

            for (let i = 0; i < anchors.length; i++) {
                const a = anchors[i]!;
                const p = map.project([a.lon, a.lat]);
                let inside = (
                    p.x >= x0 - MARGIN &&
                    p.x <= x1 + MARGIN &&
                    p.y >= y0 - MARGIN &&
                    p.y <= y1 + MARGIN
                );

                // Also check road-snapped position for start and end markers
                if (!inside && resultPoints.length > 0) {
                    if (i === 0) {
                        const first = resultPoints[0]!;
                        const pStart = map.project([first.attributes.lon, first.attributes.lat]);
                        if (
                            pStart.x >= x0 - MARGIN &&
                            pStart.x <= x1 + MARGIN &&
                            pStart.y >= y0 - MARGIN &&
                            pStart.y <= y1 + MARGIN
                        ) {
                            inside = true;
                        }
                    } else if (i === anchors.length - 1 && anchors.length > 1) {
                        const last = resultPoints[resultPoints.length - 1]!;
                        const pEnd = map.project([last.attributes.lon, last.attributes.lat]);
                        if (
                            pEnd.x >= x0 - MARGIN &&
                            pEnd.x <= x1 + MARGIN &&
                            pEnd.y >= y0 - MARGIN &&
                            pEnd.y <= y1 + MARGIN
                        ) {
                            inside = true;
                        }
                    }
                }

                if (inside) {
                    toRemove.push(i);
                }
            }

            if (toRemove.length > 0) {
                setLassoConfirmIndices(toRemove);
            }
        };

        container.addEventListener('mousedown', onMouseDown, { capture: true });
        container.addEventListener('mousemove', onMouseMove, { capture: true });
        container.addEventListener('mouseup', onMouseUp, { capture: true });

        return () => {
            unsubscribe?.();
            container.removeEventListener('mousedown', onMouseDown, { capture: true });
            container.removeEventListener('mousemove', onMouseMove, { capture: true });
            container.removeEventListener('mouseup', onMouseUp, { capture: true });
            // Always re-enable drag pan on cleanup
            mapManager.getMap()?.dragPan.enable();
        };
    }, []);

    // Space-bar drag to pan: turns cursor into grab hand and drags the map
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let isSpacePressed = false;
        let isMouseDown = false;

        const isTargetEditable = (target: EventTarget | null) => {
            if (!target || !(target instanceof HTMLElement)) return false;
            const tag = target.tagName.toLowerCase();
            return tag === 'input' || tag === 'textarea' || target.isContentEditable;
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code !== 'Space') return;
            if (isTargetEditable(e.target)) return;

            // Prevent default page scroll on space
            e.preventDefault();
            if (isSpacePressed) return;
            isSpacePressed = true;
            routingLayer.suppressClick = true;

            container.classList.add('space-pan-active');
            const map = mapManager.getMap();
            if (map && !map.dragPan.isEnabled()) {
                map.dragPan.enable();
            }
        };

        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code !== 'Space') return;
            if (isTargetEditable(e.target)) return;

            isSpacePressed = false;
            container.classList.remove('space-pan-active', 'space-pan-dragging');

            const map = mapManager.getMap();
            if (map && isLassoActiveRef.current) {
                map.dragPan.disable();
            }

            // Keep suppressing map click for a brief moment after space is released
            setTimeout(() => {
                if (!isSpacePressed) {
                    routingLayer.suppressClick = false;
                }
            }, 120);
        };

        const onMouseDown = (e: MouseEvent) => {
            if (isSpacePressed && e.button === 0) {
                isMouseDown = true;
                container.classList.add('space-pan-dragging');
            }
        };

        const onMouseUp = () => {
            if (isMouseDown) {
                isMouseDown = false;
                container.classList.remove('space-pan-dragging');
            }
        };

        const onBlur = () => {
            if (isSpacePressed) {
                isSpacePressed = false;
                isMouseDown = false;
                container.classList.remove('space-pan-active', 'space-pan-dragging');
                const map = mapManager.getMap();
                if (map && isLassoActiveRef.current) {
                    map.dragPan.disable();
                }
                routingLayer.suppressClick = false;
            }
        };

        window.addEventListener('keydown', onKeyDown, { capture: true });
        window.addEventListener('keyup', onKeyUp, { capture: true });
        window.addEventListener('mousedown', onMouseDown, { capture: true });
        window.addEventListener('mouseup', onMouseUp, { capture: true });
        window.addEventListener('blur', onBlur);

        return () => {
            window.removeEventListener('keydown', onKeyDown, { capture: true });
            window.removeEventListener('keyup', onKeyUp, { capture: true });
            window.removeEventListener('mousedown', onMouseDown, { capture: true });
            window.removeEventListener('mouseup', onMouseUp, { capture: true });
            window.removeEventListener('blur', onBlur);
            routingLayer.suppressClick = false;
        };
    }, []);


    const handleZoomIn = () => mapManager.getMap()?.zoomIn();
    const handleZoomOut = () => mapManager.getMap()?.zoomOut();
    const handleResetCompass = () => {
        const map = mapManager.getMap();
        map?.resetNorthPitch({ duration: 600 });
        setBearing(0);
    };
    const handleFitRoute = () => {
        const map = mapManager.getMap();
        if (!map) return;
        const resultPoints = useRoutingStore.getState().resultPoints;
        const anchors = useRoutingStore.getState().anchors;

        if (resultPoints.length >= 2) {
            let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
            for (const pt of resultPoints) {
                const lon = pt.attributes.lon;
                const lat = pt.attributes.lat;
                if (lon < minLon) minLon = lon;
                if (lat < minLat) minLat = lat;
                if (lon > maxLon) maxLon = lon;
                if (lat > maxLat) maxLat = lat;
            }
            mapManager.fitBounds([minLon, minLat, maxLon, maxLat], 80);
        } else if (anchors.length > 0) {
            let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
            for (const a of anchors) {
                if (a.lon < minLon) minLon = a.lon;
                if (a.lat < minLat) minLat = a.lat;
                if (a.lon > maxLon) maxLon = a.lon;
                if (a.lat > maxLat) maxLat = a.lat;
            }
            if (minLon === maxLon && minLat === maxLat) {
                map.flyTo({ center: [minLon, minLat], zoom: 15, duration: 600 });
            } else {
                mapManager.fitBounds([minLon, minLat, maxLon, maxLat], 80);
            }
        }
    };
    const handleToggle3D = () => {
        const map = mapManager.getMap();
        if (!map) return;
        if (is3D) {
            map.dragRotate.disable();
            map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
            setIs3D(false);
            setBearing(0);
        } else {
            map.dragRotate.enable();
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

            {/* Lasso selection rectangle overlay */}
            {lassoRect && lassoRect.w > 2 && lassoRect.h > 2 && (
                <div
                    className="pointer-events-none absolute z-20"
                    style={{
                        left: lassoRect.x,
                        top: lassoRect.y,
                        width: lassoRect.w,
                        height: lassoRect.h,
                        border: '2px dashed #863BFF',
                        background: 'rgba(134,59,255,0.08)',
                        borderRadius: '3px',
                    }}
                />
            )}

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
                            ? t.manualModeActive
                            : t.manualModeInactive
                    }
                >
                    <Spline className="size-4" />
                </button>
                <div className="h-px w-full bg-border" />
                <button
                    onClick={handleZoomIn}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] transition cursor-pointer"
                    title={t.zoomIn}
                >
                    <Plus className="size-4" />
                </button>
                <button
                    onClick={handleZoomOut}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] transition cursor-pointer"
                    title={t.zoomOut}
                >
                    <Minus className="size-4" />
                </button>
                <div className="h-px w-full bg-border" />
                <button
                    onClick={handleFitRoute}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] transition cursor-pointer"
                    title={t.fitRoute}
                >
                    <Focus className="size-4" />
                </button>
                <button
                    onClick={handleResetCompass}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] transition cursor-pointer"
                    title={t.resetNorth}
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
                        <div
                            ref={layerPopoverRef}
                            className="absolute bottom-10 left-0 z-50 min-w-44 max-h-[380px] overflow-y-auto rounded-xl border border-border bg-white dark:bg-card p-1 shadow-xl animate-in fade-in zoom-in-95"
                        >
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
                                            'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition cursor-pointer',
                                            isCurrent
                                                ? 'bg-[#863BFF]/10 font-bold text-[#863BFF]'
                                                : 'hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] text-foreground'
                                        )}
                                    >
                                        <span>
                                            {t.basemaps[key as keyof typeof t.basemaps] ??
                                                BASEMAPS[key].label}
                                        </span>
                                        {isCurrent && <Check className="size-3.5 text-[#863BFF] stroke-[3]" />}
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
                    title={t.toggle3D}
                >
                    {is3D ? '2D' : '3D'}
                </button>
            </div>

            {popupFile && popupContainerRef.current
                ? createPortal(<TrackPopupContent file={popupFile} />, popupContainerRef.current)
                : null}

            {/* Lasso delete confirmation modal */}
            {lassoConfirmIndices && (
                <div className="pointer-events-auto fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                    <div className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-white dark:bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                                <AlertTriangle className="size-5 text-destructive" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-foreground">
                                    {t.confirmDeleteLassoTitle.replace('{count}', String(lassoConfirmIndices.length))}
                                </h3>
                                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                                    {t.confirmDeleteLassoBody}
                                </p>
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                onClick={() => setLassoConfirmIndices(null)}
                                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                            >
                                {t.cancel}
                            </button>
                            <button
                                onClick={() => {
                                    const { removeAnchors, clear } = useRoutingStore.getState();
                                    const currentAnchors = useRoutingStore.getState().anchors;
                                    if (lassoConfirmIndices.length >= currentAnchors.length) {
                                        clear();
                                    } else {
                                        removeAnchors(lassoConfirmIndices);
                                    }
                                    setLassoConfirmIndices(null);
                                }}
                                className="rounded-lg bg-destructive px-4 py-2 text-xs font-bold text-white hover:bg-red-600 transition cursor-pointer"
                            >
                                {t.delete}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
