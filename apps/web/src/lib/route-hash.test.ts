import { describe, expect, it } from 'vitest';
import { buildGPX, parseGPX } from '@x-route/gpx';
import { computeRouteHash } from './route-hash';

const GPX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Loop Ride</name></metadata>
  <trk><trkseg>
    <trkpt lat="30.1234567" lon="120.6543211"><ele>12.34</ele></trkpt>
    <trkpt lat="30.1239567" lon="120.6547211"><ele>24.56</ele></trkpt>
    <trkpt lat="30.1243567" lon="120.6551211"><ele>8.9</ele></trkpt>
  </trkseg></trk>
</gpx>`;

describe('computeRouteHash', () => {
    it('is deterministic for identical content', async () => {
        const a = await computeRouteHash(parseGPX(GPX_XML));
        const b = await computeRouteHash(parseGPX(GPX_XML));
        expect(a).toEqual(b);
    });

    it('survives the buildGPX → parseGPX round-trip (share → import → re-share)', async () => {
        const original = parseGPX(GPX_XML);
        const roundTripped = parseGPX(buildGPX(original, []));
        expect(await computeRouteHash(roundTripped)).toEqual(await computeRouteHash(original));
    });

    it('ignores sub-GPS-noise coordinate differences (rounding floor)', async () => {
        const nudged = GPX_XML.replaceAll('30.1234567', '30.1234569');
        expect(await computeRouteHash(parseGPX(nudged))).toEqual(
            await computeRouteHash(parseGPX(GPX_XML))
        );
    });

    it('changes when a point moves beyond the rounding floor', async () => {
        const moved = GPX_XML.replaceAll('lat="30.1239567"', 'lat="30.1289567"');
        expect(await computeRouteHash(parseGPX(moved))).not.toEqual(
            await computeRouteHash(parseGPX(GPX_XML))
        );
    });

    it('changes when the route is renamed or a point is added', async () => {
        const base = await computeRouteHash(parseGPX(GPX_XML));

        const renamed = GPX_XML.replace('Loop Ride', 'Morning Ride');
        expect(await computeRouteHash(parseGPX(renamed))).not.toEqual(base);

        const extended = GPX_XML.replace(
            '</trkseg>',
            '<trkpt lat="30.1247567" lon="120.6555211"><ele>15</ele></trkpt></trkseg>'
        );
        expect(await computeRouteHash(parseGPX(extended))).not.toEqual(base);
    });
});
