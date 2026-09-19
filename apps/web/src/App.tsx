import { FolderOpen, Map as MapIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileList } from '@/components/file-list/FileList';
import { triggerFileInput } from '@/lib/file-actions';

export default function App() {
    return (
        <div className="flex h-screen flex-col bg-background">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                <span className="text-lg font-semibold tracking-tight">x-route</span>
                <span className="text-xs text-muted-foreground">Phase 1 — data layer</span>
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

                <main className="relative flex flex-1 items-center justify-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <MapIcon className="size-8" />
                        <p className="text-sm">Map arrives in Phase 2</p>
                    </div>
                </main>
            </div>
        </div>
    );
}
