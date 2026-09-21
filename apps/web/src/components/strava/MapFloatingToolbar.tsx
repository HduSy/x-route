import { useState, useEffect, useRef } from 'react';
import {
    AlertTriangle,
    ArrowLeftRight,
    Bookmark,
    BookmarkPlus,
    BoxSelect,
    Check,
    ChevronDown,
    Crosshair,
    Layers,
    Loader2,
    Redo2,
    Scissors,
    Sparkles,
    Trash2,
    Undo2,
} from 'lucide-react';
import { useRoutingStore } from '@/store/routing-slice';
import { useSelectionStore } from '@/store/selection-slice';
import { useT } from '@/store/i18n-slice';
import { mapManager } from '@/lib/map/MapManager';
import { routingLayer } from '@/lib/map/routing-layer';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { reverseTrack, simplifyTrack, splitTrackAtMiddle, closeLoop } from '@/lib/file-actions';
import { lassoModeStore } from '@/store/lasso-store';
import { cn } from '@/lib/utils';

export function MapFloatingToolbar() {
    const { t } = useT();

    // Store state
    const anchors = useRoutingStore((s) => s.anchors);
    const resultPoints = useRoutingStore((s) => s.resultPoints);
    const active = useRoutingStore((s) => s.active);
    const undo = useRoutingStore((s) => s.undo);
    const redo = useRoutingStore((s) => s.redo);
    const canUndo = useRoutingStore((s) => s.past.length > 0);
    const canRedo = useRoutingStore((s) => s.future.length > 0);
    const reverseAnchors = useRoutingStore((s) => s.reverseAnchors);
    const clear = useRoutingStore((s) => s.clear);
    const setSaveModalOpen = useRoutingStore((s) => s.setSaveModalOpen);
    const setMyRoutesOpen = useRoutingStore((s) => s.setMyRoutesOpen);
    const sidebarCollapsed = useRoutingStore((s) => s.sidebarCollapsed);
    const selectedFileId = useSelectionStore((s) => s.selectedFileId);

    const [toolsOpen, setToolsOpen] = useState(false);
    const [toolActionStatus, setToolActionStatus] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [lassoMode, setLassoMode] = useState(false);

    const fileCount = useLiveQuery(() => db.fileids.count()) ?? 0;
    const [isLocating, setIsLocating] = useState(false);

    const handleLocateMe = (isManual = false) => {
        if (!('geolocation' in navigator)) return;
        const currentMap = mapManager.getMap();
        if (!currentMap) return;

        // Auto-locate on load should NEVER disrupt an active user who is already drawing a route
        // or interacting with the map.
        const canFly = isManual || (
            !mapManager.hasUserInteracted() &&
            useRoutingStore.getState().anchors.length === 0
        );

        // If we already have a cached location and flying is permitted:
        const existing = mapManager.getUserLocation();
        if (existing) {
            if (canFly) {
                currentMap.flyTo({
                    center: [existing.lon, existing.lat],
                    zoom: Math.max(currentMap.getZoom(), 15),
                    essential: true,
                    duration: 800,
                });
            }
        }

        // Always request the freshest position from navigator.geolocation
        setIsLocating(true);

        const onPositionSuccess = (pos: GeolocationPosition) => {
            const lon = pos.coords.longitude;
            const lat = pos.coords.latitude;
            const map = mapManager.getMap();
            if (!map) {
                setIsLocating(false);
                return;
            }

            mapManager.setUserLocation({ lon, lat });

            // Only fly camera if explicitly clicked by user OR on a pristine first load (no user actions/route)
            const shouldFlyNow = isManual || (
                !mapManager.hasUserInteracted() &&
                useRoutingStore.getState().anchors.length === 0
            );

            if (shouldFlyNow) {
                map.flyTo({
                    center: [lon, lat],
                    zoom: Math.max(map.getZoom(), 15),
                    essential: true,
                    duration: 1000,
                });
            }
            setIsLocating(false);
        };

        const tryLowAccuracy = () => {
            navigator.geolocation.getCurrentPosition(
                onPositionSuccess,
                (err) => {
                    console.warn('Geolocation fallback error:', err);
                    setIsLocating(false);
                },
                { enableHighAccuracy: false, timeout: 6000, maximumAge: 5000 }
            );
        };

        navigator.geolocation.getCurrentPosition(
            onPositionSuccess,
            (err) => {
                console.warn('Geolocation high accuracy error, trying fallback:', err);
                tryLowAccuracy();
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 }
        );
    };

    // Auto-locate user on page load / refresh
    const hasAutoLocatedRef = useRef(false);
    useEffect(() => {
        if (hasAutoLocatedRef.current) return;
        hasAutoLocatedRef.current = true;

        const checkAndLocate = () => {
            const map = mapManager.getMap();
            if (map) {
                mapManager.onReady(() => {
                    handleLocateMe(false);
                });
            } else {
                setTimeout(checkAndLocate, 100);
            }
        };
        checkAndLocate();
    }, []);

    const handleClear = () => {
        setConfirmOpen(true);
    };

    const handleConfirmClear = () => {
        setConfirmOpen(false);
        setLassoMode(false);
        clear();
        routingLayer.clear();
        useSelectionStore.getState().selectFile(null);
    };

    // Sync lassoMode React state → singleton so MapView can subscribe
    useEffect(() => {
        lassoModeStore.set(lassoMode);
    }, [lassoMode]);

    // Exit lasso mode when routing becomes inactive
    useEffect(() => {
        if (!active) setLassoMode(false);
    }, [active]);

    const handleTrackAction = async (name: string, fn: () => Promise<void>) => {
        try {
            await fn();
            setToolActionStatus(name);
            setTimeout(() => setToolActionStatus(null), 1500);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div
            className={cn(
                'pointer-events-none absolute right-2 top-2 sm:right-3 sm:top-3 z-10 flex items-center justify-between select-none transition-[left] duration-200 ease-in-out',
                sidebarCollapsed ? 'left-2 sm:left-3' : 'left-2 sm:left-[332px]'
            )}
        >
            {/* Left toolbar group */}
            <div className="pointer-events-auto flex items-center gap-1 sm:gap-2">
                {/* Navigation / Action buttons card */}
                <div className="flex h-8 sm:h-9 items-center gap-0.5 rounded-lg border border-border bg-white dark:bg-card p-0.5 sm:p-1 shadow-sm">
                    <button
                        onClick={() => handleLocateMe(true)}
                        className="flex size-6 sm:size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] transition cursor-pointer"
                        title={t.locateMe}
                    >
                        {isLocating ? (
                            <Loader2 className="size-3.5 sm:size-4 animate-spin text-[#863BFF]" />
                        ) : (
                            <Crosshair className="size-3.5 sm:size-4" />
                        )}
                    </button>
                    <div className="h-3.5 sm:h-4 w-px bg-border mx-0.5" />
                    <button
                        onClick={reverseAnchors}
                        disabled={anchors.length < 2}
                        className="flex size-6 sm:size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] hover:text-[#863BFF] disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
                        title={t.reverseRoute}
                    >
                        <ArrowLeftRight className="size-3.5 sm:size-4" />
                    </button>
                    <button
                        onClick={undo}
                        disabled={!canUndo}
                        className="flex size-6 sm:size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] hover:text-[#863BFF] disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
                        title={t.undo}
                    >
                        <Undo2 className="size-3.5 sm:size-4" />
                    </button>
                    <button
                        onClick={redo}
                        disabled={!canRedo}
                        className="flex size-6 sm:size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] hover:text-[#863BFF] disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
                        title={t.redo}
                    >
                        <Redo2 className="size-3.5 sm:size-4" />
                    </button>
                    <div className="h-3.5 sm:h-4 w-px bg-border mx-0.5" />
                    <button
                        onClick={handleClear}
                        disabled={anchors.length === 0}
                        className="flex size-6 sm:size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-destructive disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
                        title={t.clearRoute}
                    >
                        <Trash2 className="size-3.5 sm:size-4" />
                    </button>
                    {active && (
                        <>
                            <div className="h-3.5 sm:h-4 w-px bg-border mx-0.5" />
                            <button
                                onClick={() => setLassoMode((m) => !m)}
                                className={cn(
                                    'flex size-6 sm:size-7 items-center justify-center rounded-md transition cursor-pointer',
                                    lassoMode
                                        ? 'bg-[#863BFF]/15 text-[#863BFF]'
                                        : 'text-muted-foreground hover:bg-[#F5F0FF] hover:text-[#863BFF]'
                                )}
                                title={t.lassoMode}
                            >
                                <BoxSelect className="size-3.5 sm:size-4" />
                            </button>
                        </>
                    )}
                </div>

                {/* Track Tools Dropdown (Segments / Editing) placed to the left of Save Route */}
                <div className="relative">
                    <button
                        onClick={() => setToolsOpen(!toolsOpen)}
                        className="flex h-8 sm:h-9 items-center gap-1 sm:gap-1.5 rounded-lg border border-border bg-white dark:bg-card px-2 sm:px-3 text-xs font-semibold text-foreground shadow-sm transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:border-[#863BFF] hover:text-[#863BFF] cursor-pointer"
                        title={t.segments}
                    >
                        <Layers className="size-3.5 text-muted-foreground" />
                        <span className="hidden md:inline">{t.segments}</span>
                        <ChevronDown className="size-3 text-muted-foreground hidden md:inline" />
                    </button>

                    {toolsOpen && (
                        <div className="absolute left-0 top-10 sm:top-11 z-50 min-w-48 rounded-lg border border-border bg-white dark:bg-card p-1 shadow-lg">
                            <button
                                disabled={!selectedFileId}
                                onClick={() =>
                                    selectedFileId &&
                                    handleTrackAction('reversed', () => reverseTrack(selectedFileId))
                                }
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                            >
                                <ArrowLeftRight className="size-3.5 text-muted-foreground" />
                                <span>{t.reverse}</span>
                                {toolActionStatus === 'reversed' && <Check className="ml-auto size-3 text-green-600" />}
                            </button>
                            <button
                                disabled={!selectedFileId}
                                onClick={() =>
                                    selectedFileId &&
                                    handleTrackAction('simplified', () => simplifyTrack(selectedFileId))
                                }
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                            >
                                <Sparkles className="size-3.5 text-muted-foreground" />
                                <span>{t.simplify}</span>
                                {toolActionStatus === 'simplified' && <Check className="ml-auto size-3 text-green-600" />}
                            </button>
                            <button
                                disabled={!selectedFileId}
                                onClick={() =>
                                    selectedFileId &&
                                    handleTrackAction('split', () => splitTrackAtMiddle(selectedFileId))
                                }
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                            >
                                <Scissors className="size-3.5 text-muted-foreground" />
                                <span>{t.split}</span>
                                {toolActionStatus === 'split' && <Check className="ml-auto size-3 text-green-600" />}
                            </button>
                            <button
                                disabled={!selectedFileId}
                                onClick={() =>
                                    selectedFileId &&
                                    handleTrackAction('loop', () => closeLoop(selectedFileId))
                                }
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                            >
                                <Check className="size-3.5 text-muted-foreground" />
                                <span>{t.loop}</span>
                                {toolActionStatus === 'loop' && <Check className="ml-auto size-3 text-green-600" />}
                            </button>
                        </div>
                    )}
                </div>

                {/* Save Route Button */}
                <button
                    onClick={() => setSaveModalOpen(true)}
                    disabled={resultPoints.length < 2}
                    className={cn(
                        'group flex h-8 sm:h-9 items-center gap-1.5 rounded-lg px-2.5 sm:px-4 text-xs font-bold tracking-tight transition-all duration-150 select-none',
                        resultPoints.length >= 2
                            ? 'bg-[#863BFF] text-white shadow-sm hover:bg-[#7424F8] hover:shadow-md active:scale-98 active:bg-[#6517EA] cursor-pointer'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700 cursor-not-allowed shadow-none opacity-100'
                    )}
                    title={t.saveRoute}
                >
                    <BookmarkPlus
                        className={cn(
                            'size-3.5 sm:size-4 stroke-[2.2]',
                            resultPoints.length >= 2 && 'transition-transform group-hover:scale-110'
                        )}
                    />
                    <span className="hidden sm:inline">{t.saveRoute}</span>
                </button>
            </div>

            {/* Right side: My Routes button (Solid opaque, never transparent on hover) */}
            <div className="pointer-events-auto flex items-center gap-2">
                <button
                    onClick={() => setMyRoutesOpen(true)}
                    className="group flex h-8 sm:h-9 items-center gap-1.5 sm:gap-2 rounded-lg border border-border bg-white dark:bg-card px-2.5 sm:px-3.5 text-xs font-bold tracking-tight text-foreground shadow-sm transition-all duration-150 hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:border-[#863BFF] hover:text-[#863BFF] hover:shadow-md cursor-pointer active:scale-98"
                    title={t.myRoutes}
                >
                    <Bookmark className="size-3.5 sm:size-4 text-[#863BFF] transition-transform group-hover:scale-110" />
                    <span className="hidden sm:inline">{t.myRoutes}</span>
                    {fileCount > 0 && (
                        <span className="rounded-full bg-[#863BFF]/15 px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-black text-[#863BFF]">
                            {fileCount}
                        </span>
                    )}
                </button>
            </div>

            {/* Confirm clear dialog */}
            {confirmOpen && (
                <div className="pointer-events-auto fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                    <div className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-white dark:bg-card p-6 shadow-2xl">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                                <AlertTriangle className="size-5 text-destructive" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-foreground">{t.confirmClearTitle}</h3>
                                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{t.confirmClearBody}</p>
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                onClick={() => setConfirmOpen(false)}
                                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                            >
                                {t.cancel}
                            </button>
                            <button
                                onClick={handleConfirmClear}
                                className="rounded-lg bg-destructive px-4 py-2 text-xs font-bold text-white hover:bg-red-600 transition cursor-pointer"
                            >
                                {t.confirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
