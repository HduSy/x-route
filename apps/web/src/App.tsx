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
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
                {/* Left Route Builder Sidebar */}
                <RouteBuilderSidebar />

                {/* Map Area */}
                <main className="relative flex-1 min-w-0 h-full overflow-hidden">
                    <MapView />
                    <MapFloatingToolbar />
                </main>

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
