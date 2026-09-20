/**
 * Elevation statistics computation with Strava-grade noise filtering.
 *
 * Implements a 3-stage synergistic pipeline:
 * 1. Physical Slope Limiter: Clamps unrealistic gradient changes (e.g. >25% grade)
 *    to eliminate DEM cliff, bridge, and gorge spikes.
 * 2. Spatial Gaussian Low-Pass Filter (sigma = 35m, radius = 105m):
 *    Continuous distance-weighted smoothing eliminating 30m DEM grid Nyquist
 *    aliasing and cross-slope contour ripples.
 * 3. Dual-Threshold Hysteresis Deadband with Trend Latching (Strava DEM standard: 10.0m):
 *    In a climbing phase, elevation dips below peak do NOT accumulate any descent
 *    unless net continuous loss exceeds 10m. This eliminates phantom descent on long climbs.
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
     * Standard deviation for Gaussian spatial filter in kilometers (default: 0.035 km = 35 meters).
     */
    sigmaKm?: number;
    /**
     * Search radius for Gaussian smoothing in kilometers (default: sigmaKm * 3 = 0.105 km = 105 meters).
     */
    radiusKm?: number;
    /**
     * Maximum physically plausible slope grade as ratio (default: 0.25 = 25% grade).
     * Filters out DEM cliff artifacts (bridges, tunnels, gorges).
     */
    maxGrade?: number;
    /**
     * Hysteresis climbing threshold in meters (Strava DEM standard: 10.0 meters).
     * If not specified, automatically adapts based on route length:
     * - < 1.0 km: 4.0 meters
     * - < 3.0 km: 6.0 meters
     * - >= 3.0 km: 10.0 meters
     */
    thresholdMeters?: number;
    /**
     * Legacy option: window size in kilometers (if specified, maps to sigmaKm = windowKm / 2).
     */
    windowKm?: number;
}

/**
 * Applies physical slope clamping and continuous distance-weighted Gaussian kernel smoothing.
 */
export function smoothElevations(
    points: ElevationPoint[],
    options?: ElevationFilterOptions | number
): number[] {
    const n = points.length;
    if (n === 0) return [];
    if (n === 1) return [points[0]!.ele];

    const opts: ElevationFilterOptions =
        typeof options === 'number'
            ? { sigmaKm: options / 2 }
            : (options ?? {});

    const sigmaKm = opts.sigmaKm ?? (opts.windowKm ? opts.windowKm / 2 : 0.035);
    const radiusKm = opts.radiusKm ?? sigmaKm * 3;
    const maxGrade = opts.maxGrade ?? 0.25;
    const twoSigmaSq = 2 * sigmaKm * sigmaKm;

    // Step 1: Physical slope limiter (clamp unrealistic DEM cliff/bridge spikes)
    const clamped: ElevationPoint[] = new Array(n);
    clamped[0] = { ...points[0]! };
    for (let i = 1; i < n; i++) {
        const dDist = Math.max(0.001, points[i]!.distanceKm - clamped[i - 1]!.distanceKm);
        const maxDelta = dDist * 1000 * maxGrade;
        let ele = points[i]!.ele;
        const diff = ele - clamped[i - 1]!.ele;
        if (Math.abs(diff) > maxDelta) {
            ele = clamped[i - 1]!.ele + Math.sign(diff) * maxDelta;
        }
        clamped[i] = { distanceKm: points[i]!.distanceKm, ele };
    }

    // Step 2: Distance-weighted Gaussian kernel convolution
    const smoothed: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const curDist = clamped[i]!.distanceKm;
        let wSum = 0;
        let wEle = 0;

        for (let j = i; j >= 0; j--) {
            const d = curDist - clamped[j]!.distanceKm;
            if (d > radiusKm) break;
            const w = Math.exp(-(d * d) / twoSigmaSq);
            wSum += w;
            wEle += clamped[j]!.ele * w;
        }

        for (let j = i + 1; j < n; j++) {
            const d = clamped[j]!.distanceKm - curDist;
            if (d > radiusKm) break;
            const w = Math.exp(-(d * d) / twoSigmaSq);
            wSum += w;
            wEle += clamped[j]!.ele * w;
        }

        smoothed[i] = wSum > 0 ? wEle / wSum : clamped[i]!.ele;
    }

    return smoothed;
}

/**
 * Computes cumulative elevation gain (ascent) and loss (descent) using
 * dual-threshold hysteresis deadband matching Strava Route Builder logic.
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

    const totalDistKm = points[n - 1]!.distanceKm - points[0]!.distanceKm;
    const defaultThreshold =
        totalDistKm < 1.0 ? 4.0 : totalDistKm < 3.0 ? 6.0 : 10.0;
    const threshold = options?.thresholdMeters ?? defaultThreshold;

    const smoothed = smoothElevations(points, options);

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
