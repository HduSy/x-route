import { GPXFile } from '@x-route/gpx';

// --- Canonical route digest (share dedup) ---
// The share key itself is random; dedup happens through a canonical SHA-256
// of the route content. Same content must always hash identically so that
// re-sharing a route — including one re-imported from a share link, after the
// lossless parse/buildGPX round-trip — maps back to the existing share entry
// instead of minting a duplicate.
//
// Stability notes:
// - buildGPX writes lat/lon/ele at full JS double precision and parseGPX
//   reads them back losslessly, so imported copies hash equal to the origin.
// - Values are still rounded to the GPS noise floor (~1e-6 deg / cm ele) so
//   routes that merely travelled through another tool also dedup.
// - Only the route name and track points participate: builder timestamps,
//   creator strings, and XML formatting must never split a share.

/** Round-trip-stable digest of a route: name + ordered track points. */
export async function computeRouteHash(file: GPXFile): Promise<string> {
    const parts: string[] = [file.metadata?.name?.trim() ?? ''];
    for (const pt of file.getTrackPoints()) {
        const { lat, lon } = pt.getCoordinates();
        parts.push(`${lat.toFixed(6)},${lon.toFixed(6)},${(pt.ele ?? 0).toFixed(2)}`);
    }
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(parts.join('\n'))
    );
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
