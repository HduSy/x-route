import { useState, useEffect, useRef } from 'react';
import {
    ArrowLeftRight,
    Bookmark,
    BookmarkPlus,
    Check,
    ChevronDown,
    Crosshair,
    Flame,
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
import { BASEMAPS, mapManager, type BasemapKey } from '@/lib/map/MapManager';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { reverseTrack, simplifyTrack, splitTrackAtMiddle, closeLoop } from '@/lib/file-actions';
import { cn } from '@/lib/utils';

export function MapFloatingToolbar() {
    const { t } = useT();

    // Store state
    const anchors = useRoutingStore((s) => s.anchors);
    const resultPoints = useRoutingStore((s) => s.resultPoints);
    const undo = useRoutingStore((s) => s.undo);
    const redo = useRoutingStore((s) => s.redo);
    const canUndo = useRoutingStore((s) => s.past.length > 0);
    const canRedo = useRoutingStore((s) => s.future.length > 0);
    const reverseAnchors = useRoutingStore((s) => s.reverseAnchors);
    const clear = useRoutingStore((s) => s.clear);
    const setSaveModalOpen = useRoutingStore((s) => s.setSaveModalOpen);
    const setMyRoutesOpen = useRoutingStore((s) => s.setMyRoutesOpen);
    const selectedFileId = useSelectionStore((s) => s.selectedFileId);

    const [basemapOpen, setBasemapOpen] = useState(false);
    const [currentBasemap, setCurrentBasemap] = useState<BasemapKey>('liberty');
    const [toolsOpen, setToolsOpen] = useState(false);
    const [toolActionStatus, setToolActionStatus] = useState<string | null>(null);

    const fileCount = useLiveQuery(() => db.fileids.count()) ?? 0;
    const [isLocating, setIsLocating] = useState(false);
    const [isLocated, setIsLocated] = useState(false);

    const handleLocateMe = () => {
        if (!('geolocation' in navigator)) return;
        const existing = mapManager.getUserLocation();
        const map = mapManager.getMap();

        if (isLocated && existing && map) {
            // Already located once, re-center smoothly
            map.flyTo({
                center: [existing.lon, existing.lat],
                zoom: 15,
                essential: true,
                duration: 1000,
            });
            return;
        }

        setIsLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lon = pos.coords.longitude;
                const lat = pos.coords.latitude;
                const currentMap = mapManager.getMap();

                if (!currentMap) {
                    setIsLocating(false);
                    return;
                }

                // Fly to target position first — DO NOT show the breathing marker until arrival
                currentMap.flyTo({
                    center: [lon, lat],
                    zoom: 15,
                    essential: true,
                    duration: 1200,
                });

                // ONLY once the map arrives at user position, spawn the breathing dot!
                let settled = false;
                const onSettle = () => {
                    if (settled) return;
                    settled = true;
                    currentMap.off('moveend', onSettle);
                    mapManager.setUserLocation({ lon, lat });
                    setIsLocating(false);
                    setIsLocated(true);
                };
                currentMap.once('moveend', onSettle);
                setTimeout(onSettle, 1400); // Safety fallback
            },
            (err) => {
                console.warn('Geolocation error:', err);
                setIsLocating(false);
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    };

    // Auto-locate user on initial page open
    const hasAutoLocatedRef = useRef(false);
    useEffect(() => {
        if (hasAutoLocatedRef.current) return;
        hasAutoLocatedRef.current = true;

        const checkAndLocate = () => {
            const map = mapManager.getMap();
            if (map) {
                mapManager.onReady(() => {
                    handleLocateMe();
                });
            } else {
                setTimeout(checkAndLocate, 100);
            }
        };
        checkAndLocate();
    }, []);

    const handleClear = () => {
        clear();
        mapManager.clearUserLocation();
        setIsLocated(false);
    };

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
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex items-center justify-between select-none">
            {/* Left toolbar group */}
            <div className="pointer-events-auto flex items-center gap-2">
                {/* Navigation / Action buttons card */}
                <div className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-white dark:bg-card p-1 shadow-sm">
                    <button
                        onClick={handleLocateMe}
                        disabled={isLocating}
                        className={cn(
                            'flex size-7 items-center justify-center rounded-md transition cursor-pointer disabled:cursor-not-allowed',
                            isLocated
                                ? 'bg-[#863BFF]/15 text-[#863BFF]'
                                : 'text-muted-foreground hover:bg-[#F5F0FF] hover:text-[#863BFF]'
                        )}
                        title={t.locateMe}
                    >
                        {isLocating ? (
                            <Loader2 className="size-4 animate-spin text-[#863BFF]" />
                        ) : (
                            <Crosshair className="size-4" />
                        )}
                    </button>
                    <div className="h-4 w-px bg-border mx-0.5" />
                    <button
                        onClick={reverseAnchors}
                        disabled={anchors.length < 2}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] hover:text-[#863BFF] disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
                        title={t.reverseRoute}
                    >
                        <ArrowLeftRight className="size-4" />
                    </button>
                    <button
                        onClick={undo}
                        disabled={!canUndo}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] hover:text-[#863BFF] disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
                        title={t.undo}
                    >
                        <Undo2 className="size-4" />
                    </button>
                    <button
                        onClick={redo}
                        disabled={!canRedo}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F0FF] hover:text-[#863BFF] disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
                        title={t.redo}
                    >
                        <Redo2 className="size-4" />
                    </button>
                    <div className="h-4 w-px bg-border mx-0.5" />
                    <button
                        onClick={handleClear}
                        disabled={anchors.length === 0}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-destructive disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
                        title={t.clearRoute}
                    >
                        <Trash2 className="size-4" />
                    </button>
                </div>

                {/* Save Route Button */}
                <button
                    onClick={() => setSaveModalOpen(true)}
                    disabled={resultPoints.length < 2}
                    className={cn(
                        'group flex h-9 items-center gap-1.5 rounded-lg px-4 text-xs font-bold tracking-tight transition-all duration-150 select-none',
                        resultPoints.length >= 2
                            ? 'bg-[#863BFF] text-white shadow-sm hover:bg-[#7424F8] hover:shadow-md active:scale-98 active:bg-[#6517EA] cursor-pointer'
                            : 'bg-muted/80 text-muted-foreground/60 border border-border/50 cursor-not-allowed shadow-none'
                    )}
                >
                    <BookmarkPlus
                        className={cn(
                            'size-4 stroke-[2.2]',
                            resultPoints.length >= 2 && 'transition-transform group-hover:scale-110'
                        )}
                    />
                    <span>{t.saveRoute}</span>
                </button>

                {/* Heatmaps & Basemaps Dropdown */}
                <div className="relative">
                    <button
                        onClick={() => {
                            setBasemapOpen(!basemapOpen);
                            setToolsOpen(false);
                        }}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white dark:bg-card px-3 text-xs font-semibold text-foreground shadow-sm transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:border-[#863BFF] hover:text-[#863BFF] cursor-pointer"
                    >
                        <Flame className="size-3.5 text-[#863BFF]" />
                        <span>{t.heatmaps}</span>
                        <ChevronDown className="size-3 text-muted-foreground" />
                    </button>

                    {basemapOpen && (
                        <div className="absolute left-0 top-11 z-50 min-w-44 rounded-lg border border-border bg-white dark:bg-card p-1 shadow-lg">
                            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                {t.basemap}
                            </div>
                            {(Object.keys(BASEMAPS) as BasemapKey[]).map((key) => (
                                <button
                                    key={key}
                                    onClick={() => {
                                        setCurrentBasemap(key);
                                        mapManager.setBasemap(key);
                                        setBasemapOpen(false);
                                    }}
                                    className={cn(
                                        'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition cursor-pointer',
                                        currentBasemap === key
                                            ? 'bg-[#863BFF]/10 font-bold text-[#863BFF]'
                                            : 'hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] text-foreground'
                                    )}
                                >
                                    <span>{t.basemaps[key as keyof typeof t.basemaps] ?? BASEMAPS[key].label}</span>
                                    {currentBasemap === key && <Check className="size-3 text-[#863BFF]" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Track Tools Dropdown (Segments / Editing) */}
                <div className="relative">
                    <button
                        onClick={() => {
                            setToolsOpen(!toolsOpen);
                            setBasemapOpen(false);
                        }}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white dark:bg-card px-3 text-xs font-semibold text-foreground shadow-sm transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:border-[#863BFF] hover:text-[#863BFF] cursor-pointer"
                    >
                        <Layers className="size-3.5 text-muted-foreground" />
                        <span>{t.segments}</span>
                        <ChevronDown className="size-3 text-muted-foreground" />
                    </button>

                    {toolsOpen && (
                        <div className="absolute left-0 top-11 z-50 min-w-48 rounded-lg border border-border bg-white dark:bg-card p-1 shadow-lg">
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
            </div>

            {/* Right side: My Routes button (Solid opaque, never transparent on hover) */}
            <div className="pointer-events-auto flex items-center gap-2">
                <button
                    onClick={() => setMyRoutesOpen(true)}
                    className="group flex h-9 items-center gap-2 rounded-lg border border-border bg-white dark:bg-card px-3.5 text-xs font-bold tracking-tight text-foreground shadow-sm transition-all duration-150 hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:border-[#863BFF] hover:text-[#863BFF] hover:shadow-md cursor-pointer active:scale-98"
                >
                    <Bookmark className="size-4 text-[#863BFF] transition-transform group-hover:scale-110" />
                    <span>{t.myRoutes}</span>
                    {fileCount > 0 && (
                        <span className="rounded-full bg-[#863BFF]/15 px-2 py-0.5 text-[10px] font-black text-[#863BFF]">
                            {fileCount}
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
}
