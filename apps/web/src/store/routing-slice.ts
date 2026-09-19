import { create } from 'zustand';
import type { Coordinates, TrackPoint } from '@x-route/gpx';

// AD-2 routing slice: anchors (start / via / end), profile and the computed
// result. Anchor history is snapshotted — anchors are a tiny array, so full
// snapshots are cheap (the heavyweight Command-pattern undo stack in AD-2
// applies to file edits, not this UI-level state).

export interface RoutingAnchor extends Coordinates {}

interface RoutingState {
    active: boolean;
    anchors: RoutingAnchor[];
    profile: string;
    resultPoints: TrackPoint[];
    routing: boolean; // request in flight
    error: string | null;
    past: RoutingAnchor[][];
    future: RoutingAnchor[][];

    setActive: (active: boolean) => void;
    setProfile: (profile: string) => void;
    addAnchor: (anchor: RoutingAnchor) => void;
    insertAnchor: (index: number, anchor: RoutingAnchor) => void;
    moveAnchor: (index: number, to: Coordinates) => void;
    removeAnchor: (index: number) => void;
    clear: () => void;
    setResult: (points: TrackPoint[], error: string | null) => void;
    setRouting: (routing: boolean) => void;
    undo: () => void;
    redo: () => void;
}

export const useRoutingStore = create<RoutingState>()((set, get) => ({
    active: false,
    anchors: [],
    profile: 'bike',
    resultPoints: [],
    routing: false,
    error: null,
    past: [],
    future: [],

    setActive: (active) => set({ active }),
    setProfile: (profile) => set({ profile }),

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
}));
