import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
    locateWithRetry,
    isRetryableGeolocationError,
    GEOLOCATION_RETRY_DELAYS_MS,
} from './geolocation';

// Safari/WebKit hardening: kCLErrorLocationUnknown surfaces in JS as
// GeolocationPositionError code 2 ("Position update is unavailable") and
// fails BOTH accuracy layers in milliseconds while CoreLocation warms up.

/** WebKit's exact transient error from the field report. */
const kCLErrorLocationUnknown = {
    code: 2,
    message: 'Position update is unavailable',
} as GeolocationPositionError;

const permissionDenied = {
    code: 1,
    message: 'User denied Geolocation',
} as GeolocationPositionError;

const goodPosition = {
    coords: { latitude: 39.9, longitude: 116.4, accuracy: 10 },
    timestamp: 1759000000000,
} as unknown as GeolocationPosition;

interface GeoCall {
    highAccuracy: boolean;
}

/**
 * Replaces navigator.geolocation.getCurrentPosition. `behavior` maps each
 * raw call index to its outcome; every call "fails/succeeds instantly" like
 * WebKit pre-warm-up. Returns the call log for chain-shape assertions.
 */
function stubGeolocation(
    behavior: (callIndex: number) => { ok?: GeolocationPosition; err?: GeolocationPositionError }
) {
    const calls: GeoCall[] = [];
    vi.stubGlobal('navigator', {
        geolocation: {
            getCurrentPosition: (
                success: (p: GeolocationPosition) => void,
                failure: (e: GeolocationPositionError) => void,
                options?: PositionOptions
            ) => {
                const index = calls.length;
                calls.push({ highAccuracy: options?.enableHighAccuracy === true });
                const outcome = behavior(index);
                queueMicrotask(() => {
                    if (outcome.err) failure(outcome.err);
                    else success(outcome.ok!);
                });
            },
        },
    });
    return calls;
}

/** No-op sleep that records the requested backoff delays. */
function instantSleepRecorder() {
    const delays: number[] = [];
    const sleep = async (ms: number) => {
        delays.push(ms);
    };
    return { sleep, delays };
}

describe('isRetryableGeolocationError', () => {
    it('retries WebKit transient errors, never permission denial', () => {
        expect(isRetryableGeolocationError(kCLErrorLocationUnknown)).toBe(true); // code 2
        expect(isRetryableGeolocationError({ code: 3, message: 'timeout' })).toBe(true);
        expect(isRetryableGeolocationError(permissionDenied)).toBe(false); // code 1
    });
});

describe('locateWithRetry', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('two instant kCLErrorLocationUnknown failures, third attempt succeeds → position resolves, settles exactly once', async () => {
        // Chain attempt 1 = calls 0,1 (high, low) fail; attempt 2 = calls 2,3
        // fail; attempt 3 = call 4 (high) succeeds.
        const calls = stubGeolocation((i) => (i < 4 ? { err: kCLErrorLocationUnknown } : { ok: goodPosition }));
        const { sleep, delays } = instantSleepRecorder();

        let settled = false; // stands in for the isLocating flag flipping back
        const result = locateWithRetry(sleep).finally(() => {
            settled = true;
        });

        expect(settled).toBe(false); // still "spinning" while backing off
        const position = await result;

        expect(position.coords.latitude).toBe(39.9);
        expect(position.coords.longitude).toBe(116.4);
        expect(settled).toBe(true);
        // 2 failed chain attempts × 2 layers + final high-accuracy success
        expect(calls).toHaveLength(5);
        // every attempt starts high, falls back low (chain shape preserved)
        expect(calls.map((c) => c.highAccuracy)).toEqual([true, false, true, false, true]);
        // backoff waited 800ms then 1600ms; no 3200ms needed
        expect(delays).toEqual([GEOLOCATION_RETRY_DELAYS_MS[0], GEOLOCATION_RETRY_DELAYS_MS[1]]);
    });

    it('exhausts all retries before giving up with the last error', async () => {
        const calls = stubGeolocation(() => ({ err: kCLErrorLocationUnknown }));
        const { sleep, delays } = instantSleepRecorder();

        await expect(locateWithRetry(sleep)).rejects.toMatchObject({ code: 2 });
        // 4 chain attempts (initial + 3 retries) × 2 layers
        expect(calls).toHaveLength(8);
        expect(delays).toEqual([...GEOLOCATION_RETRY_DELAYS_MS]);
        // give-up keeps the classic warning
        expect(console.warn).toHaveBeenCalledWith(
            'Geolocation fallback error:',
            expect.objectContaining({ code: 2 })
        );
    });

    it('PERMISSION_DENIED is not retried', async () => {
        const calls = stubGeolocation(() => ({ err: permissionDenied }));
        const { sleep, delays } = instantSleepRecorder();

        await expect(locateWithRetry(sleep)).rejects.toMatchObject({ code: 1 });
        // high failed → low fallback tried once (chain unchanged), then stop
        expect(calls).toHaveLength(2);
        expect(delays).toEqual([]);
    });

    it('low-accuracy fallback inside one attempt still works without retries', async () => {
        // call 0 (high) fails transiently, call 1 (low) succeeds
        const calls = stubGeolocation((i) => (i === 0 ? { err: kCLErrorLocationUnknown } : { ok: goodPosition }));
        const { sleep, delays } = instantSleepRecorder();

        const position = await locateWithRetry(sleep);
        expect(position.coords.latitude).toBe(39.9);
        expect(calls.map((c) => c.highAccuracy)).toEqual([true, false]);
        expect(delays).toEqual([]);
    });
});
