export { cn } from "cn";

import { TrackPoint, type Coordinates, crossarcDistance, distance } from '@x-route/gpx';

export interface PanelRect {
    left: number;
    width: number;
}

/**
 * Pure geometry core: does the right-anchored drawer cover the planner's
 * on-screen footprint? The planner aside is left-anchored (left-0 /
 * sm:left-0), so its footprint is [0, width] even while it is translated
 * off-canvas collapsed — collapsing only shifts it, the width stays. The
 * drawer extends rightward from its left edge, so it covers the planner
 * iff it starts before the planner's footprint ends (abutting is not
 * covering). Follows whatever the CSS layout actually does — no pixel
 * breakpoint to keep in sync.
 */
export function drawerOverlaysPanelRects(panelRect: PanelRect, drawerRect: PanelRect): boolean {
    return drawerRect.left < panelRect.width;
}

/**
 * On small layouts the My Routes drawer is a fixed overlay covering ~85vw —
 * including the route builder sidebar it expands above. Entering edit mode
 * must close the drawer there, or the freshly expanded planning panel stays
 * hidden behind it. Measured live at call time (i.e. at the edit click), so
 * there is no resize/mount bookkeeping to go stale.
 */
export function drawerOverlaysSidebar(): boolean {
    if (typeof document === 'undefined') return false;
    const panel = document.querySelector<HTMLElement>('[data-panel="planner"]');
    const drawer = document.querySelector<HTMLElement>('[data-panel="my-routes"]');
    if (!panel || !drawer) return false;
    return drawerOverlaysPanelRects(panel.getBoundingClientRect(), drawer.getBoundingClientRect());
}

export interface ClosestPointDetails {
    before: boolean;
    index: number;
    distance: number;
}

/**
 * Finds the trackpoint in a line segment that is closest to the given target coordinate,
 * and records whether the target is before or after the vertex, along with the segment index and distance in meters.
 */
export function getClosestLinePoint(
    points: TrackPoint[],
    point: TrackPoint | Coordinates,
    details?: Partial<ClosestPointDetails>
): TrackPoint | null {
    if (points.length === 0) return null;
    let closest = points[0]!;
    let closestDist = Number.MAX_VALUE;

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i]!;
        const p2 = points[i + 1]!;
        const dist = crossarcDistance(p1, p2, point);
        if (dist < closestDist) {
            closestDist = dist;
            if (distance(p1, point) <= distance(p2, point)) {
                closest = p1;
                if (details) {
                    details.before = true;
                    details.index = i;
                }
            } else {
                closest = p2;
                if (details) {
                    details.before = false;
                    details.index = i + 1;
                }
            }
        }
    }

    if (details) {
        details.distance = closestDist;
    }
    return closest;
}
