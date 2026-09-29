// Geolocation with Safari/WebKit hardening.
//
// WebKit maps CoreLocation's kCLErrorLocationUnknown to POSITION_UNAVAILABLE
// (code 2) and reports it within milliseconds while CoreLocation is still
// warming up. The high→low accuracy chain therefore fails BOTH layers
// instantly, so the original "fallback once, then give up" behavior looked to
// the user like a spinner that dies for no reason. The fix: retry the whole
// chain with backoff on every error except PERMISSION_DENIED (code 1), which
// retrying can never fix.

/** W3C GeolocationPositionError.code for PERMISSION_DENIED. */
export const GEOLOCATION_PERMISSION_DENIED = 1;

/** Backoff before each retry of the accuracy chain. Three retries give
 *  CoreLocation ~5.6s of warm-up time on top of the request timeouts. */
export const GEOLOCATION_RETRY_DELAYS_MS = [800, 1600, 3200] as const;

const HIGH_ACCURACY_OPTIONS: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 5000,
    maximumAge: 5000,
};
const LOW_ACCURACY_OPTIONS: PositionOptions = {
    enableHighAccuracy: false,
    timeout: 6000,
    maximumAge: 5000,
};

/** Transient geolocation error worth retrying? PERMISSION_DENIED (1) never
 *  resolves by retrying; POSITION_UNAVAILABLE (2 — WebKit's kCLErrorLocation-
 *  Unknown) and TIMEOUT (3) usually do once the provider warms up. */
export function isRetryableGeolocationError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code !== GEOLOCATION_PERMISSION_DENIED
    );
}

function getCurrentPositionOnce(options: PositionOptions): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
}

/** One attempt: high accuracy first, low accuracy as fallback (unchanged). */
async function attemptAccuracyChain(): Promise<GeolocationPosition> {
    try {
        return await getCurrentPositionOnce(HIGH_ACCURACY_OPTIONS);
    } catch (highAccuracyError) {
        console.warn('Geolocation high accuracy error, trying fallback:', highAccuracyError);
        return await getCurrentPositionOnce(LOW_ACCURACY_OPTIONS);
    }
}

/**
 * Resolves with the user's position. The high→low accuracy chain is retried
 * with backoff (GEOLOCATION_RETRY_DELAYS_MS) while errors stay transient;
 * PERMISSION_DENIED rejects immediately. Before any final rejection the
 * classic "Geolocation fallback error" warning is emitted once.
 *
 * `sleep` is injectable for tests.
 */
export async function locateWithRetry(
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<GeolocationPosition> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await attemptAccuracyChain();
        } catch (err) {
            const delayMs = GEOLOCATION_RETRY_DELAYS_MS[attempt];
            if (delayMs === undefined || !isRetryableGeolocationError(err)) {
                // True give-up (retries exhausted or permission denied)
                console.warn('Geolocation fallback error:', err);
                throw err;
            }
            console.warn(`Geolocation unavailable (attempt ${attempt + 1}), retrying in ${delayMs}ms:`, err);
            await sleep(delayMs);
        }
    }
}
