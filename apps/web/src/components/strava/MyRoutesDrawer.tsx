import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    Bookmark,
    Check,
    Clock,
    Compass,
    Download,
    EyeOff,
    FileJson,
    Mountain,
    Plus,
    Route,
    Search,
    Trash2,
    UploadCloud,
    X,
} from 'lucide-react';
import { db, type StoredGPXFile } from '@/lib/db';
import { deleteFile, exportFile, triggerFileInput } from '@/lib/file-actions';
import { GPXFile, type GPXFileType } from '@x-route/gpx';
import { useRoutingStore } from '@/store/routing-slice';
import { useSelectionStore } from '@/store/selection-slice';
import { useT } from '@/store/i18n-slice';
import { routingLayer } from '@/lib/map/routing-layer';
import { mapManager } from '@/lib/map/MapManager';
import { cn } from '@/lib/utils';

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
    const clearLoadedFiles = useSelectionStore((s) => s.clearLoadedFiles);

    const [searchQuery, setSearchQuery] = useState('');

    const fileIds = useLiveQuery(() => db.fileids.toArray()) ?? [];
    const files = useLiveQuery(() => db.files.toArray());

    const fileMap = useMemo(() => {
        const map = new Map<string, GPXFileType>();
        for (const file of files ?? []) {
            const id = (file as StoredGPXFile)._data?.id;
            if (typeof id === 'string') map.set(id, file);
        }
        return map;
    }, [files]);

    // Filter file IDs by search query
    const filteredFileIds = useMemo(() => {
        if (!searchQuery.trim()) return fileIds;
        const q = searchQuery.toLowerCase().trim();
        return fileIds.filter((id) => {
            const fileData = fileMap.get(id);
            if (!fileData) return false;
            const file = new GPXFile(fileData);
            const name = file.metadata?.name?.toLowerCase() || '';
            return name.includes(q) || id.toLowerCase().includes(q);
        });
    }, [fileIds, fileMap, searchQuery]);

    const handleLoadRoute = (fileId: string) => {
        const fileData = fileMap.get(fileId);
        if (!fileData) return;
        addLoadedFile(fileId);
        selectFile(fileId);
        const file = new GPXFile(fileData);
        const trkpts = file.getTrackPoints();
        if (trkpts.length >= 2) {
            const coords = trkpts.map((pt) => pt.getCoordinates());
            loadRouteFromPoints(coords);
            setEditingFileId(fileId);
            setSidebarCollapsed(false);
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

    const handleClearAllLoaded = () => {
        clearLoadedFiles();
        clear(true);
        routingLayer.clear();
        selectFile(null);
        mapManager.clearUserLocation();
    };

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
                    <div className="flex items-center gap-2 shrink-0">
                        {loadedFileIds.length > 0 && (
                            <button
                                type="button"
                                onClick={handleClearAllLoaded}
                                className="text-[11px] font-semibold text-muted-foreground hover:text-red-500 transition px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                                title={t.clearLoaded}
                            >
                                {t.clearLoaded} ({loadedFileIds.length})
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setMyRoutesOpen(false)}
                            className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer transition"
                            title={t.closeSidebar}
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                </div>

                {/* Toolbar: Search + Quick Import */}
                <div className="border-b border-border/70 bg-accent/20 px-3 py-2.5 space-y-2">
                    {/* Search bar */}
                    {fileIds.length > 1 && (
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t.searchRoutesPlaceholder}
                                className="w-full rounded-lg border border-border bg-background py-1.5 pl-7.5 pr-7 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF]"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
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
                        <UploadCloud className="size-3.5 stroke-[2.2] transition-transform group-hover:-translate-y-0.5" />
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
                            <p className="text-xs text-muted-foreground max-w-xs mb-3.5 leading-relaxed">
                                {t.noRoutesSavedHint}
                            </p>
                            <button
                                type="button"
                                onClick={triggerFileInput}
                                className="rounded-lg border border-border bg-white dark:bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-xs transition hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer"
                            >
                                {t.importNow}
                            </button>
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
                            const file = new GPXFile(fileData);
                            const { global } = file.getStatistics();
                            const name = file.metadata?.name?.trim() || t.untitled;
                            const isLoaded = loadedFileIds.includes(id);
                            const isCurrentEditing = isLoaded && editingFileId === id;

                            // Estimate moving time based on ~20km/h
                            const estMin = Math.round((global.distance.total / 20) * 60);
                            const estTime =
                                estMin >= 60
                                    ? `${Math.floor(estMin / 60)}h ${estMin % 60}m`
                                    : `${estMin}m`;

                            return (
                                <div
                                    key={id}
                                    className={cn(
                                        'group relative flex flex-col rounded-xl border p-3 shadow-xs transition-all duration-200 hover:shadow-sm',
                                        isLoaded
                                            ? isCurrentEditing
                                                ? 'border-[#863BFF] ring-2 ring-[#863BFF]/40 bg-[#FBF9FF] dark:bg-[#281648]'
                                                : 'border-[#863BFF] bg-[#FAF7FF] dark:bg-[#201235]'
                                            : 'border-border/80 bg-white dark:bg-card hover:border-[#863BFF]/70'
                                    )}
                                >
                                    {/* Card Header */}
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#863BFF]/10 text-[#863BFF] mt-0.5">
                                                <FileJson className="size-4" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <h3
                                                    onClick={() => handleLoadRoute(id)}
                                                    className="truncate text-xs font-bold text-foreground cursor-pointer transition hover:text-[#863BFF]"
                                                    title={name}
                                                >
                                                    {name}
                                                </h3>
                                                <div className="text-[10px] font-medium text-muted-foreground mt-0.5 flex items-center gap-1.5">
                                                    <span>{global.length} {t.pts}</span>
                                                    <span>·</span>
                                                    <span>GPX Track</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                                            <button
                                                type="button"
                                                onClick={() => void exportFile(id)}
                                                className="rounded-md p-1 text-muted-foreground transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer"
                                                title={t.exportGpx}
                                            >
                                                <Download className="size-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleDeleteRoute(id)}
                                                className="rounded-md p-1 text-muted-foreground transition hover:bg-red-50 hover:text-destructive cursor-pointer"
                                                title={t.delete}
                                            >
                                                <Trash2 className="size-3.5" />
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
                                                {global.distance.total.toFixed(1)} km
                                            </div>
                                        </div>
                                        <div className="border-x border-border/60">
                                            <div className="flex items-center justify-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                <Mountain className="size-2.5 text-[#863BFF]" />
                                                <span>{t.ascent}</span>
                                            </div>
                                            <div className="text-xs font-black text-foreground mt-0.5">
                                                ↑{Math.round(global.elevation.gain)} m
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

                                    {/* Bottom Load CTA */}
                                    <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between">
                                        <span className="text-[10px] font-medium text-muted-foreground">
                                            {isCurrentEditing ? (
                                                <span className="inline-flex items-center gap-1 text-[#863BFF] font-bold">
                                                    <span className="size-1.5 rounded-full bg-[#863BFF] animate-pulse" />
                                                    {t.currentlyEditing}
                                                </span>
                                            ) : isLoaded ? (
                                                <span className="inline-flex items-center gap-1 text-[#863BFF] font-semibold">
                                                    <Check className="size-3 text-[#863BFF]" />
                                                    {t.loaded}
                                                </span>
                                            ) : (
                                                t.readyToLoad
                                            )}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            {isLoaded ? (
                                                <>
                                                    {!isCurrentEditing && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleLoadRoute(id);
                                                            }}
                                                            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold text-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] transition cursor-pointer"
                                                        >
                                                            <span>编辑节点</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleUnloadRoute(id);
                                                        }}
                                                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
                                                        title={t.unloadRoute}
                                                    >
                                                        <EyeOff className="size-3" />
                                                        <span>{t.unloadRoute}</span>
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleLoadRoute(id);
                                                    }}
                                                    className="group/btn inline-flex items-center gap-1 rounded-lg bg-[#863BFF] px-2.5 py-1 text-xs font-bold text-white shadow-2xs transition hover:bg-[#7424F8] active:scale-98 cursor-pointer"
                                                >
                                                    <Plus className="size-3 stroke-[3]" />
                                                    <span>{t.loadRoute}</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })

                    )}
                </div>
            </aside>
        </>
    );
}
