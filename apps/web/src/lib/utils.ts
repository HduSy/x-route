export { cn } from "cn";

import { TrackPoint, type Coordinates, crossarcDistance, distance } from '@x-route/gpx';

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
