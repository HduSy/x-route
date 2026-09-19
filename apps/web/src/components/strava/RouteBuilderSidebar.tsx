import { useState, useEffect, useRef } from 'react';
import {
    Bike,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Compass,
    Footprints,
    Layers,
    MapPin,
    Mountain,
    Search,
    Spline,
    X,
} from 'lucide-react';
import { useRoutingStore, type UnitType } from '@/store/routing-slice';
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
    const profile = useRoutingStore((s) => s.profile);
    const setProfile = useRoutingStore((s) => s.setProfile);
    const manualMode = useRoutingStore((s) => s.manualMode);
    const setManualMode = useRoutingStore((s) => s.setManualMode);
    const showSurfaceType = useRoutingStore((s) => s.showSurfaceType);
    const setShowSurfaceType = useRoutingStore((s) => s.setShowSurfaceType);
    const showDistanceMarkers = useRoutingStore((s) => s.showDistanceMarkers);
    const setShowDistanceMarkers = useRoutingStore((s) => s.setShowDistanceMarkers);
    const showRoutePath = useRoutingStore((s) => s.showRoutePath);
    const setShowRoutePath = useRoutingStore((s) => s.setShowRoutePath);
    const units = useRoutingStore((s) => s.units);
    const setUnits = useRoutingStore((s) => s.setUnits);
    const sidebarCollapsed = useRoutingStore((s) => s.sidebarCollapsed);
    const toggleSidebar = useRoutingStore((s) => s.toggleSidebar);
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

        searchTimeoutRef.current = window.setTimeout(async () => {
            setSearching(true);
            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
                        trimmed
                    )}&limit=5`
                );
                if (res.ok) {
                    const data = (await res.json()) as SearchResult[];
                    setSearchResults(data);
                    setShowDropdown(data.length > 0);
                }
            } catch (err) {
                console.error('Location search failed', err);
            } finally {
                setSearching(false);
            }
        }, 350);

        return () => {
            if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
        };
    }, [searchQuery]);

    const handleSelectLocation = (result: SearchResult) => {
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const map = mapManager.getMap();
            map?.flyTo({ center: [lon, lat], zoom: 14 });
            addAnchor({ lat, lon });
        }
        setSearchQuery('');
        setShowDropdown(false);
    };

    return (
        <aside
            className={cn(
                'relative z-20 flex h-full flex-col border-r border-border bg-background transition-all duration-300 ease-in-out select-none',
                sidebarCollapsed ? 'w-0 overflow-hidden border-none' : 'w-80 min-w-80 shadow-md'
            )}
        >
            {/* Collapse toggle tab button sitting on the map edge */}
            <button
                className="absolute -right-6 top-16 z-30 flex h-10 w-6 items-center justify-center rounded-r-md border border-l-0 border-border bg-background shadow-md transition hover:bg-accent text-muted-foreground hover:text-foreground"
                onClick={toggleSidebar}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                {sidebarCollapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </button>

            {/* Sidebar content */}
            <div className="flex h-full flex-col overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
                    <h2 className="text-base font-bold tracking-tight text-foreground">
                        {t.buildYourRoute}
                    </h2>
                    <button
                        className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={toggleSidebar}
                    >
                        <X className="size-4" />
                    </button>
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
                                className="text-muted-foreground hover:text-foreground"
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
                                    className="flex w-full items-start gap-2 border-b border-border/50 px-3 py-2 text-left text-xs hover:bg-accent last:border-b-0"
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
                                className="w-full appearance-none rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-xs font-medium text-foreground focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF] outline-none"
                            >
                                <option value="bike">{t.ride}</option>
                                <option value="racing_bike">{t.roadBike}</option>
                                <option value="gravel_bike">{t.gravelBike}</option>
                                <option value="mountain_bike">{t.mountainBike}</option>
                                <option value="foot">{t.run}</option>
                            </select>
                            <div className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground">
                                {profile === 'foot' ? (
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
                        <label className="text-xs font-semibold text-foreground">{t.followPopular}</label>
                        <div className="relative">
                            <select
                                value={profile}
                                onChange={(e) => setProfile(e.target.value)}
                                className="w-full appearance-none rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-xs font-medium text-foreground focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF] outline-none"
                            >
                                <option value="bike">{t.followPopular}</option>
                                <option value="racing_bike">{t.minElevation}</option>
                            </select>
                            <Compass className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-3 size-3.5 text-muted-foreground" />
                        </div>
                    </div>

                    {/* Elevation Preference */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">{t.anyElevation}</label>
                        <div className="relative">
                            <select
                                className="w-full appearance-none rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-xs font-medium text-foreground focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF] outline-none"
                            >
                                <option>{t.anyElevation}</option>
                                <option>{t.minElevation}</option>
                            </select>
                            <Mountain className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-3 size-3.5 text-muted-foreground" />
                        </div>
                    </div>

                    {/* Surface Type */}
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">{t.anySurface}</label>
                        <div className="relative">
                            <select
                                className="w-full appearance-none rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-xs font-medium text-foreground focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF] outline-none"
                            >
                                <option>{t.anySurface}</option>
                                <option>{t.pavedOnly}</option>
                                <option>{t.dirtPreferred}</option>
                            </select>
                            <Layers className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-3 size-3.5 text-muted-foreground" />
                        </div>
                    </div>

                    {/* Manual Mode Toggle Switch */}
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="flex items-center gap-2.5">
                            <Spline className="size-4 text-muted-foreground" />
                            <div>
                                <div className="text-xs font-semibold text-foreground">{t.manualMode}</div>
                                <div className="text-[10px] text-muted-foreground">
                                    {t.manualModeDesc}
                                </div>
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

                    {/* Surface Type Switch */}
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">{t.surfaceType}</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={showSurfaceType}
                            onClick={() => setShowSurfaceType(!showSurfaceType)}
                            className={cn(
                                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                                showSurfaceType ? 'bg-[#863BFF]' : 'bg-muted'
                            )}
                        >
                            <span
                                className={cn(
                                    'pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out',
                                    showSurfaceType ? 'translate-x-4' : 'translate-x-0'
                                )}
                            />
                        </button>
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
            </div>
        </aside>
    );
}
