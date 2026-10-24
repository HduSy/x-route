import { describe, expect, it } from 'vitest';
import { buildGPX, parseGPX } from '@x-route/gpx';
import { deriveShareKey } from './share-key';

const GPX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Loop Ride</name></metadata>
  <trk><trkseg>
    <trkpt lat="30.1234567" lon="120.6543211"><ele>12.34</ele></trkpt>
    <trkpt lat="30.1239567" lon="120.6547211"><ele>24.56</ele></trkpt>
    <trkpt lat="30.1243567" lon="120.6551211"><ele>8.9</ele></trkpt>
  </trkseg></trk>
</gpx>`;

describe('deriveShareKey', () => {
    it('is deterministic for identical content', async () => {
        expect(await deriveShareKey(GPX_XML)).toEqual(await deriveShareKey(GPX_XML));
    });

    it('is a 16-hex content-addressed key', async () => {
        expect(await deriveShareKey(GPX_XML)).toMatch(/^[0-9a-f]{16}$/);
    });

    it('survives the share → import → re-share round-trip (XML bytes differ, key must not)', async () => {
        // original poster sends buildGPX(S0); the importer re-sends
        // buildGPX(parseGPX(that XML)) — attribute order etc. differ
        const xmlA = buildGPX(parseGPX(GPX_XML), []);
        const xmlB = buildGPX(parseGPX(xmlA), []);
        expect(xmlA).not.toEqual(xmlB); // the byte instability is real…
        expect(await deriveShareKey(xmlB)).toEqual(await deriveShareKey(xmlA)); // …yet the key matches
    });

    it('ignores surface/extension enrichment written after the first share', async () => {
        const enriched = GPX_XML.replace(
            '</trkpt>',
            '<extensions><surface>asphalt</surface></extensions></trkpt>'
        );
        expect(await deriveShareKey(enriched)).toEqual(await deriveShareKey(GPX_XML));
    });

    it('ignores sub-GPS-noise coordinate differences (rounding floor)', async () => {
        const nudged = GPX_XML.replaceAll('30.1234567', '30.1234569');
        expect(await deriveShareKey(nudged)).toEqual(await deriveShareKey(GPX_XML));
    });

    it('changes when a point moves beyond the rounding floor', async () => {
        const moved = GPX_XML.replaceAll('lat="30.1239567"', 'lat="30.1289567"');
        expect(await deriveShareKey(moved)).not.toEqual(await deriveShareKey(GPX_XML));
    });

    it('changes when the route is renamed or a point is added', async () => {
        const base = await deriveShareKey(GPX_XML);

        const renamed = GPX_XML.replace('Loop Ride', 'Morning Ride');
        expect(await deriveShareKey(renamed)).not.toEqual(base);

        const extended = GPX_XML.replace(
            '</trkseg>',
            '<trkpt lat="30.1247567" lon="120.6555211"><ele>15</ele></trkpt></trkseg>'
        );
        expect(await deriveShareKey(extended)).not.toEqual(base);
    });
});
