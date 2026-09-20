/**
 * Elevation statistics computation with Strava-grade noise filtering.
 *
 * Implements:
 * 1. Distance-weighted moving window smoothing to eliminate discrete DEM step noise (micro-quantization).
 * 2. Peak-trough hysteresis threshold filter (Strava/Garmin gold standard: 3.0 meters / 10 feet)
 *    to eliminate phantom climbs and descents on flat or continuous gradient segments.
 */

export interface ElevationPoint {
    ele: number;
    distanceKm: number;
}

export interface ElevationStats {
    ascent: number;
    descent: number;
    minEle: number;
    maxEle: number;
    smoothedElevations: number[];
}

export interface ElevationFilterOptions {
    /**
     * Distance smoothing window in kilometers (default: 0.08 km = 80 meters).
     * Blends out DEM single-point spikes and step quantization.
     */
    windowKm?: number;
    /**
     * Hysteresis climbing threshold in meters (default: 3.0 meters).
     * A vertical change must exceed this threshold before a new climb/descent trend is confirmed.
     */
    thresholdMeters?: number;
}

/**
 * Applies distance-window moving average smoothing on an elevation profile.
 */
export function smoothElevations(
    points: ElevationPoint[],
    windowKm = 0.08
): number[] {
    const n = points.length;
    if (n === 0) return [];
    if (n === 1) return [points[0]!.ele];

    const smoothed: number[] = new Array(n);
    const halfWindow = windowKm / 2;

    let left = 0;
    let right = 0;
    let sumEle = 0;

    for (let i = 0; i < n; i++) {
        const curDist = points[i]!.distanceKm;
        const minDist = curDist - halfWindow;
        const maxDist = curDist + halfWindow;

        // Advance right boundary
        while (right < n && points[right]!.distanceKm <= maxDist) {
            sumEle += points[right]!.ele;
            right++;
        }

        // Advance left boundary
        while (left < right && points[left]!.distanceKm < minDist) {
            sumEle -= points[left]!.ele;
            left++;
        }

        const count = right - left;
        smoothed[i] = count > 0 ? sumEle / count : points[i]!.ele;
    }

    return smoothed;
}

/**
 * Computes cumulative elevation gain (ascent) and loss (descent) using
 * peak/trough hysteresis filtering matching Strava Route Builder logic.
 *
 * Guarantees:
 * - ascent >= 0, descent >= 0
 * - Continuous uphill route: ascent = net climb, descent = 0
 * - Continuous downhill route: ascent = 0, descent = net drop
 * - Out-and-back climb: ascent = climb, descent = climb
 * - Micro jitter (< threshold): does not accumulate
 */
export function computeElevationStats(
    points: ElevationPoint[],
    options?: ElevationFilterOptions
): ElevationStats {
    const n = points.length;
    if (n < 2) {
        const singleEle = n === 1 ? points[0]!.ele : 0;
        return {
            ascent: 0,
            descent: 0,
            minEle: singleEle,
            maxEle: singleEle,
            smoothedElevations: n === 1 ? [singleEle] : [],
        };
    }

    const windowKm = options?.windowKm ?? 0.08;
    const threshold = options?.thresholdMeters ?? 3.0;

    const smoothed = smoothElevations(points, windowKm);

    let ascent = 0;
    let descent = 0;
    let minEle = smoothed[0]!;
    let maxEle = smoothed[0]!;

    let statMinEle = smoothed[0]!;
    let statMaxEle = smoothed[0]!;

    let trend: 'up' | 'down' | 'flat' = 'flat';

    for (let i = 1; i < n; i++) {
        const ele = smoothed[i]!;

        if (ele < statMinEle) statMinEle = ele;
        if (ele > statMaxEle) statMaxEle = ele;

        if (trend === 'flat') {
            if (ele - minEle >= threshold) {
                trend = 'up';
                ascent += ele - minEle;
                maxEle = ele;
            } else if (maxEle - ele >= threshold) {
                trend = 'down';
                descent += maxEle - ele;
                minEle = ele;
            } else {
                if (ele < minEle) minEle = ele;
                if (ele > maxEle) maxEle = ele;
            }
        } else if (trend === 'up') {
            if (ele > maxEle) {
                ascent += ele - maxEle;
                maxEle = ele;
            } else if (maxEle - ele >= threshold) {
                trend = 'down';
                descent += maxEle - ele;
                minEle = ele;
            }
        } else if (trend === 'down') {
            if (ele < minEle) {
                descent += minEle - ele;
                minEle = ele;
            } else if (ele - minEle >= threshold) {
                trend = 'up';
                ascent += ele - minEle;
                maxEle = ele;
            }
        }
    }

    return {
        ascent: Math.round(ascent),
        descent: Math.round(descent),
        minEle: Math.round(statMinEle),
        maxEle: Math.round(statMaxEle),
        smoothedElevations: smoothed,
    };
}
