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
import { deleteFile } from '@/lib/file-actions';
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
    const isDraggingBoxRef = useRef(false);
    const suppressNextClickRef = useRef(false);
    const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLassoActiveRef = useRef(false);
    const [isLassoActive, setIsLassoActive] = useState(false);
    const [lassoConfirmIndices, setLassoConfirmIndices] = useState<number[] | null>(null);
    /** True while Space (temporary map-pan) is held — lasso gestures yield to it. */
    const isSpacePanRef = useRef(false);

    const active = useRoutingStore((s) => s.active);
    const setActive = useRoutingStore((s) => s.setActive);
    const sidebarCollapsed = useRoutingStore((s) => s.sidebarCollapsed);
    const myRoutesOpen = useRoutingStore((s) => s.myRoutesOpen);
    const manualMode = useRoutingStore((s) => s.manualMode);
    const setManualMode = useRoutingStore((s) => s.setManualMode);
    const units = useRoutingStore((s) => s.units);
    const anchorCount = useRoutingStore((s) => s.anchors.length);
    const loadedFileIds = useSelectionStore((state) => state.loadedFileIds);
    const selectedFileId = useSelectionStore((state) => state.selectedFileId);
    const editingFileId = useRoutingStore((s) => s.editingFileId);
    const hasActiveRouteAnchors = useRoutingStore((s) => s.anchors.length >= 2);

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
        gpxLayers.onFileClick = (fileId) => {
            const fileData = fileMapRef.current.get(fileId);
            if (!fileData) return;
            const file = new GPXFile(fileData);
            const trkpts = file.getTrackPoints();
            if (trkpts.length >= 2) {
                const coords = trkpts.map((pt) => pt.getCoordinates());
                useRoutingStore.getState().loadRouteFromPoints(coords, trkpts);
                useRoutingStore.getState().setEditingFileId(fileId);
                useSelectionStore.getState().addLoadedFile(fileId);
                useSelectionStore.getState().selectFile(fileId);
            }
        };
        return () => {
            gpxLayers.onFileClick = null;
        };
    }, []);

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

    const gpxLayerFiles = useMemo(() => {
        if (loadedFileIds.length === 0) return [];
        const idsToRender = new Set(loadedFileIds);
        // If an editing route is actively rendered by routingLayer with nodes, don't duplicate it in gpxLayers
        if (editingFileId && hasActiveRouteAnchors) {
            idsToRender.delete(editingFileId);
        }
        return Array.from(idsToRender)
            .map((id) => ({ fileId: id, file: fileMap.get(id) }))
            .filter((entry): entry is { fileId: string; file: GPXFileType } => !!entry.file);
    }, [loadedFileIds, editingFileId, hasActiveRouteAnchors, fileMap]);

    useEffect(() => {
        gpxLayers.sync(gpxLayerFiles, editingFileId ?? selectedFileId);

        if (
            loadedFileIds.length > prevCountRef.current &&
            !mapManager.hasUserInteracted()
        ) {
            // Pristine hydration/first-import only: fit everything loaded.
            // Once the user has interacted (or explicitly loaded a card, which
            // focuses its own route), never yank the camera to the union fit.
            const allLoadedFiles = loadedFileIds
                .map((id) => ({ fileId: id, file: fileMap.get(id) }))
                .filter((entry): entry is { fileId: string; file: GPXFileType } => !!entry.file);
            const bounds = gpxLayers.getBounds(allLoadedFiles);
            if (bounds) {
                mapManager.fitBounds(bounds, 60, false);
            }
        }
        prevCountRef.current = loadedFileIds.length;
    }, [gpxLayerFiles, editingFileId, selectedFileId, loadedFileIds, fileMap]);

    // Lasso box-select: attach canvas events when lassoMode is active
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let unsubscribe: (() => void) | null = null;

        const onLassoChange = (enabled: boolean) => {
            isLassoActiveRef.current = enabled;
            setIsLassoActive(enabled);
            // When lasso mode is active, disable map dragPan so dragging selects nodes instead of panning map
            const map = mapManager.getMap();
            if (map) {
                if (enabled) {
                    map.dragPan.disable();
                } else {
                    map.dragPan.enable();
                }
            }
            if (!enabled) {
                lassoStartRef.current = null;
                isDraggingBoxRef.current = false;
                suppressNextClickRef.current = false;
                routingLayer.suppressClick = false;
                setLassoRect(null);
            }
        };

        unsubscribe = lassoModeStore.subscribe(onLassoChange);

        const onMouseDown = (e: MouseEvent) => {
            if (!isLassoActiveRef.current || isSpacePanRef.current) return;
            if (e.button !== 0) return;
            // Presses on the route line or its anchor markers belong to the
            // edit interactions (ghost insert / marker drag) — the routing
            // layer intercepts line hits itself; markers handle their own drag.
            const targetEl = e.target as HTMLElement | null;
            if (targetEl && targetEl.closest('.maplibregl-marker')) return;
            // Re-assert disabled pan on every press: marker/ghost drags re-enable
            // dragPan on release, which would make empty-map drags pan AND box-select.
            mapManager.getMap()?.dragPan.disable();
            const rect = container.getBoundingClientRect();
            lassoStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            isDraggingBoxRef.current = false;
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isLassoActiveRef.current || isSpacePanRef.current || !lassoStartRef.current) return;
            const rect = container.getBoundingClientRect();
            const curX = e.clientX - rect.left;
            const curY = e.clientY - rect.top;
            const dx = Math.abs(curX - lassoStartRef.current.x);
            const dy = Math.abs(curY - lassoStartRef.current.y);

            // Once movement exceeds 5px, transition into box selection dragging
            if (!isDraggingBoxRef.current && (dx >= 5 || dy >= 5)) {
                isDraggingBoxRef.current = true;
                suppressNextClickRef.current = true;
                routingLayer.suppressClick = true;
            }

            if (isDraggingBoxRef.current) {
                e.preventDefault();
                e.stopPropagation();
                const x = Math.min(lassoStartRef.current.x, curX);
                const y = Math.min(lassoStartRef.current.y, curY);
                setLassoRect({ x, y, w: dx, h: dy });
            }
        };

        const onMouseUp = (e: MouseEvent) => {
            if (!isLassoActiveRef.current || isSpacePanRef.current || !lassoStartRef.current) return;

            const start = lassoStartRef.current;
            const wasDragging = isDraggingBoxRef.current;

            lassoStartRef.current = null;
            isDraggingBoxRef.current = false;
            setLassoRect(null);

            if (!wasDragging) {
                // User just clicked!
                // Check if they clicked directly on an existing anchor (within 15px radius)
                const map = mapManager.getMap();
                if (map) {
                    const { anchors } = useRoutingStore.getState();
                    const clickedOnAnchor = anchors.some((a) => {
                        const p = map.project([a.lon, a.lat]);
                        return Math.hypot(p.x - start.x, p.y - start.y) <= 15;
                    });
                    if (clickedOnAnchor) {
                        // Suppress duplicate point creation on top of an existing anchor
                        suppressNextClickRef.current = true;
                        routingLayer.suppressClick = true;
                        setTimeout(() => {
                            suppressNextClickRef.current = false;
                            routingLayer.suppressClick = false;
                        }, 100);
                        return;
                    }
                }
                // Allow the click event to add a node to the route!
                suppressNextClickRef.current = false;
                routingLayer.suppressClick = false;
                return;
            }

            // User dragged a selection box!
            // CRITICAL: Suppress click event so release NEVER adds a node to the map!
            e.preventDefault();
            e.stopPropagation();
            suppressNextClickRef.current = true;
            routingLayer.suppressClick = true;
            if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
            suppressTimerRef.current = setTimeout(() => {
                suppressNextClickRef.current = false;
                routingLayer.suppressClick = false;
            }, 250);

            const rect = container.getBoundingClientRect();
            const curX = e.clientX - rect.left;
            const curY = e.clientY - rect.top;
            const x0 = Math.min(start.x, curX);
            const y0 = Math.min(start.y, curY);
            const x1 = Math.max(start.x, curX);
            const y1 = Math.max(start.y, curY);

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

        const onClickCapture = (e: MouseEvent) => {
            if (suppressNextClickRef.current) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                suppressNextClickRef.current = false;
                routingLayer.suppressClick = false;
            }
        };

        container.addEventListener('mousedown', onMouseDown, { capture: true });
        window.addEventListener('mousemove', onMouseMove, { capture: true });
        window.addEventListener('mouseup', onMouseUp, { capture: true });
        container.addEventListener('click', onClickCapture, { capture: true });

        return () => {
            unsubscribe?.();
            if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
            container.removeEventListener('mousedown', onMouseDown, { capture: true });
            window.removeEventListener('mousemove', onMouseMove, { capture: true });
            window.removeEventListener('mouseup', onMouseUp, { capture: true });
            container.removeEventListener('click', onClickCapture, { capture: true });
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
            if (e.key === 'Escape') {
                if (lassoConfirmIndices) {
                    setLassoConfirmIndices(null);
                } else if (isLassoActiveRef.current) {
                    lassoModeStore.set(false);
                }
                return;
            }
            if (e.code !== 'Space') return;
            if (isTargetEditable(e.target)) return;

            // Prevent default page scroll on space
            e.preventDefault();
            if (isSpacePressed) return;
            isSpacePressed = true;
            isSpacePanRef.current = true;
            routingLayer.suppressClick = true;

            // A lasso box drag in progress yields to panning: cancel the box
            if (lassoStartRef.current) {
                lassoStartRef.current = null;
                isDraggingBoxRef.current = false;
                setLassoRect(null);
            }

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
            isSpacePanRef.current = false;
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
                isSpacePanRef.current = false;
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
        mapManager.fitToPlannerRoute();
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
                className={cn('h-full w-full', active && 'route-building-cursor', !sidebarCollapsed && 'sidebar-open', myRoutesOpen && 'my-routes-open', isLassoActive && 'lasso-mode-active')}
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

                {/* 3D toggle button — appearance stays constant, only the label flips */}
                <button
                    onClick={handleToggle3D}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white dark:bg-card text-xs font-black text-foreground shadow-sm transition hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer active:scale-98"
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
                                {anchorCount > 0 && lassoConfirmIndices.length >= anchorCount ? (
                                    <>
                                        <h3 className="text-sm font-bold text-foreground">
                                            {t.confirmDeleteAllLassoTitle}
                                        </h3>
                                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                                            {t.confirmDeleteAllLassoBody}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <h3 className="text-sm font-bold text-foreground">
                                            {t.confirmDeleteLassoTitle.replace('{count}', String(lassoConfirmIndices.length))}
                                        </h3>
                                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                                            {t.confirmDeleteLassoBody}
                                        </p>
                                    </>
                                )}
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
                                    const { removeAnchors, clear, editingFileId } = useRoutingStore.getState();
                                    const currentAnchors = useRoutingStore.getState().anchors;
                                    if (lassoConfirmIndices.length >= currentAnchors.length) {
                                        if (editingFileId) {
                                            void deleteFile(editingFileId);
                                        }
                                        clear();
                                        routingLayer.clear();
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
