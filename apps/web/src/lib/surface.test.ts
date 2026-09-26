import { describe, expect, it } from 'vitest';
import { TrackPoint } from '@x-route/gpx';
import { classifySurface, computeSurfaceStats } from './surface';

describe('classifySurface', () => {
    it('classifies explicit paved surfaces', () => {
        expect(classifySurface('asphalt')).toBe('paved');
        expect(classifySurface('concrete')).toBe('paved');
        expect(classifySurface('paving_stones')).toBe('paved');
        expect(classifySurface('cobblestone')).toBe('paved');
    });

    it('classifies explicit unpaved surfaces', () => {
        expect(classifySurface('gravel')).toBe('unpaved');
        expect(classifySurface('dirt')).toBe('unpaved');
        expect(classifySurface('ground')).toBe('unpaved');
        expect(classifySurface('sand')).toBe('unpaved');
        expect(classifySurface('compacted')).toBe('unpaved');
    });

    it('falls back to road_class when surface is missing or undefined', () => {
        expect(classifySurface('missing', 'primary')).toBe('paved');
        expect(classifySurface(undefined, 'secondary')).toBe('paved');
        expect(classifySurface(undefined, 'tertiary')).toBe('paved');
        expect(classifySurface(undefined, 'residential')).toBe('paved');
        expect(classifySurface(undefined, 'cycleway')).toBe('paved');

        expect(classifySurface(undefined, 'track')).toBe('unpaved');
        expect(classifySurface(undefined, 'path')).toBe('unpaved');
    });

    it('returns unknown when neither is known', () => {
        expect(classifySurface('missing', 'some_unknown_class')).toBe('unknown');
        expect(classifySurface(undefined, undefined)).toBe('unknown');
    });
});

describe('computeSurfaceStats', () => {
    it('handles empty or single-point routes', () => {
        const stats = computeSurfaceStats([]);
        expect(stats.pavedPct).toBe(100);
        expect(stats.unpavedPct).toBe(0);
        expect(stats.totalMeters).toBe(0);
    });

    it('computes distance-weighted surface proportions', () => {
        // Create 3 points: seg 1 (paved, ~1000m), seg 2 (gravel, ~1000m)
        const p1 = new TrackPoint({ attributes: { lat: 39.9, lon: 116.4 }, ele: 0, extensions: {} });
        p1._data = { surface: 'paved' };

        const p2 = new TrackPoint({ attributes: { lat: 39.909, lon: 116.4 }, ele: 0, extensions: {} });
        p2._data = { surface: 'paved' };

        const p3 = new TrackPoint({ attributes: { lat: 39.918, lon: 116.4 }, ele: 0, extensions: {} });
        p3._data = { surface: 'unpaved' };

        const stats = computeSurfaceStats([p1, p2, p3], 'km');
        expect(stats.totalMeters).toBeGreaterThan(1800);
        expect(stats.pavedPct).toBeCloseTo(50, -1);
        expect(stats.unpavedPct).toBeCloseTo(50, -1);
        expect(stats.pavedDistFormatted).toContain('km');
    });
});
