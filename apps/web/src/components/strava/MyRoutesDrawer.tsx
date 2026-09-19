import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    Bookmark,
    Download,
    FileJson,
    FolderOpen,
    Plus,
    Route,
    Trash2,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
        setMyRoutesOpen(false);
    };

    if (!myRoutesOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in select-none">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={() => setMyRoutesOpen(false)} />

            {/* Slide-over panel */}
            <div className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-200">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                    <div className="flex items-center gap-2">
                        <Bookmark className="size-5 text-[#863BFF]" />
                        <h2 className="text-base font-bold tracking-tight text-foreground">
                            {t.myRoutes}
                        </h2>
                        {fileIds.length > 0 && (
                            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-muted-foreground">
                                {fileIds.length}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleNewRoute}
                            className="flex items-center gap-1 rounded-md bg-[#863BFF] px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-[#7424F8]"
                        >
                            <Plus className="size-3.5 stroke-[3]" />
                            <span>{t.newRoute}</span>
                        </button>
                        <button
                            onClick={() => setMyRoutesOpen(false)}
                            className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <X className="size-5" />
                        </button>
                    </div>
                </div>

                {/* Import toolbar */}
                <div className="border-b border-border bg-accent/30 px-5 py-2.5">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2 border-dashed font-semibold text-xs text-foreground hover:border-[#863BFF] hover:text-[#863BFF]"
                        onClick={triggerFileInput}
                    >
                        <FolderOpen className="size-4 text-[#863BFF]" />
                        <span>{t.importBtn}</span>
                    </Button>
                </div>

                {/* Route list */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                    {fileIds.length === 0 ? (
                        <div className="flex h-64 flex-col items-center justify-center text-center px-4 text-muted-foreground">
                            <Route className="size-12 stroke-[1.5] text-muted-foreground/50 mb-3" />
                            <p className="text-sm font-medium">{t.noRoutesSaved}</p>
                        </div>
                    ) : (
                        fileIds.map((id) => {
                            const fileData = fileMap.get(id);
                            if (!fileData) return null;
                            const file = new GPXFile(fileData);
                            const { global } = file.getStatistics();
                            const name = file.metadata?.name?.trim() || t.untitled;

                            return (
                                <div
                                    key={id}
                                    className={cn(
                                        'group relative flex flex-col rounded-xl border border-border p-3.5 shadow-xs transition hover:border-[#863BFF]/50 hover:shadow-md bg-card',
                                        selectedFileId === id && 'border-[#863BFF] ring-1 ring-[#863BFF]/30'
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#863BFF]/10 text-[#863BFF]">
                                                <FileJson className="size-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="truncate text-sm font-bold text-foreground">
                                                    {name}
                                                </h3>
                                                <div className="text-xs font-semibold text-muted-foreground mt-0.5">
                                                    {global.distance.total.toFixed(1)} km · ↑
                                                    {Math.round(global.elevation.gain)} m ·{' '}
                                                    {global.length} {t.pts}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                                            <button
                                                onClick={() => void exportFile(id)}
                                                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                                title={t.exportGpx}
                                            >
                                                <Download className="size-4" />
                                            </button>
                                            <button
                                                onClick={() => void deleteFile(id)}
                                                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                title={t.delete}
                                            >
                                                <Trash2 className="size-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Load button */}
                                    <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between">
                                        <span className="text-[11px] text-muted-foreground">
                                            GPX Track
                                        </span>
                                        <button
                                            onClick={() => handleLoadRoute(id)}
                                            className="flex items-center gap-1 text-xs font-bold text-[#863BFF] hover:underline"
                                        >
                                            <span>{t.loadRoute}</span>
                                            <span>→</span>
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
