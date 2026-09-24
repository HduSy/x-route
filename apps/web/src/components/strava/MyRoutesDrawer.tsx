import { useState, useMemo, useCallback, memo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    AlertTriangle,
    Bookmark,
    Check,
    Clock,
    Compass,
    Download,
    Loader2,
    Mountain,
    Route,
    Search,
    Share2,
    Trash2,
    UploadCloud,
    X,
} from 'lucide-react';
import { db } from '@/lib/db';
import { deleteFile, exportFile, triggerFileInput } from '@/lib/file-actions';
import { copyToClipboard, createShareLink } from '@/lib/share';
import { toast } from '@/lib/toast';
import { GPXFile, type GPXFileType } from '@x-route/gpx';
import { useRoutingStore } from '@/store/routing-slice';
import { useSelectionStore } from '@/store/selection-slice';
import { useT } from '@/store/i18n-slice';
import { routingLayer } from '@/lib/map/routing-layer';
import { mapManager } from '@/lib/map/MapManager';
import { cn } from '@/lib/utils';

interface CachedStats {
    name: string;
    pointsCount: number;
    distKm: number;
    ascentM: number;
    estTime: string;
}

const gpxStatsCache = new WeakMap<object, CachedStats>();

function getRouteStats(fileData: GPXFileType, untitledText: string): CachedStats {
    const cached = gpxStatsCache.get(fileData);
    if (cached) return cached;

    const file = new GPXFile(fileData);
    const { global } = file.getStatistics();
    const name = file.metadata?.name?.trim() || untitledText;
    const estMin = Math.round((global.distance.total / 20) * 60);
    const estTime =
        estMin >= 60
            ? `${Math.floor(estMin / 60)}h ${estMin % 60}m`
            : `${estMin}m`;

    const stats: CachedStats = {
        name,
        pointsCount: global.length,
        distKm: global.distance.total,
        ascentM: Math.round(global.elevation.gain),
        estTime,
    };
    gpxStatsCache.set(fileData, stats);
    return stats;
}

export function MyRoutesDrawer() {
    const { t } = useT();

    const myRoutesOpen = useRoutingStore((s) => s.myRoutesOpen);
    const setMyRoutesOpen = useRoutingStore((s) => s.setMyRoutesOpen);
    const setSidebarCollapsed = useRoutingStore((s) => s.setSidebarCollapsed);
    const loadRouteFromPoints = useRoutingStore((s) => s.loadRouteFromPoints);
    const setEditingFileId = useRoutingStore((s) => s.setEditingFileId);
    const editingFileId = useRoutingStore((s) => s.editingFileId);
    const clear = useRoutingStore((s) => s.clear);

    const selectFile = useSelectionStore((s) => s.selectFile);
    const loadedFileIds = useSelectionStore((s) => s.loadedFileIds);
    const addLoadedFile = useSelectionStore((s) => s.addLoadedFile);
    const removeLoadedFile = useSelectionStore((s) => s.removeLoadedFile);

    const [searchQuery, setSearchQuery] = useState('');
    const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ id: string; name: string } | null>(null);
    const [sharingId, setSharingId] = useState<string | null>(null);

    const fileEntries = useLiveQuery(async () => {
        const ids = (await db.fileids.toArray()) ?? [];
        const fileList = await Promise.all(ids.map((id) => db.files.get(id)));
        const map = new Map<string, GPXFileType>();
        ids.forEach((id, index) => {
            const f = fileList[index];
            if (f) map.set(id, f);
        });
        return { fileIds: ids, fileMap: map };
    });

    const fileIds = fileEntries?.fileIds ?? [];
    const fileMap = fileEntries?.fileMap ?? new Map<string, GPXFileType>();

    // Filter file IDs by search query (direct property access without re-instantiating GPXFile)
    const filteredFileIds = useMemo(() => {
        if (!searchQuery.trim()) return fileIds;
        const q = searchQuery.toLowerCase().trim();
        return fileIds.filter((id) => {
            const fileData = fileMap.get(id);
            if (!fileData) return false;
            const name = fileData.metadata?.name?.toLowerCase() || '';
            return name.includes(q) || id.toLowerCase().includes(q);
        });
    }, [fileIds, fileMap, searchQuery]);

    const handleLoadRoute = (fileId: string) => {
        const fileData = fileMap.get(fileId);
        if (!fileData) return;
        // Explicit user choice of a route — auto camera behaviors (e.g. the
        // union fit over all loaded tracks) must yield to the focus below.
        mapManager.markInteracted();
        addLoadedFile(fileId);
        selectFile(fileId);
        const file = new GPXFile(fileData);
        const trkpts = file.getTrackPoints();
        if (trkpts.length >= 2) {
            const coords = trkpts.map((pt) => pt.getCoordinates());
            loadRouteFromPoints(coords, trkpts);
            setEditingFileId(fileId);
            setSidebarCollapsed(false);
        }
        // Focus the camera on the selected route via the shared focus
        // capability — including when it is already the route being edited
        // (loadRouteFromPoints just seeded resultPoints from its track).
        if (trkpts.length >= 2) {
            mapManager.fitToPlannerRoute();
        } else {
            // Degenerate track (<2 points): fall back to the file's own bounds.
            const { global } = file.getStatistics();
            if (global?.bounds) {
                const sw = global.bounds.southWest;
                const ne = global.bounds.northEast;
                mapManager.fitBounds([[sw.lon, sw.lat], [ne.lon, ne.lat]], 80);
            }
        }
    };

    const handleUnloadRoute = (fileId: string) => {
        removeLoadedFile(fileId);
        if (editingFileId === fileId) {
            clear(true);
            routingLayer.clear();
            selectFile(null);
            mapManager.clearUserLocation();
        }
    };

    const handleDeleteRoute = async (fileId: string) => {
        handleUnloadRoute(fileId);
        await deleteFile(fileId);
    };

    const handleToggleRoute = (fileId: string, currentlyLoaded: boolean) => {
        if (currentlyLoaded) {
            handleUnloadRoute(fileId);
        } else {
            handleLoadRoute(fileId);
        }
    };

    const handleExport = useCallback((id: string) => {
        void exportFile(id);
    }, []);

    const handleShare = useCallback(
        async (id: string) => {
            if (sharingId !== null) return;
            setSharingId(id);
            try {
                const link = await createShareLink(id);
                await copyToClipboard(link);
                toast(t.shareLinkCopied);
            } catch {
                toast(t.shareFailed, 'error');
            } finally {
                setSharingId(null);
            }
        },
        [sharingId, t]
    );

    const handleDeleteRequest = useCallback((id: string, name: string) => {
        setDeleteConfirmTarget({ id, name });
    }, []);

    return (
        <>
            {/* Mobile backdrop only */}
            {myRoutesOpen && (
                <div
                    className="fixed inset-0 z-30 bg-black/40 backdrop-blur-2xs sm:hidden animate-in fade-in"
                    onClick={() => setMyRoutesOpen(false)}
                />
            )}

            {/* Right side panel — matches RouteBuilderSidebar's non-modal sidebar interaction */}
            <aside
                className={cn(
                    'fixed inset-y-0 right-0 z-40 w-[85vw] max-w-xs sm:absolute sm:inset-y-0 sm:right-0 sm:z-20 sm:w-80 sm:min-w-80 sm:max-w-none flex h-full flex-col border-l border-border bg-background shadow-2xl sm:shadow-md select-none transition-transform duration-200 ease-in-out',
                    myRoutesOpen ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/80 px-4 py-3.5">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#863BFF]/10 text-[#863BFF]">
                            <Bookmark className="size-4 fill-[#863BFF]/20" />
                        </div>
                        <h2 className="text-base font-bold tracking-tight text-foreground truncate">
                            {t.myRoutes}
                        </h2>
                        {fileIds.length > 0 && (
                            <span className="rounded-full bg-[#863BFF]/15 px-1.5 py-0.5 text-[10px] font-black text-[#863BFF]">
                                {fileIds.length}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => setMyRoutesOpen(false)}
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground cursor-pointer"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                {/* Search & Actions Bar */}
                <div className="border-b border-border/80 p-3 space-y-2">
                    {fileIds.length > 0 && (
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t.searchRoutesPlaceholder}
                                className="w-full rounded-lg border border-border/80 bg-accent/40 pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-[#863BFF] focus:bg-background focus:outline-hidden transition"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                    <X className="size-3.5" />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Import GPX Card */}
                    <button
                        type="button"
                        onClick={triggerFileInput}
                        className="group flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#863BFF]/40 bg-white dark:bg-card py-2 px-3 text-xs font-bold text-[#863BFF] transition-all hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] active:scale-98 cursor-pointer shadow-2xs"
                    >
                        <UploadCloud className="size-3.5 stroke-[2.2]" />
                        <span>{t.importBtn}</span>
                    </button>
                </div>

                {/* Route list */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                    {fileIds.length === 0 ? (
                        <div className="flex h-72 flex-col items-center justify-center text-center px-4 text-muted-foreground">
                            <div className="flex size-12 items-center justify-center rounded-2xl bg-[#863BFF]/10 text-[#863BFF] ring-8 ring-[#863BFF]/5 mb-3">
                                <Compass className="size-6 stroke-[1.8]" />
                            </div>
                            <p className="text-sm font-bold text-foreground mb-1">
                                {t.noRoutesSaved}
                            </p>
                            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                                {t.noRoutesSavedHint}
                            </p>
                        </div>
                    ) : filteredFileIds.length === 0 ? (
                        <div className="flex h-48 flex-col items-center justify-center text-center px-4 text-muted-foreground">
                            <Search className="size-7 stroke-[1.5] text-muted-foreground/40 mb-2" />
                            <p className="text-xs font-medium">
                                {t.noMatchingRoutesPrefix}“{searchQuery}”{t.noMatchingRoutesSuffix}
                            </p>
                        </div>
                    ) : (
                        filteredFileIds.map((id) => {
                            const fileData = fileMap.get(id);
                            if (!fileData) return null;
                            const isLoaded = loadedFileIds.includes(id);
                            const isCurrentEditing = isLoaded && editingFileId === id;

                            return (
                                <RouteCard
                                    key={id}
                                    id={id}
                                    fileData={fileData}
                                    isLoaded={isLoaded}
                                    isCurrentEditing={isCurrentEditing}
                                    isSharing={sharingId === id}
                                    t={t}
                                    onToggle={handleToggleRoute}
                                    onLoad={handleLoadRoute}
                                    onExport={handleExport}
                                    onShare={handleShare}
                                    onDeleteRequest={handleDeleteRequest}
                                />
                            );
                        })
                    )}
                </div>
            </aside>

            {/* Delete route confirmation modal */}
            {deleteConfirmTarget && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
                    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-150">
                        <div className="flex items-start gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/60 text-red-600">
                                <AlertTriangle className="size-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-bold text-foreground">
                                    {t.confirmDeleteRouteTitle}
                                </h3>
                                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                                    {t.confirmDeleteRouteBody.replace('{name}', deleteConfirmTarget.name)}
                                </p>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setDeleteConfirmTarget(null)}
                                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                            >
                                {t.cancel}
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    const target = deleteConfirmTarget;
                                    setDeleteConfirmTarget(null);
                                    if (target) {
                                        await handleDeleteRoute(target.id);
                                    }
                                }}
                                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition cursor-pointer shadow-xs"
                            >
                                {t.confirmDelete}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

interface RouteCardProps {
    id: string;
    fileData: GPXFileType;
    isLoaded: boolean;
    isCurrentEditing: boolean;
    isSharing: boolean;
    t: ReturnType<typeof useT>['t'];
    onToggle: (id: string, isLoaded: boolean) => void;
    onLoad: (id: string) => void;
    onExport: (id: string) => void;
    onShare: (id: string) => void;
    onDeleteRequest: (id: string, name: string) => void;
}

const RouteCard = memo(function RouteCard({
    id,
    fileData,
    isLoaded,
    isCurrentEditing,
    isSharing,
    t,
    onToggle,
    onLoad,
    onExport,
    onShare,
    onDeleteRequest,
}: RouteCardProps) {
    const { name, pointsCount, distKm, ascentM, estTime } = getRouteStats(fileData, t.untitled);

    return (
        <div
            onClick={() => onToggle(id, isLoaded)}
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 118px' }}
            className={cn(
                'group relative flex flex-col rounded-xl border p-3 shadow-2xs transition-all duration-150 cursor-pointer select-none',
                isLoaded
                    ? 'border-[#863BFF] bg-[#863BFF]/[0.03] dark:bg-[#863BFF]/10'
                    : 'border-border bg-white dark:bg-card hover:border-[#863BFF]/40'
            )}
        >
            {/* Card Header */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#863BFF]/10 text-[#863BFF] mt-0.5">
                        <Route className="size-4 stroke-[2.2]" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3
                            className="truncate text-xs font-bold text-foreground transition group-hover:text-[#863BFF]"
                            title={name}
                        >
                            {name}
                        </h3>
                        <div className="text-[10px] font-medium text-muted-foreground mt-0.5 flex items-center gap-1.5">
                            <span>{pointsCount} {t.pts}</span>
                            <span>·</span>
                            <span>GPX Track</span>
                        </div>
                    </div>
                </div>

                {/* Action buttons: export, then share */}
                <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
                >
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onExport(id);
                        }}
                        className="rounded-md p-1 text-muted-foreground transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer"
                        title={t.exportGpx}
                    >
                        <Download className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isSharing) return;
                            onShare(id);
                        }}
                        className={cn(
                            'rounded-md p-1 text-muted-foreground transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF]',
                            isSharing ? 'pointer-events-none opacity-60' : 'cursor-pointer'
                        )}
                        title={t.shareRoute}
                    >
                        {isSharing ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <Share2 className="size-3.5" />
                        )}
                    </button>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg bg-accent/40 p-2 text-center">
                <div>
                    <div className="flex items-center justify-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Route className="size-2.5 text-[#863BFF]" />
                        <span>{t.distance}</span>
                    </div>
                    <div className="text-xs font-black text-foreground mt-0.5">
                        {distKm.toFixed(1)} km
                    </div>
                </div>
                <div className="border-x border-border/60">
                    <div className="flex items-center justify-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Mountain className="size-2.5 text-[#863BFF]" />
                        <span>{t.ascent}</span>
                    </div>
                    <div className="text-xs font-black text-foreground mt-0.5">
                        ↑{ascentM} m
                    </div>
                </div>
                <div>
                    <div className="flex items-center justify-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Clock className="size-2.5 text-[#863BFF]" />
                        <span>{t.estMovingTime}</span>
                    </div>
                    <div className="text-xs font-black text-foreground mt-0.5">
                        {estTime}
                    </div>
                </div>
            </div>

            {/* Bottom Status — text left, delete far right (away from the
             * export/share cluster to prevent accidental taps) */}
            <div
                onClick={(e) => e.stopPropagation()}
                className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between"
            >
                <span className="text-[10px] font-medium text-muted-foreground">
                    {isCurrentEditing ? (
                        <span className="inline-flex items-center gap-1.5 text-[#863BFF] font-semibold">
                            <span className="size-1.5 rounded-full bg-[#863BFF] animate-pulse" />
                            {t.currentlyEditing}
                        </span>
                    ) : isLoaded ? (
                        <span
                            onClick={(e) => {
                                e.stopPropagation();
                                onLoad(id);
                            }}
                            className="inline-flex items-center gap-1 text-[#863BFF] font-semibold hover:underline cursor-pointer"
                            title="点击切换为当前编辑"
                        >
                            <Check className="size-3 text-[#863BFF]" />
                            {t.loaded}
                        </span>
                    ) : (
                        <span>{t.readyToLoad}</span>
                    )}
                </span>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRequest(id, name);
                    }}
                    className="rounded-md p-1 text-muted-foreground/70 transition hover:bg-red-50 hover:text-destructive cursor-pointer"
                    title={t.delete}
                >
                    <Trash2 className="size-3.5" />
                </button>
            </div>
        </div>
    );
});

