import { create } from 'zustand';
import { distance, type Coordinates, type TrackPoint } from '@x-route/gpx';
import { routingSegmentCache, getSegmentKey, type SegmentMode } from '@/lib/routing';

export interface RoutingAnchor extends Coordinates {}

export type { SegmentMode };

/** Minimum distance between start and current end for a round trip to make
 *  sense: below this the route is already a (nearly) closed loop and
 *  appending the return would only create duplicate points. */
export const RETURN_TO_START_MIN_GAP_M = 50;

export type UnitType = 'km' | 'mi';
export type RoutingPreference = 'popular' | 'flat' | 'direct' | 'cycleway' | 'tertiary';
export type ElevationPreference = 'any' | 'min' | 'max';

/** Undo/redo entry: anchors and their per-segment modes restore together. */
interface RoutingHistoryEntry {
    anchors: RoutingAnchor[];
    segmentModes: SegmentMode[];
}

interface RoutingState {
    active: boolean;
    anchors: RoutingAnchor[];
    /** Generation mode of each segment between adjacent anchors
     *  (length = max(0, anchors.length - 1)). Manual mode only decides the
     *  mode of segments created while it is on — existing segments are never
     *  recomputed when it toggles. */
    segmentModes: SegmentMode[];
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
    past: RoutingHistoryEntry[];
    future: RoutingHistoryEntry[];

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
    returnToStart: () => void;
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

/** Derives segment modes after anchor removal: adjacent survivors keep their
 *  segment's original mode; a gap between survivor indices means the removed
 *  anchors were merged into one brand-new segment, created under `newMode`.
 *  `?? 'route'` keeps calls that setState anchors directly (tests, partial
 *  restores) safe when the modes array is stale. */
function modesAfterRemoval(
    survivors: { anchor: RoutingAnchor; index: number }[],
    segmentModes: SegmentMode[],
    newMode: SegmentMode
): SegmentMode[] {
    const modes: SegmentMode[] = [];
    for (let j = 0; j < survivors.length - 1; j++) {
        const from = survivors[j]!.index;
        const to = survivors[j + 1]!.index;
        modes.push(to === from + 1 ? (segmentModes[from] ?? 'route') : newMode);
    }
    return modes;
}

/** Defensive length sync: there is exactly one mode per adjacent anchor pair,
 *  so a stale array (e.g. after a partial setState of anchors) is trimmed. */
function normalizedModes(anchorCount: number, segmentModes: SegmentMode[]): SegmentMode[] {
    return segmentModes.slice(0, Math.max(0, anchorCount - 1));
}

export const useRoutingStore = create<RoutingState>()((set, get) => ({
    active: true, // Default is route creation mode (crosshair cursor); allows instant click-to-route on refresh
    anchors: [],
    segmentModes: [],
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
        const { anchors, segmentModes, past, manualMode } = get();
        const modes = normalizedModes(anchors.length, segmentModes);
        set({
            active: true,
            anchors: [...anchors, anchor],
            // Only the newly appended segment adopts the current mode; the
            // very first anchor creates no segment at all.
            segmentModes:
                anchors.length === 0 ? [] : [...modes, manualMode ? 'manual' : 'route'],
            past: [...past, { anchors, segmentModes: modes }],
            future: [],
        });
    },

    insertAnchor: (index, anchor) => {
        const { anchors, segmentModes, past, manualMode } = get();
        const modes = normalizedModes(anchors.length, segmentModes);
        const clampedIndex = Math.max(0, Math.min(index, anchors.length));
        const next = [
            ...anchors.slice(0, clampedIndex),
            anchor,
            ...anchors.slice(clampedIndex),
        ];
        // Inserting replaces old segment (clampedIndex-1 -> clampedIndex) with
        // two new segments; every other segment survives with its mode.
        const mode: SegmentMode = manualMode ? 'manual' : 'route';
        const nextModes =
            clampedIndex === 0
                ? [mode, ...modes]
                : clampedIndex >= anchors.length
                    ? [...modes, mode]
                    : [...modes.slice(0, clampedIndex - 1), mode, mode, ...modes.slice(clampedIndex)];
        set({
            active: true,
            anchors: next,
            segmentModes: nextModes,
            past: [...past, { anchors, segmentModes: modes }],
            future: [],
        });
    },

    moveAnchor: (index, to) => {
        const { anchors, past, segmentModes, manualMode } = get();
        const next = anchors.map((a, i) => (i === index ? { ...to } : a));
        const modes = normalizedModes(anchors.length, segmentModes);
        const nextModes = [...modes];
        // When manual mode is OFF, any moved anchor is treated as a normal routed waypoint:
        // its adjacent segments (even if created as manual straight lines) re-route along the road network.
        if (!manualMode) {
            if (index > 0 && index - 1 < nextModes.length) {
                nextModes[index - 1] = 'route';
            }
            if (index < nextModes.length) {
                nextModes[index] = 'route';
            }
        }
        set({
            anchors: next,
            segmentModes: nextModes,
            past: [...past, { anchors, segmentModes: modes }],
            future: [],
        });
    },

    removeAnchor: (index) => {
        const { anchors, segmentModes, past, manualMode } = get();
        const modes = normalizedModes(anchors.length, segmentModes);
        const survivors = anchors
            .map((anchor, i) => ({ anchor, index: i }))
            .filter(({ index: i }) => i !== index);
        set({
            anchors: survivors.map(({ anchor }) => anchor),
            segmentModes: modesAfterRemoval(survivors, modes, manualMode ? 'manual' : 'route'),
            past: [...past, { anchors, segmentModes: modes }],
            future: [],
            active: true,
        });
    },

    removeAnchors: (indices: number[]) => {
        const { anchors, segmentModes, past, manualMode } = get();
        const modes = normalizedModes(anchors.length, segmentModes);
        const indexSet = new Set(indices);
        const survivors = anchors
            .map((anchor, i) => ({ anchor, index: i }))
            .filter(({ index: i }) => !indexSet.has(i));
        const next = survivors.map(({ anchor }) => anchor);
        if (next.length === 0) {
            set({
                active: true,
                anchors: [],
                segmentModes: [],
                resultPoints: [],
                error: null,
                editingFileId: null,
                past: [...past, { anchors, segmentModes: modes }],
                future: [],
            });
        } else {
            set({
                anchors: next,
                segmentModes: modesAfterRemoval(survivors, modes, manualMode ? 'manual' : 'route'),
                past: [...past, { anchors, segmentModes: modes }],
                future: [],
                active: true,
            });
        }
    },

    reverseAnchors: () => {
        const { anchors, segmentModes, past } = get();
        const modes = normalizedModes(anchors.length, segmentModes);
        if (anchors.length < 2) return;
        // Each segment spans the same anchor pair after reversing, so modes reverse with them
        set({
            anchors: [...anchors].reverse(),
            segmentModes: [...modes].reverse(),
            past: [...past, { anchors, segmentModes: modes }],
            future: [],
        });
    },

    returnToStart: () => {
        const { anchors, segmentModes, past } = get();
        if (anchors.length < 2) return;
        const first = anchors[0]!;
        const last = anchors[anchors.length - 1]!;
        if (distance(first, last) < RETURN_TO_START_MIN_GAP_M) return;
        const modes = normalizedModes(anchors.length, segmentModes);

        // Outbound stays untouched; the return trip re-visits every node in
        // reverse order and ends back at the start, forming a closed loop.
        // Each return segment reuses the mode of its outbound counterpart
        // (road segments stay road, manual straight lines stay straight).
        set({
            active: true,
            anchors: [...anchors, ...[...anchors].reverse().slice(1)],
            segmentModes: [...modes, ...[...modes].reverse()],
            past: [...past, { anchors, segmentModes: modes }],
            future: [],
        });

        // Pre-fill the cache with the reversed geometry of cached road
        // segments so the return trip retraces the exact same roads with zero
        // network requests (a fresh reverse fetch could route differently
        // around one-way streets). Segments not in cache compute normally.
        const { profile, elevationPreference } = get();
        for (let i = 0; i < anchors.length - 1; i++) {
            if (modes[i] !== 'route') continue;
            const outbound = routingSegmentCache.get(
                getSegmentKey(anchors[i]!, anchors[i + 1]!, profile, elevationPreference)
            );
            if (outbound && outbound.length >= 2) {
                routingSegmentCache.set(
                    getSegmentKey(anchors[i + 1]!, anchors[i]!, profile, elevationPreference),
                    [...outbound].reverse()
                );
            }
        }
    },

    clear: (resetHistory = false) => {
        const { anchors, segmentModes, past } = get();
        const modes = normalizedModes(anchors.length, segmentModes);
        set({
            active: true,
            anchors: [],
            segmentModes: [],
            resultPoints: [],
            error: null,
            editingFileId: null,
            past: resetHistory ? [] : [...past, { anchors, segmentModes: modes }],
            future: [],
        });
    },

    setResult: (points, error) => set({ resultPoints: points, error }),
    setRouting: (routing) => set({ routing }),

    undo: () => {
        const { past, future, anchors, segmentModes } = get();
        if (past.length === 0) return;
        const previous = past[past.length - 1]!;
        set({
            anchors: previous.anchors,
            segmentModes: previous.segmentModes,
            past: past.slice(0, -1),
            future: [{ anchors, segmentModes }, ...future],
        });
    },

    redo: () => {
        const { past, future, anchors, segmentModes } = get();
        if (future.length === 0) return;
        const next = future[0]!;
        set({
            anchors: next.anchors,
            segmentModes: next.segmentModes,
            past: [...past, { anchors, segmentModes }],
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
            // A loaded track's segments are historical geometry: all road mode.
            // Manual mode (if on) only affects segments appended afterwards.
            segmentModes: new Array(Math.max(0, sampleAnchors.length - 1)).fill('route'),
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
        if (resultSeed && resultSeed.length === points.length) {
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
