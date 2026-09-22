import { create } from 'zustand';
import type { Coordinates, TrackPoint } from '@x-route/gpx';
import { routingSegmentCache, getSegmentKey } from '@/lib/routing';

export interface RoutingAnchor extends Coordinates {}

export type UnitType = 'km' | 'mi';
export type RoutingPreference = 'popular' | 'flat' | 'direct';
export type ElevationPreference = 'any' | 'min' | 'max';

interface RoutingState {
    active: boolean;
    anchors: RoutingAnchor[];
    profile: string;
    routingPreference: RoutingPreference;
    elevationPreference: ElevationPreference;
    manualMode: boolean;
    resultPoints: TrackPoint[];
    /** One-shot flag: the next route-computation pass is skipped because the
     *  line was seeded from a loaded file (zero-network load). */
    skipNextRouteComputation: boolean;
    routing: boolean;
    error: string | null;
    past: RoutingAnchor[][];
    future: RoutingAnchor[][];

    // Strava Route Builder UI States
    showSurfaceType: boolean;
    showDistanceMarkers: boolean;
    showRoutePath: boolean;
    units: UnitType;
    sidebarCollapsed: boolean;
    elevationExpanded: boolean;
    myRoutesOpen: boolean;
    saveModalOpen: boolean;
    editingFileId: string | null;

    setActive: (active: boolean) => void;
    setProfile: (profile: string) => void;
    setRoutingPreference: (pref: RoutingPreference) => void;
    setElevationPreference: (pref: ElevationPreference) => void;
    setManualMode: (manualMode: boolean) => void;
    addAnchor: (anchor: RoutingAnchor) => void;
    insertAnchor: (index: number, anchor: RoutingAnchor) => void;
    moveAnchor: (index: number, to: Coordinates) => void;
    removeAnchor: (index: number) => void;
    removeAnchors: (indices: number[]) => void;
    reverseAnchors: () => void;
    clear: (resetHistory?: boolean) => void;
    setResult: (points: TrackPoint[], error: string | null) => void;
    setRouting: (routing: boolean) => void;
    undo: () => void;
    redo: () => void;

    // UI setters
    setShowSurfaceType: (show: boolean) => void;
    setShowDistanceMarkers: (show: boolean) => void;
    setShowRoutePath: (show: boolean) => void;
    setUnits: (units: UnitType) => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
    toggleSidebar: () => void;
    setElevationExpanded: (expanded: boolean) => void;
    toggleElevation: () => void;
    setMyRoutesOpen: (open: boolean) => void;
    setSaveModalOpen: (open: boolean) => void;
    setEditingFileId: (id: string | null) => void;
    loadRouteFromPoints: (points: Coordinates[], resultSeed?: TrackPoint[]) => void;
}

export const useRoutingStore = create<RoutingState>()((set, get) => ({
    active: true, // Default is route creation mode (crosshair cursor); allows instant click-to-route on refresh
    anchors: [],
    profile: 'racing_bike',
    routingPreference: 'popular',
    elevationPreference: 'any',
    manualMode: false,
    resultPoints: [],
    skipNextRouteComputation: false,
    routing: false,
    error: null,
    past: [],
    future: [],

    showSurfaceType: true,
    showDistanceMarkers: true,
    showRoutePath: true,
    units: 'km',
    sidebarCollapsed: false,
    elevationExpanded: true,
    myRoutesOpen: false,
    saveModalOpen: false,
    editingFileId: null,

    setActive: (active) => set({ active }),
    setProfile: (profile) => set({ profile }),
    setRoutingPreference: (routingPreference) => set({ routingPreference }),
    setElevationPreference: (elevationPreference) => set({ elevationPreference }),
    setManualMode: (manualMode) => set({ manualMode }),

    addAnchor: (anchor) => {
        const { anchors, past } = get();
        set({ active: true, anchors: [...anchors, anchor], past: [...past, anchors], future: [] });
    },

    insertAnchor: (index, anchor) => {
        const { anchors, past } = get();
        const clampedIndex = Math.max(0, Math.min(index, anchors.length));
        const next = [
            ...anchors.slice(0, clampedIndex),
            anchor,
            ...anchors.slice(clampedIndex),
        ];
        set({ active: true, anchors: next, past: [...past, anchors], future: [] });
    },

    moveAnchor: (index, to) => {
        const { anchors, past } = get();
        const next = anchors.map((a, i) => (i === index ? { ...to } : a));
        set({ anchors: next, past: [...past, anchors], future: [] });
    },

    removeAnchor: (index) => {
        const { anchors, past } = get();
        const next = anchors.filter((_, i) => i !== index);
        set({
            anchors: next,
            past: [...past, anchors],
            future: [],
            active: true,
        });
    },

    removeAnchors: (indices: number[]) => {
        const { anchors, past } = get();
        const indexSet = new Set(indices);
        const next = anchors.filter((_, i) => !indexSet.has(i));
        if (next.length === 0) {
            set({
                active: true,
                anchors: [],
                resultPoints: [],
                error: null,
                editingFileId: null,
                past: [...past, anchors],
                future: [],
            });
        } else {
            set({
                anchors: next,
                past: [...past, anchors],
                future: [],
                active: true,
            });
        }
    },

    reverseAnchors: () => {
        const { anchors, past } = get();
        if (anchors.length < 2) return;
        const next = [...anchors].reverse();
        set({ anchors: next, past: [...past, anchors], future: [] });
    },

    clear: (resetHistory = false) => {
        const { anchors, past } = get();
        set({
            active: true,
            anchors: [],
            resultPoints: [],
            error: null,
            editingFileId: null,
            past: resetHistory ? [] : [...past, anchors],
            future: [],
        });
    },

    setResult: (points, error) => set({ resultPoints: points, error }),
    setRouting: (routing) => set({ routing }),

    undo: () => {
        const { past, future, anchors } = get();
        if (past.length === 0) return;
        const previous = past[past.length - 1]!;
        set({
            anchors: previous,
            past: past.slice(0, -1),
            future: [anchors, ...future],
        });
    },

    redo: () => {
        const { past, future, anchors } = get();
        if (future.length === 0) return;
        const next = future[0]!;
        set({
            anchors: next,
            past: [...past, anchors],
            future: future.slice(1),
        });
    },

    setShowSurfaceType: (showSurfaceType) => set({ showSurfaceType }),
    setShowDistanceMarkers: (showDistanceMarkers) => set({ showDistanceMarkers }),
    setShowRoutePath: (showRoutePath) => set({ showRoutePath }),
    setUnits: (units) => set({ units }),
    setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    setElevationExpanded: (elevationExpanded) => set({ elevationExpanded }),
    toggleElevation: () => set((s) => ({ elevationExpanded: !s.elevationExpanded })),
    setMyRoutesOpen: (myRoutesOpen) => set({ myRoutesOpen }),
    setSaveModalOpen: (saveModalOpen) => set({ saveModalOpen }),
    setEditingFileId: (editingFileId) => set({ editingFileId }),

    loadRouteFromPoints: (points, resultSeed) => {
        if (points.length < 2) return;
        // Sample down to key anchors if there are many points, or use start, intermediates, end
        const step = Math.max(1, Math.floor(points.length / 10));
        const sampleAnchors: RoutingAnchor[] = [];
        const sampleIndices: number[] = [];
        for (let i = 0; i < points.length; i += step) {
            sampleIndices.push(i);
            sampleAnchors.push(points[i]!);
        }
        if (sampleAnchors[sampleAnchors.length - 1] !== points[points.length - 1]) {
            sampleIndices.push(points.length - 1);
            sampleAnchors.push(points[points.length - 1]!);
        }
        set({
            active: true,
            anchors: sampleAnchors,
            // Seed the route line from the source track: it renders instantly and
            // the skip flag keeps this load completely off the network. The next
            // real edit (node drag/add, profile change) computes normally.
            resultPoints: resultSeed ?? [],
            error: null,
            past: [],
            future: [],
            skipNextRouteComputation: true,
        });

        // Pre-fill the segment cache with the source track's own geometry
        // between adjacent anchors: the first node edit then refetches only the
        // changed segments while untouched parts keep the original track shape.
        if (resultSeed && resultSeed.length === points.length && !get().manualMode) {
            const profileKey = get().profile;
            const elevationPreference = get().elevationPreference;
            for (let s = 0; s < sampleIndices.length - 1; s++) {
                const segment = resultSeed.slice(sampleIndices[s]!, sampleIndices[s + 1]! + 1);
                if (segment.length >= 2) {
                    routingSegmentCache.set(
                        getSegmentKey(sampleAnchors[s]!, sampleAnchors[s + 1]!, profileKey, elevationPreference),
                        segment
                    );
                }
            }
        }
    },
}));
