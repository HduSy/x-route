import { StravaNavbar } from '@/components/strava/StravaNavbar';
import { RouteBuilderSidebar } from '@/components/strava/RouteBuilderSidebar';
import { MapView } from '@/components/map/MapView';
import { MapFloatingToolbar } from '@/components/strava/MapFloatingToolbar';
import { RouteStatsBar } from '@/components/strava/RouteStatsBar';
import { MyRoutesDrawer } from '@/components/strava/MyRoutesDrawer';
import { SaveRouteModal } from '@/components/strava/SaveRouteModal';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

export default function App() {
    useKeyboardShortcuts();

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
            {/* Strava Top Navigation Bar */}
            <StravaNavbar />

            {/* Main Workbench Area */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
                {/* Map Area — Full bleed, constant dimensions to eliminate WebGL buffer resize flicker */}
                <main className="absolute inset-0 overflow-hidden">
                    <MapView />
                    <MapFloatingToolbar />
                </main>

                {/* Left Route Builder Sidebar */}
                <RouteBuilderSidebar />

                {/* Right My Routes Drawer */}
                <MyRoutesDrawer />

                {/* Save Route Dialog Modal */}
                <SaveRouteModal />
            </div>

            {/* Bottom Real-time Stats & Elevation Drawer Bar */}
            <RouteStatsBar />
        </div>
    );
}
