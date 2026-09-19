import { useState } from 'react';
import {
    ArrowLeftRight,
    Bookmark,
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
        setIsLocating(true);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lon = pos.coords.longitude;
                const lat = pos.coords.latitude;
                mapManager.setUserLocation({ lon, lat });
                setIsLocating(false);
                setIsLocated(true);
                const map = mapManager.getMap();
                map?.flyTo({
                    center: [lon, lat],
                    zoom: 15,
                    essential: true,
                    duration: 1200,
                });
            },
            (err) => {
                console.warn('Geolocation error:', err);
                setIsLocating(false);
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
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
                <div className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-background/95 p-1 shadow-sm backdrop-blur">
                    <button
                        onClick={handleLocateMe}
                        disabled={isLocating}
                        className={cn(
                            'flex size-7 items-center justify-center rounded-md transition',
                            isLocated
                                ? 'bg-blue-500/10 text-[#007AFF]'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                        title={t.locateMe}
                    >
                        {isLocating ? (
                            <Loader2 className="size-4 animate-spin text-[#007AFF]" />
                        ) : (
                            <Crosshair className="size-4" />
                        )}
                    </button>
                    <div className="h-4 w-px bg-border mx-0.5" />
                    <button
                        onClick={reverseAnchors}
                        disabled={anchors.length < 2}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 transition"
                        title={t.reverseRoute}
                    >
                        <ArrowLeftRight className="size-4" />
                    </button>
                    <button
                        onClick={undo}
                        disabled={!canUndo}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 transition"
                        title={t.undo}
                    >
                        <Undo2 className="size-4" />
                    </button>
                    <button
                        onClick={redo}
                        disabled={!canRedo}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 transition"
                        title={t.redo}
                    >
                        <Redo2 className="size-4" />
                    </button>
                    <div className="h-4 w-px bg-border mx-0.5" />
                    <button
                        onClick={clear}
                        disabled={anchors.length === 0}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 transition"
                        title={t.clearRoute}
                    >
                        <Trash2 className="size-4" />
                    </button>
                </div>

                {/* Strava Signature Save Route Button */}
                <button
                    onClick={() => setSaveModalOpen(true)}
                    disabled={resultPoints.length < 2}
                    className={cn(
                        'flex h-9 items-center justify-center rounded-lg bg-[#FC5200] px-4 text-xs font-bold tracking-wide text-white shadow-sm transition hover:bg-[#E04800] active:scale-98',
                        resultPoints.length < 2 && 'cursor-not-allowed opacity-50 hover:bg-[#FC5200]'
                    )}
                >
                    {t.saveRoute}
                </button>

                {/* Heatmaps & Basemaps Dropdown */}
                <div className="relative">
                    <button
                        onClick={() => {
                            setBasemapOpen(!basemapOpen);
                            setToolsOpen(false);
                        }}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background/95 px-3 text-xs font-semibold text-foreground shadow-sm backdrop-blur transition hover:bg-accent"
                    >
                        <Flame className="size-3.5 text-[#FC5200]" />
                        <span>{t.heatmaps}</span>
                        <ChevronDown className="size-3 text-muted-foreground" />
                    </button>

                    {basemapOpen && (
                        <div className="absolute left-0 top-11 z-50 min-w-44 rounded-lg border border-border bg-background p-1 shadow-lg">
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
                                        'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition',
                                        currentBasemap === key
                                            ? 'bg-[#FC5200]/10 font-bold text-[#FC5200]'
                                            : 'hover:bg-accent text-foreground'
                                    )}
                                >
                                    <span>{t.basemaps[key as keyof typeof t.basemaps] ?? BASEMAPS[key].label}</span>
                                    {currentBasemap === key && <Check className="size-3 text-[#FC5200]" />}
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
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background/95 px-3 text-xs font-semibold text-foreground shadow-sm backdrop-blur transition hover:bg-accent"
                    >
                        <Layers className="size-3.5 text-muted-foreground" />
                        <span>{t.segments}</span>
                        <ChevronDown className="size-3 text-muted-foreground" />
                    </button>

                    {toolsOpen && (
                        <div className="absolute left-0 top-11 z-50 min-w-48 rounded-lg border border-border bg-background p-1 shadow-lg">
                            <button
                                disabled={!selectedFileId}
                                onClick={() =>
                                    selectedFileId &&
                                    handleTrackAction('reversed', () => reverseTrack(selectedFileId))
                                }
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-accent disabled:opacity-40"
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
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-accent disabled:opacity-40"
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
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-accent disabled:opacity-40"
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
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-accent disabled:opacity-40"
                            >
                                <Check className="size-3.5 text-muted-foreground" />
                                <span>{t.loop}</span>
                                {toolActionStatus === 'loop' && <Check className="ml-auto size-3 text-green-600" />}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Right side: My Routes button */}
            <div className="pointer-events-auto flex items-center gap-2">
                <button
                    onClick={() => setMyRoutesOpen(true)}
                    className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background/95 px-3 text-xs font-bold tracking-tight text-foreground shadow-sm backdrop-blur transition hover:border-[#FC5200] hover:text-[#FC5200]"
                >
                    <Bookmark className="size-4 text-[#FC5200]" />
                    <span>{t.myRoutes}</span>
                    {fileCount > 0 && (
                        <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-bold text-muted-foreground">
                            {fileCount}
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
}
