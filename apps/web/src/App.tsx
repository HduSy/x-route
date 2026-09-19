import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileList } from '@/components/file-list/FileList';
import { MapView } from '@/components/map/MapView';
import { triggerFileInput } from '@/lib/file-actions';

export default function App() {
    return (
        <div className="flex h-screen flex-col bg-background">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                <span className="text-lg font-semibold tracking-tight">x-route</span>
                <span className="text-xs text-muted-foreground">Phase 2 — map layer</span>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={triggerFileInput}>
                    <FolderOpen className="size-4" />
                    Import GPX / ZIP
                </Button>
            </header>

            <div className="flex min-h-0 flex-1">
                <aside className="w-80 shrink-0 overflow-y-auto border-r">
                    <FileList />
                </aside>

                <main className="relative min-w-0 flex-1">
                    <MapView />
                </main>
            </div>
        </div>
    );
}
