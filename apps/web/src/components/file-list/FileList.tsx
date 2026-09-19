import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileJson, Trash2 } from 'lucide-react';
import { GPXFile, type GPXFileType } from '@x-route/gpx';
import { Button } from '@/components/ui/button';
import { deleteFile, exportFile } from '@/lib/file-actions';
import { db } from '@/lib/db';
import { cn } from '@/lib/utils';
import { useSelectionStore } from '@/store/selection-slice';

function formatDistance(km: number): string {
    return km >= 100 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

function FileRow({ fileId }: { fileId: string }) {
    const data = useLiveQuery(() => db.files.get(fileId), [fileId]);
    const selectedFileId = useSelectionStore((state) => state.selectedFileId);
    const selectFile = useSelectionStore((state) => state.selectFile);

    const summary = useMemo(() => {
        if (!data) return null;
        const file = new GPXFile(data as GPXFileType);
        const { global } = file.getStatistics();
        return {
            name: file.metadata?.name?.trim() || 'Untitled',
            distance: global.distance.total,
            elevationGain: Math.round(global.elevation.gain),
            points: global.length,
        };
    }, [data]);

    if (!summary) return null;

    return (
        <div
            className={cn(
                'group flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm',
                selectedFileId === fileId
                    ? 'border-primary/50 bg-accent'
                    : 'border-transparent hover:bg-accent/50'
            )}
            onClick={() => selectFile(fileId)}
        >
            <FileJson className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{summary.name}</div>
                <div className="text-xs text-muted-foreground">
                    {formatDistance(summary.distance)} · ↑{summary.elevationGain} m ·{' '}
                    {summary.points} pts
                </div>
            </div>
            <Button
                variant="ghost"
                size="icon"
                className="size-7 opacity-0 group-hover:opacity-100"
                title="Export GPX"
                onClick={(event) => {
                    event.stopPropagation();
                    void exportFile(fileId);
                }}
            >
                <Download className="size-4" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                className="size-7 opacity-0 group-hover:opacity-100 hover:text-destructive"
                title="Delete"
                onClick={(event) => {
                    event.stopPropagation();
                    void deleteFile(fileId);
                }}
            >
                <Trash2 className="size-4" />
            </Button>
        </div>
    );
}

export function FileList() {
    const fileIds = useLiveQuery(() => db.fileids.toArray());

    if (fileIds === undefined) {
        return <div className="p-3 text-sm text-muted-foreground">Loading…</div>;
    }

    if (fileIds.length === 0) {
        return (
            <div className="p-3 text-sm text-muted-foreground">
                No files yet — import a .gpx or .zip to get started.
            </div>
        );
    }

    return (
        <div className="space-y-1 p-2">
            {fileIds.map((fileId) => (
                <FileRow key={fileId} fileId={fileId} />
            ))}
        </div>
    );
}
