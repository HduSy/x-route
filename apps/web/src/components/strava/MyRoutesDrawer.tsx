import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    ArrowRight,
    Bookmark,
    Clock,
    Compass,
    Download,
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
import { cn } from '@/lib/utils';

export function MyRoutesDrawer() {
    const { t } = useT();

    const myRoutesOpen = useRoutingStore((s) => s.myRoutesOpen);
    const setMyRoutesOpen = useRoutingStore((s) => s.setMyRoutesOpen);
    const clear = useRoutingStore((s) => s.clear);
    const loadRouteFromPoints = useRoutingStore((s) => s.loadRouteFromPoints);
    const selectFile = useSelectionStore((s) => s.selectFile);
    const selectedFileId = useSelectionStore((s) => s.selectedFileId);

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
        selectFile(fileId);
        const file = new GPXFile(fileData);
        const trkpts = file.getTrackPoints();
        if (trkpts.length >= 2) {
            const coords = trkpts.map((pt) => pt.getCoordinates());
            loadRouteFromPoints(coords);
        }
        setMyRoutesOpen(false);
    };

    const handleNewRoute = () => {
        clear();
        selectFile(null);
        useRoutingStore.getState().setActive(true);
        useRoutingStore.getState().setSidebarCollapsed(false);
        setMyRoutesOpen(false);
    };

    if (!myRoutesOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in select-none">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={() => setMyRoutesOpen(false)} />

            {/* Slide-over panel */}
            <div className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-200">
                {/* Top Accent Gradient Line */}
                <div className="h-1 w-full shrink-0 bg-gradient-to-r from-[#863BFF] via-[#A855F7] to-[#C084FC]" />

                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/80 px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-[#863BFF]/10 text-[#863BFF]">
                            <Bookmark className="size-4.5 fill-[#863BFF]/20" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-extrabold tracking-tight text-foreground">
                                    {t.myRoutes}
                                </h2>
                                {fileIds.length > 0 && (
                                    <span className="rounded-full bg-[#863BFF]/15 px-2 py-0.5 text-[11px] font-black text-[#863BFF]">
                                        {fileIds.length}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleNewRoute}
                            className="flex items-center gap-1 rounded-lg bg-[#863BFF] px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#7424F8] hover:shadow-sm active:scale-98 active:bg-[#6517EA] cursor-pointer"
                        >
                            <Plus className="size-3.5 stroke-[3]" />
                            <span>{t.newRoute}</span>
                        </button>
                        <button
                            onClick={() => setMyRoutesOpen(false)}
                            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground cursor-pointer"
                        >
                            <X className="size-5" />
                        </button>
                    </div>
                </div>

                {/* Toolbar: Search + Quick Import */}
                <div className="border-b border-border/70 bg-accent/20 px-4 py-3 space-y-2.5">
                    {/* Search bar */}
                    {fileIds.length > 1 && (
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="搜索路线名称…"
                                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF]"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                    <X className="size-3.5" />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Import GPX Card */}
                    <button
                        onClick={triggerFileInput}
                        className="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#863BFF]/40 bg-white dark:bg-card py-2.5 px-3 text-xs font-bold text-[#863BFF] transition-all hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] active:scale-98 cursor-pointer shadow-xs"
                    >
                        <UploadCloud className="size-4 stroke-[2.2] transition-transform group-hover:-translate-y-0.5" />
                        <span>{t.importBtn}</span>
                    </button>
                </div>

                {/* Route list */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {fileIds.length === 0 ? (
                        <div className="flex h-72 flex-col items-center justify-center text-center px-4 text-muted-foreground">
                            <div className="flex size-14 items-center justify-center rounded-2xl bg-[#863BFF]/10 text-[#863BFF] ring-8 ring-[#863BFF]/5 mb-3.5">
                                <Compass className="size-7 stroke-[1.8]" />
                            </div>
                            <p className="text-sm font-bold text-foreground mb-1">
                                {t.noRoutesSaved}
                            </p>
                            <p className="text-xs text-muted-foreground max-w-xs mb-4">
                                点击地图规划路线后保存，或直接导入本地 GPX 轨迹文件
                            </p>
                            <button
                                onClick={triggerFileInput}
                                className="rounded-lg border border-border bg-white dark:bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-xs transition hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer"
                            >
                                立即导入轨迹
                            </button>
                        </div>
                    ) : filteredFileIds.length === 0 ? (
                        <div className="flex h-48 flex-col items-center justify-center text-center px-4 text-muted-foreground">
                            <Search className="size-8 stroke-[1.5] text-muted-foreground/40 mb-2" />
                            <p className="text-xs font-medium">未找到匹配 “{searchQuery}” 的路线</p>
                        </div>
                    ) : (
                        filteredFileIds.map((id) => {
                            const fileData = fileMap.get(id);
                            if (!fileData) return null;
                            const file = new GPXFile(fileData);
                            const { global } = file.getStatistics();
                            const name = file.metadata?.name?.trim() || t.untitled;
                            const isSelected = selectedFileId === id;

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
                                        'group relative flex flex-col rounded-2xl border border-border/80 bg-white dark:bg-card p-4 shadow-xs transition-all duration-200 hover:border-[#863BFF] hover:shadow-md hover:shadow-[#863BFF]/10',
                                        isSelected &&
                                            'border-[#863BFF] ring-2 ring-[#863BFF]/30 bg-[#FBF9FF] dark:bg-[#251540]'
                                    )}
                                >
                                    {/* Card Header */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0 flex-1">
                                            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#863BFF]/10 text-[#863BFF] mt-0.5">
                                                <FileJson className="size-4.5" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <h3
                                                    onClick={() => handleLoadRoute(id)}
                                                    className="truncate text-sm font-bold text-foreground cursor-pointer transition hover:text-[#863BFF]"
                                                    title={name}
                                                >
                                                    {name}
                                                </h3>
                                                <div className="text-[11px] font-medium text-muted-foreground mt-0.5 flex items-center gap-1.5">
                                                    <span>{global.length} {t.pts}</span>
                                                    <span>·</span>
                                                    <span>GPX Track</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => void exportFile(id)}
                                                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer"
                                                title={t.exportGpx}
                                            >
                                                <Download className="size-4" />
                                            </button>
                                            <button
                                                onClick={() => void deleteFile(id)}
                                                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-red-50 hover:text-destructive cursor-pointer"
                                                title={t.delete}
                                            >
                                                <Trash2 className="size-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Metrics Grid */}
                                    <div className="mt-3.5 grid grid-cols-3 gap-2 rounded-xl bg-accent/40 p-2.5 text-center">
                                        <div>
                                            <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                <Route className="size-3 text-[#863BFF]" />
                                                <span>{t.distance}</span>
                                            </div>
                                            <div className="text-xs font-black text-foreground mt-0.5">
                                                {global.distance.total.toFixed(1)} km
                                            </div>
                                        </div>
                                        <div className="border-x border-border/60">
                                            <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                <Mountain className="size-3 text-[#863BFF]" />
                                                <span>{t.ascent}</span>
                                            </div>
                                            <div className="text-xs font-black text-foreground mt-0.5">
                                                ↑{Math.round(global.elevation.gain)} m
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                <Clock className="size-3 text-[#863BFF]" />
                                                <span>预估耗时</span>
                                            </div>
                                            <div className="text-xs font-black text-foreground mt-0.5">
                                                {estTime}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Bottom Load CTA */}
                                    <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between">
                                        <span className="text-[11px] font-medium text-muted-foreground">
                                            {isSelected ? (
                                                <span className="inline-flex items-center gap-1 text-[#863BFF] font-bold">
                                                    <span className="size-1.5 rounded-full bg-[#863BFF] animate-pulse" />
                                                    当前编辑中
                                                </span>
                                            ) : (
                                                '准备就绪'
                                            )}
                                        </span>
                                        <button
                                            onClick={() => handleLoadRoute(id)}
                                            className="group/btn inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-extrabold text-[#863BFF] transition hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] cursor-pointer active:scale-98"
                                        >
                                            <span>{t.loadRoute}</span>
                                            <ArrowRight className="size-3.5 transition-transform group-hover/btn:translate-x-0.5" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
