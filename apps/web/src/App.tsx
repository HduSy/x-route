import { StravaNavbar } from '@/components/strava/StravaNavbar';
import { RouteBuilderSidebar } from '@/components/strava/RouteBuilderSidebar';
import { MapView } from '@/components/map/MapView';
import { MapFloatingToolbar } from '@/components/strava/MapFloatingToolbar';
import { RouteStatsBar } from '@/components/strava/RouteStatsBar';
import { MyRoutesDrawer } from '@/components/strava/MyRoutesDrawer';
import { SaveRouteModal } from '@/components/strava/SaveRouteModal';
import { ShareImport } from '@/components/ShareImport';
import { Toaster } from '@/components/Toaster';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { usePrintHandler } from '@/hooks/use-print-handler';

export default function App() {
    useKeyboardShortcuts();
    usePrintHandler();

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-background print:h-full print:w-full print:overflow-hidden print:bg-white">
            {/* Strava Top Navigation Bar */}
            <div className="print:hidden">
                <StravaNavbar />
            </div>

            {/* Main Workbench Area */}
            <div className="relative min-h-0 flex-1 overflow-hidden print:relative print:min-h-0 print:flex-1 print:overflow-hidden">
                {/* Map Area — Full bleed, constant dimensions to eliminate WebGL buffer resize flicker */}
                <main className="absolute inset-0 overflow-hidden">
                    <MapView />
                    <div className="print:hidden">
                        <MapFloatingToolbar />
                    </div>
                    {/* Share-link import (/r/:key) — after MapView so the map exists first */}
                    <ShareImport />
                </main>

                {/* Left Route Builder Sidebar */}
                <div className="print:hidden">
                    <RouteBuilderSidebar />
                </div>

                {/* Right My Routes Drawer */}
                <div className="print:hidden">
                    <MyRoutesDrawer />
                </div>

                {/* Save Route Dialog Modal */}
                <div className="print:hidden">
                    <SaveRouteModal />
                </div>
            </div>

            {/* Bottom Real-time Stats & Elevation Drawer Bar */}
            <RouteStatsBar />

            {/* Toast notifications (share links, future callers) */}
            <div className="print:hidden">
                <Toaster />
            </div>
        </div>
    );
}
