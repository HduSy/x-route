import { useState, useEffect, useRef } from 'react';
import {
    Bike,
    ChevronDown,
    Compass,
    Crosshair,
    Footprints,
    Hand,
    MapPin,
    Mountain,
    Search,
    X,
} from 'lucide-react';
import { useRoutingStore, type UnitType, type ElevationPreference, type RoutingPreference } from '@/store/routing-slice';
import { useT } from '@/store/i18n-slice';
import { mapManager } from '@/lib/map/MapManager';
import { cn } from '@/lib/utils';

interface SearchResult {
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
}

export function RouteBuilderSidebar() {
    const { t } = useT();

    // Store state
    const active = useRoutingStore((s) => s.active);
    const setActive = useRoutingStore((s) => s.setActive);
    const profile = useRoutingStore((s) => s.profile);
    const setProfile = useRoutingStore((s) => s.setProfile);
    const routingPreference = useRoutingStore((s) => s.routingPreference);
    const setRoutingPreference = useRoutingStore((s) => s.setRoutingPreference);
    const elevationPreference = useRoutingStore((s) => s.elevationPreference);
    const setElevationPreference = useRoutingStore((s) => s.setElevationPreference);
    const manualMode = useRoutingStore((s) => s.manualMode);
    const setManualMode = useRoutingStore((s) => s.setManualMode);
    const showDistanceMarkers = useRoutingStore((s) => s.showDistanceMarkers);
    const setShowDistanceMarkers = useRoutingStore((s) => s.setShowDistanceMarkers);
    const showRoutePath = useRoutingStore((s) => s.showRoutePath);
    const setShowRoutePath = useRoutingStore((s) => s.setShowRoutePath);
    const units = useRoutingStore((s) => s.units);
    const setUnits = useRoutingStore((s) => s.setUnits);
    const sidebarCollapsed = useRoutingStore((s) => s.sidebarCollapsed);
    const setSidebarCollapsed = useRoutingStore((s) => s.setSidebarCollapsed);
    const addAnchor = useRoutingStore((s) => s.addAnchor);

    // Geocoding search
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const searchTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        const trimmed = searchQuery.trim();
        if (!trimmed) return;

        if (searchTimeoutRef.current) {
            window.clearTimeout(searchTimeoutRef.current);
        }

        const controller = new AbortController();

        searchTimeoutRef.current = window.setTimeout(async () => {
            setSearching(true);
            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
                        trimmed
                    )}&limit=5`,
                    { signal: controller.signal }
                );
                if (res.ok) {
                    const data = (await res.json()) as SearchResult[];
                    setSearchResults(data);
                    setShowDropdown(data.length > 0);
                }
            } catch (err: any) {
                if (err?.name !== 'AbortError') {
                    console.error('Location search failed', err);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setSearching(false);
                }
            }
        }, 350);

        return () => {
            if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
            controller.abort();
        };
    }, [searchQuery]);

    const handleSelectLocation = (result: SearchResult) => {
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const map = mapManager.getMap();
            map?.flyTo({ center: [lon, lat], zoom: 14 });
            setActive(true);
            addAnchor({ lat, lon });
        }
        setSearchQuery('');
        setShowDropdown(false);
    };

    return (
        <>
            {/* Mobile backdrop */}
            {!sidebarCollapsed && (
                <div
                    className="fixed inset-0 z-30 bg-black/40 backdrop-blur-2xs sm:hidden animate-in fade-in"
                    onClick={() => setSidebarCollapsed(true)}
                />
            )}

            <aside
                className={cn(
                    'fixed inset-y-0 left-0 z-40 w-[85vw] max-w-xs sm:absolute sm:inset-y-0 sm:left-0 sm:z-20 sm:w-80 sm:min-w-80 sm:max-w-none flex h-full flex-col border-r border-border bg-background shadow-2xl sm:shadow-md select-none transition-transform duration-200 ease-in-out',
                    sidebarCollapsed ? '-translate-x-full pointer-events-none' : 'translate-x-0 pointer-events-auto'
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
                    <h2 className="text-base font-bold tracking-tight text-foreground">
                        {t.buildYourRoute}
                    </h2>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                            onClick={() => {
                                setSidebarCollapsed(true);
                            }}
                            title={t.closeSidebar}
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                </div>

                {/* Sidebar content */}
                <div className="flex h-full flex-col overflow-y-auto">

                {/* Route Mode Segmented Control (Browse vs Draw) */}
                <div className="mx-4 mt-3 select-none">
                    <div className="grid grid-cols-2 rounded-lg bg-muted/60 p-1 text-xs border border-border/70 shadow-2xs">
                        <button
                            type="button"
                            onClick={() => setActive(false)}
                            className={cn(
                                'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-all cursor-pointer',
                                !active
                                    ? 'bg-background text-foreground shadow-xs font-bold'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                            )}
                            title={t.dragToPanMap}
                        >
                            <Hand className="size-3.5" />
                            <span>{t.browseMode}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActive(true)}
                            className={cn(
                                'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-all cursor-pointer',
                                active
                                    ? 'bg-[#863BFF] text-white shadow-xs font-bold'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                            )}
                            title={t.clickMapToAddPoint}
                        >
                            <Crosshair className="size-3.5" />
                            <span>{t.drawMode}</span>
                        </button>
                    </div>
                </div>

                {/* Location Search Input */}
                <div className="relative p-4 pb-2">
                    <div className="relative flex items-center rounded-lg border border-border bg-background px-3 py-2 shadow-xs focus-within:border-[#863BFF] focus-within:ring-1 focus-within:ring-[#863BFF]">
                        <Search className="mr-2 size-4 shrink-0 text-muted-foreground" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                const q = e.target.value;
                                setSearchQuery(q);
                                if (!q.trim()) {
                                    setSearchResults([]);
                                    setShowDropdown(false);
                                }
                            }}
                            onFocus={() => setShowDropdown(searchResults.length > 0)}
                            placeholder={t.clickMapOrSearch}
                            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => {
                                    setSearchQuery('');
                                    setSearchResults([]);
                                    setShowDropdown(false);
                                }}
                                className="text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                                <X className="size-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Search Autocomplete Dropdown */}
                    {showDropdown && (
                        <div className="absolute left-4 right-4 top-13 z-50 max-h-56 overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
                            {searching && (
                                <div className="p-2.5 text-center text-xs text-muted-foreground">
                                    {t.loading}
                                </div>
                            )}
                            {searchResults.map((item) => (
                                <button
                                    key={item.place_id}
                                    className="flex w-full items-start gap-2 border-b border-border/50 px-3 py-2 text-left text-xs hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] last:border-b-0 cursor-pointer"
                                    onClick={() => handleSelectLocation(item)}
                                >
                                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-[#863BFF]" />
                                    <span className="line-clamp-2 leading-snug text-foreground">
                                        {item.display_name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Routing Preferences Section */}
                <div className="space-y-4 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {t.routingPreferences}
                    </div>

                    {/* Activity Selector */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">{t.activity}</label>
                        <div className="relative">
                            <select
                                value={profile}
                                onChange={(e) => setProfile(e.target.value)}
                                className="w-full appearance-none rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-xs font-medium text-foreground focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF] outline-none cursor-pointer"
                            >
                                <option value="racing_bike">{t.roadBike}</option>
                                <option value="gravel_bike">{t.gravelBike}</option>
                                <option value="mountain_bike">{t.mountainBike}</option>
                                <option value="foot">{t.run}</option>
                                <option value="hike">{t.hike}</option>
                            </select>
                            <div className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground">
                                {profile === 'foot' || profile === 'hike' ? (
                                    <Footprints className="size-4 text-[#863BFF]" />
                                ) : (
                                    <Bike className="size-4 text-[#863BFF]" />
                                )}
                            </div>
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-3 size-3.5 text-muted-foreground" />
                        </div>
                    </div>

                    {/* Optimization Route Mode */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">
                            {routingPreference === 'popular' ? t.followPopular : t.directRoute}
                        </label>
                        <div className="relative">
                            <select
                                value={routingPreference}
                                onChange={(e) => setRoutingPreference(e.target.value as RoutingPreference)}
                                className="w-full appearance-none rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-xs font-medium text-foreground focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF] outline-none cursor-pointer"
                            >
                                <option value="popular">{t.followPopular}</option>
                                <option value="direct">{t.directRoute}</option>
                            </select>
                            <Compass className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-3 size-3.5 text-muted-foreground" />
                        </div>
                    </div>

                    {/* Elevation Preference */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">
                            {elevationPreference === 'any'
                                ? t.anyElevation
                                : elevationPreference === 'min'
                                ? t.minElevation
                                : t.maxElevation}
                        </label>
                        <div className="relative">
                            <select
                                value={elevationPreference}
                                onChange={(e) => setElevationPreference(e.target.value as ElevationPreference)}
                                className="w-full appearance-none rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-xs font-medium text-foreground focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF] outline-none cursor-pointer"
                            >
                                <option value="any">{t.anyElevation}</option>
                                <option value="min">{t.minElevation}</option>
                                <option value="max">{t.maxElevation}</option>
                            </select>
                            <Mountain className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-3 size-3.5 text-muted-foreground" />
                        </div>
                    </div>

                    {/* Manual Mode Toggle Switch */}
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="pr-2">
                            <div className="text-xs font-semibold text-foreground">{t.manualMode}</div>
                            <div className="text-[10px] text-muted-foreground">
                                {t.manualModeDesc}
                            </div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={manualMode}
                            onClick={() => setManualMode(!manualMode)}
                            className={cn(
                                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                                manualMode ? 'bg-[#863BFF]' : 'bg-muted'
                            )}
                        >
                            <span
                                className={cn(
                                    'pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out',
                                    manualMode ? 'translate-x-4' : 'translate-x-0'
                                )}
                            />
                        </button>
                    </div>
                </div>

                <div className="my-1 border-t border-border" />

                {/* Map Display Section */}
                <div className="space-y-3 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {t.mapDisplay}
                    </div>

                    {/* Distance Markers Switch */}
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">{t.distanceMarkers}</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={showDistanceMarkers}
                            onClick={() => setShowDistanceMarkers(!showDistanceMarkers)}
                            className={cn(
                                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                                showDistanceMarkers ? 'bg-[#863BFF]' : 'bg-muted'
                            )}
                        >
                            <span
                                className={cn(
                                    'pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out',
                                    showDistanceMarkers ? 'translate-x-4' : 'translate-x-0'
                                )}
                            />
                        </button>
                    </div>

                    {/* Route Path Switch */}
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">{t.routePath}</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={showRoutePath}
                            onClick={() => setShowRoutePath(!showRoutePath)}
                            className={cn(
                                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                                showRoutePath ? 'bg-[#863BFF]' : 'bg-muted'
                            )}
                        >
                            <span
                                className={cn(
                                    'pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out',
                                    showRoutePath ? 'translate-x-4' : 'translate-x-0'
                                )}
                            />
                        </button>
                    </div>

                    {/* Distance Units Dropdown */}
                    <div className="flex items-center justify-between pt-1">
                        <span className="text-xs font-medium text-foreground">{t.units}</span>
                        <select
                            value={units}
                            onChange={(e) => setUnits(e.target.value as UnitType)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus:border-[#863BFF] outline-none"
                        >
                            <option value="km">{t.kilometers}</option>
                            <option value="mi">{t.miles}</option>
                        </select>
                    </div>
                </div>

                {/* Mobile: Tap to draw on full map */}
                <div className="sm:hidden mt-auto border-t border-border p-3 bg-muted/20">
                    <button
                        type="button"
                        onClick={() => {
                            setActive(true);
                            setSidebarCollapsed(true);
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#863BFF] py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#7424F8] active:scale-98 cursor-pointer"
                    >
                        <Crosshair className="size-4" />
                        <span>{t.drawOnMap}</span>
                    </button>
                </div>
            </div>
        </aside>
    </>
);
}
