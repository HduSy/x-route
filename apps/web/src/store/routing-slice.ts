import { create } from 'zustand';
import type { Coordinates, TrackPoint } from '@x-route/gpx';

export interface RoutingAnchor extends Coordinates {}

export type UnitType = 'km' | 'mi';
export type RoutingPreference = 'popular' | 'flat' | 'direct';

interface RoutingState {
    active: boolean;
    anchors: RoutingAnchor[];
    profile: string;
    routingPreference: RoutingPreference;
    manualMode: boolean;
    resultPoints: TrackPoint[];
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

    setActive: (active: boolean) => void;
    setProfile: (profile: string) => void;
    setRoutingPreference: (pref: RoutingPreference) => void;
    setManualMode: (manualMode: boolean) => void;
    addAnchor: (anchor: RoutingAnchor) => void;
    insertAnchor: (index: number, anchor: RoutingAnchor) => void;
    moveAnchor: (index: number, to: Coordinates) => void;
    removeAnchor: (index: number) => void;
    reverseAnchors: () => void;
    clear: () => void;
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
    loadRouteFromPoints: (points: Coordinates[]) => void;
}

export const useRoutingStore = create<RoutingState>()((set, get) => ({
    active: true, // Route creation is ready and enabled by default (Strava style)
    anchors: [],
    profile: 'bike',
    routingPreference: 'popular',
    manualMode: false,
    resultPoints: [],
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

    setActive: (active) => set({ active }),
    setProfile: (profile) => set({ profile }),
    setRoutingPreference: (routingPreference) => set({ routingPreference }),
    setManualMode: (manualMode) => set({ manualMode }),

    addAnchor: (anchor) => {
        const { anchors, past } = get();
        set({ anchors: [...anchors, anchor], past: [...past, anchors], future: [] });
    },

    insertAnchor: (index, anchor) => {
        const { anchors, past } = get();
        const clampedIndex = Math.max(0, Math.min(index, anchors.length));
        const next = [
            ...anchors.slice(0, clampedIndex),
            anchor,
            ...anchors.slice(clampedIndex),
        ];
        set({ anchors: next, past: [...past, anchors], future: [] });
    },

    moveAnchor: (index, to) => {
        const { anchors, past } = get();
        const next = anchors.map((a, i) => (i === index ? { ...to } : a));
        set({ anchors: next, past: [...past, anchors], future: [] });
    },

    removeAnchor: (index) => {
        const { anchors, past } = get();
        set({
            anchors: anchors.filter((_, i) => i !== index),
            past: [...past, anchors],
            future: [],
        });
    },

    reverseAnchors: () => {
        const { anchors, past } = get();
        if (anchors.length < 2) return;
        const next = [...anchors].reverse();
        set({ anchors: next, past: [...past, anchors], future: [] });
    },

    clear: () => {
        const { anchors, past } = get();
        set({
            anchors: [],
            resultPoints: [],
            error: null,
            past: [...past, anchors],
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

    loadRouteFromPoints: (points) => {
        if (points.length < 2) return;
        // Sample down to key anchors if there are many points, or use start, intermediates, end
        const step = Math.max(1, Math.floor(points.length / 10));
        const sampleAnchors: RoutingAnchor[] = [];
        for (let i = 0; i < points.length; i += step) {
            sampleAnchors.push(points[i]!);
        }
        if (sampleAnchors[sampleAnchors.length - 1] !== points[points.length - 1]) {
            sampleAnchors.push(points[points.length - 1]!);
        }
        set({
            active: true,
            anchors: sampleAnchors,
            past: [],
            future: [],
            myRoutesOpen: false,
        });
    },
}));
