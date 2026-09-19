import { FolderOpen, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileList } from '@/components/file-list/FileList';
import { MapView } from '@/components/map/MapView';
import { RoutingToolbar } from '@/components/toolbar/RoutingToolbar';
import { EditToolbar } from '@/components/toolbar/EditToolbar';
import { ElevationProfile } from '@/components/elevation/ElevationProfile';
import { triggerFileInput } from '@/lib/file-actions';
import { useT } from '@/store/i18n-slice';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

export default function App() {
    const { t, lang, toggleLanguage } = useT();
    useKeyboardShortcuts();

    return (
        <div className="flex h-screen flex-col bg-background">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                <span className="text-lg font-semibold tracking-tight">{t.appName}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">{t.tagline}</span>
                <div className="flex-1" />
                <RoutingToolbar />
                <EditToolbar />
                <Button variant="outline" size="sm" onClick={triggerFileInput}>
                    <FolderOpen className="size-4" />
                    <span className="hidden sm:inline">{t.importBtn}</span>
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs font-medium"
                    onClick={toggleLanguage}
                    title="Switch Language / 切换语言"
                >
                    <Languages className="mr-1 size-3.5" />
                    {lang === 'en' ? '中文' : 'EN'}
                </Button>
            </header>

            <div className="flex min-h-0 flex-1">
                <aside className="w-80 shrink-0 overflow-y-auto border-r">
                    <FileList />
                </aside>

                <main className="relative min-w-0 flex-1">
                    <MapView />
                    <ElevationProfile />
                </main>
            </div>
        </div>
    );
}
