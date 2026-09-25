import { useMemo, useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { Bike, ChevronDown, ChevronUp, Footprints } from 'lucide-react';
import { useRoutingStore } from '@/store/routing-slice';
import { useSelectionStore } from '@/store/selection-slice';
import { useT } from '@/store/i18n-slice';
import { distance, GPXFile } from '@x-route/gpx';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { mapManager } from '@/lib/map/MapManager';
import { cn } from '@/lib/utils';

Chart.register(...registerables);

import { computeElevationStats } from '@/lib/elevation';

interface ProfilePoint {
    distanceKm: number;
    ele: number;
    lat: number;
    lon: number;
}

interface SlopeBracket {
    id: number;
    label: string;
    borderColor: string;
    backgroundColor: string;
}

/**
 * Maps gradient (slope) to BRouter-Web / geo-data-exchange steepness categories with color and translucent fill.
 * Matches BRouter's exact 11 standard gradient levels (-5 to 5):
 * level -5:      ... -16% (< -15%)
 * level -4: -15% ... -10% (-10 ~ -15%)
 * level -3:  -9% ...  -7% (-7 ~ -9%)
 * level -2:  -6% ...  -4% (-4 ~ -6%)
 * level -1:  -3% ...  -1% (-1 ~ -3%)
 * level  0:   0%
 * level  1:   1% ...   3% (1-3%)
 * level  2:   4% ...   6% (4-6%)
 * level  3:   7% ...   9% (7-9%)
 * level  4:  10% ...  15% (10-15%)
 * level  5:  16% ...      (> 15%)
 */
function getSlopeBracket(slope: number): SlopeBracket {
    if (slope < -15.5) {
        return { id: -5, label: '< -15%', borderColor: '#0369A1', backgroundColor: 'rgba(3, 105, 161, 0.16)' };
    } else if (slope < -9.5) {
        return { id: -4, label: '-10 ~ 15%', borderColor: '#0284C7', backgroundColor: 'rgba(2, 132, 199, 0.16)' };
    } else if (slope < -6.5) {
        return { id: -3, label: '-7 ~ 9%', borderColor: '#0EA5E9', backgroundColor: 'rgba(14, 165, 233, 0.16)' };
    } else if (slope < -3.5) {
        return { id: -2, label: '-4 ~ 6%', borderColor: '#38BDF8', backgroundColor: 'rgba(56, 189, 248, 0.16)' };
    } else if (slope < -1.0) {
        return { id: -1, label: '-1 ~ 3%', borderColor: '#60A5FA', backgroundColor: 'rgba(96, 165, 250, 0.16)' };
    } else if (slope <= 1.0) {
        return { id: 0, label: '0%', borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.16)' };
    } else if (slope <= 3.5) {
        return { id: 1, label: '1-3%', borderColor: '#FACC15', backgroundColor: 'rgba(250, 204, 21, 0.18)' };
    } else if (slope <= 6.5) {
        return { id: 2, label: '4-6%', borderColor: '#F59E0B', backgroundColor: 'rgba(245, 158, 11, 0.20)' };
    } else if (slope <= 9.5) {
        return { id: 3, label: '7-9%', borderColor: '#F97316', backgroundColor: 'rgba(249, 115, 22, 0.22)' };
    } else if (slope <= 15.5) {
        return { id: 4, label: '10-15%', borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.24)' };
    } else {
        return { id: 5, label: '> 15%', borderColor: '#863BFF', backgroundColor: 'rgba(134, 59, 255, 0.28)' };
    }
}

interface SegmentInfo {
    lengthKm: number;
    bracket: SlopeBracket;
    slope: number;
}

function buildSegmentMap(pts: ProfilePoint[]): SegmentInfo[] {
    if (pts.length < 2) {
        return pts.map(() => ({ lengthKm: 0.1, bracket: getSlopeBracket(0), slope: 0 }));
    }

    const totalDistKm = pts[pts.length - 1]!.distanceKm - pts[0]!.distanceKm;
    const totalDistMeters = totalDistKm * 1000;

    // BRouter geo-data-exchange normalization distance threshold:
    // Scale dynamically with route length:
    // Short trips (< 2km): 120m - 240m
    // Medium trips (2-10km): 250m - 500m
    // Long trips (> 10km): 450m - 2200m
    const minNormalizationDistMeters =
        totalDistKm <= 2
            ? Math.max(120, totalDistMeters * 0.12)
            : totalDistKm <= 10
            ? Math.max(250, totalDistMeters * 0.045)
            : Math.max(450, Math.min(2200, totalDistMeters * 0.03));

    const calcGradient = (p0: ProfilePoint, p1: ProfilePoint): number => {
        const d = (p1.distanceKm - p0.distanceKm) * 1000;
        if (d <= 1.0) return 0;
        return ((p1.ele - p0.ele) / d) * 100;
    };

    // Filter points closer than 30m (BRouter _isInFuzzyRange) to eliminate high-frequency DEM noise
    const filteredIndices: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
        const lastIdx = filteredIndices[filteredIndices.length - 1]!;
        if ((pts[i]!.distanceKm - pts[lastIdx]!.distanceKm) * 1000 >= 30 || i === pts.length - 1) {
            filteredIndices.push(i);
        }
    }
    if (filteredIndices.length < 2) {
        filteredIndices.push(pts.length - 1);
    }

    interface RawFeature {
        start: number;
        end: number;
        lenMeters: number;
        bracket: SlopeBracket;
        slope: number;
    }

    const features: RawFeature[] = [];
    let startIdx = filteredIndices[0]!;
    let curLenMeters = (pts[filteredIndices[1]!]!.distanceKm - pts[startIdx]!.distanceKm) * 1000;
    let prevSlope = calcGradient(pts[startIdx]!, pts[filteredIndices[1]!]!);
    let prevBracket = getSlopeBracket(prevSlope);

    for (let f = 2; f < filteredIndices.length; f++) {
        const prevIdx = filteredIndices[f - 1]!;
        const curIdx = filteredIndices[f]!;
        const stepDist = (pts[curIdx]!.distanceKm - pts[prevIdx]!.distanceKm) * 1000;
        const curSlope = calcGradient(pts[prevIdx]!, pts[curIdx]!);
        const curBracket = getSlopeBracket(curSlope);
        curLenMeters += stepDist;

        // Inflection point: clear switch between climb (>1.5%) and descent (<-1.5%)
        const isOpposite =
            ((prevSlope > 1.5 && curSlope < -1.5) || (prevSlope < -1.5 && curSlope > 1.5)) &&
            curLenMeters >= Math.min(minNormalizationDistMeters, 200);

        if (curBracket.id !== prevBracket.id) {
            if (curLenMeters < minNormalizationDistMeters && !isOpposite) {
                // Absorb into ongoing segment (BRouter geoDataExchange normalization)
                prevSlope = calcGradient(pts[startIdx]!, pts[curIdx]!);
                prevBracket = getSlopeBracket(prevSlope);
            } else {
                const segSlope = calcGradient(pts[startIdx]!, pts[prevIdx]!);
                features.push({
                    start: startIdx,
                    end: prevIdx,
                    lenMeters: (pts[prevIdx]!.distanceKm - pts[startIdx]!.distanceKm) * 1000,
                    bracket: getSlopeBracket(segSlope),
                    slope: segSlope,
                });
                startIdx = prevIdx;
                curLenMeters = stepDist;
                prevSlope = curSlope;
                prevBracket = curBracket;
            }
        }
    }

    // Process final segment
    const finalEndIdx = pts.length - 1;
    const lastLenMeters = (pts[finalEndIdx]!.distanceKm - pts[startIdx]!.distanceKm) * 1000;
    if (lastLenMeters < minNormalizationDistMeters && features.length > 0) {
        const last = features[features.length - 1]!;
        last.end = finalEndIdx;
        last.lenMeters = (pts[finalEndIdx]!.distanceKm - pts[last.start]!.distanceKm) * 1000;
        last.slope = calcGradient(pts[last.start]!, pts[finalEndIdx]!);
        last.bracket = getSlopeBracket(last.slope);
    } else {
        const segSlope = calcGradient(pts[startIdx]!, pts[finalEndIdx]!);
        features.push({
            start: startIdx,
            end: finalEndIdx,
            lenMeters: lastLenMeters,
            bracket: getSlopeBracket(segSlope),
            slope: segSlope,
        });
    }

    // Coalesce adjacent segments that share the same bracket (up to 2 passes)
    let merged = features;
    for (let pass = 0; pass < 2; pass++) {
        const next: RawFeature[] = [];
        for (const f of merged) {
            if (next.length > 0 && next[next.length - 1]!.bracket.id === f.bracket.id) {
                const prev = next[next.length - 1]!;
                prev.end = f.end;
                prev.lenMeters = (pts[f.end]!.distanceKm - pts[prev.start]!.distanceKm) * 1000;
                prev.slope = calcGradient(pts[prev.start]!, pts[f.end]!);
                prev.bracket = getSlopeBracket(prev.slope);
            } else {
                next.push({ ...f });
            }
        }
        merged = next;
    }

    // Map point index to segment info
    const map: SegmentInfo[] = new Array(pts.length);
    for (const seg of merged) {
        const lengthKm = Math.max(0.05, pts[seg.end]!.distanceKm - pts[seg.start]!.distanceKm);
        for (let i = seg.start; i <= seg.end; i++) {
            map[i] = {
                lengthKm,
                bracket: seg.bracket,
                slope: seg.slope,
            };
        }
    }

    // Safety fallback for any unassigned indices
    for (let i = 0; i < pts.length; i++) {
        if (!map[i]) {
            map[i] = map[i > 0 ? i - 1 : 0] || {
                lengthKm: 0.1,
                bracket: getSlopeBracket(0),
                slope: 0,
            };
        }
    }

    return map;
}

export function RouteStatsBar() {
    const { t } = useT();

    // Store state
    const resultPoints = useRoutingStore((s) => s.resultPoints);
    const profile = useRoutingStore((s) => s.profile);
    const units = useRoutingStore((s) => s.units);
    const elevationExpanded = useRoutingStore((s) => s.elevationExpanded);
    const toggleElevation = useRoutingStore((s) => s.toggleElevation);
    const selectedFileId = useSelectionStore((s) => s.selectedFileId);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const chartRef = useRef<Chart | null>(null);
    const sampledRef = useRef<ProfilePoint[]>([]);
    const segmentMapRef = useRef<SegmentInfo[]>([]);
    const totalDistRef = useRef(0);
    const prevUnitsRef = useRef(units);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const tooltipArrowRef = useRef<HTMLDivElement | null>(null);
    const tooltipContentRef = useRef<HTMLDivElement | null>(null);

    const latestTRef = useRef(t);
    latestTRef.current = t;
    const latestUnitsRef = useRef(units);
    latestUnitsRef.current = units;

    // Selected file from Dexie (if not planning or viewing saved file)
    const selectedFile = useLiveQuery(
        () => (selectedFileId ? db.files.get(selectedFileId) : undefined),
        [selectedFileId]
    );

    // Build data points and elevation statistics in a single pass
    const { pointsData, eleStats } = useMemo(() => {
        const build = (
            rawPoints: { lat: number; lon: number; ele?: number }[]
        ) => {
            if (rawPoints.length < 2) {
                return {
                    pointsData: [] as ProfilePoint[],
                    eleStats: {
                        ascent: 0,
                        descent: 0,
                        minEle: 0,
                        maxEle: 0,
                        smoothedElevations: [],
                    },
                };
            }
            const list: { distanceKm: number; ele: number; lat: number; lon: number }[] = [];
            let totalDist = 0;
            for (let i = 0; i < rawPoints.length; i++) {
                const pt = rawPoints[i]!;
                if (i > 0) {
                    const prev = rawPoints[i - 1]!;
                    totalDist += distance(prev, pt) / 1000;
                }
                list.push({
                    distanceKm: totalDist,
                    ele: pt.ele ?? 0,
                    lat: pt.lat,
                    lon: pt.lon,
                });
            }
            const stats = computeElevationStats(list);
            const formattedPoints: ProfilePoint[] = list.map((p, idx) => ({
                ...p,
                ele: Number((stats.smoothedElevations[idx] ?? p.ele).toFixed(1)),
            }));
            return { pointsData: formattedPoints, eleStats: stats };
        };

        if (resultPoints.length >= 2) {
            return build(
                resultPoints.map((p) => ({
                    lat: p.attributes.lat,
                    lon: p.attributes.lon,
                    ele: p.ele,
                }))
            );
        }

        if (selectedFile) {
            const file = new GPXFile(selectedFile);
            const trkpts = file.getTrackPoints();
            if (trkpts.length >= 2) {
                return build(
                    trkpts.map((p) => {
                        const coords = p.getCoordinates();
                        return {
                            lat: coords.lat,
                            lon: coords.lon,
                            ele: p.ele,
                        };
                    })
                );
            }
        }

        return {
            pointsData: [] as ProfilePoint[],
            eleStats: {
                ascent: 0,
                descent: 0,
                minEle: 0,
                maxEle: 0,
                smoothedElevations: [],
            },
        };
    }, [resultPoints, selectedFile]);

    // Statistics computation
    const stats = useMemo(() => {
        if (pointsData.length < 2) {
            return {
                distKm: 0,
                distFormatted: units === 'mi' ? '0 mi' : '0 km',
                ascent: 0,
                ascentFormatted: units === 'mi' ? '0 ft' : '0 m',
                descent: 0,
                descentFormatted: units === 'mi' ? '0 ft' : '0 m',
                timeFormatted: '0s',
            };
        }

        const totalKm = pointsData[pointsData.length - 1]!.distanceKm;
        const ascent = eleStats.ascent;
        const descent = eleStats.descent;

        // Speed estimates per activity profile
        let speedKmh = 20; // Default ride
        if (profile === 'racing_bike') {
            speedKmh = 25;
        } else if (profile === 'gravel_bike') {
            speedKmh = 18;
        } else if (profile === 'mountain_bike') {
            speedKmh = 13;
        } else if (profile === 'foot') {
            speedKmh = 9.5; // run
        } else if (profile === 'hike') {
            speedKmh = 4.5; // hike
        }

        const totalSecs = Math.round((totalKm / speedKmh) * 3600);
        let timeStr = '0s';
        if (totalSecs >= 3600) {
            const h = Math.floor(totalSecs / 3600);
            const m = Math.floor((totalSecs % 3600) / 60);
            timeStr = `${h}h ${m}m`;
        } else if (totalSecs >= 60) {
            const m = Math.floor(totalSecs / 60);
            const s = totalSecs % 60;
            timeStr = `${m}m ${s}s`;
        } else if (totalSecs > 0) {
            timeStr = `${totalSecs}s`;
        }

        const distVal = units === 'mi' ? totalKm * 0.621371 : totalKm;
        const distUnit = units === 'mi' ? 'mi' : 'km';
        const eleGainVal = units === 'mi' ? Math.round(ascent * 3.28084) : ascent;
        const eleLossVal = units === 'mi' ? Math.round(descent * 3.28084) : descent;
        const eleUnit = units === 'mi' ? 'ft' : 'm';

        return {
            distKm: totalKm,
            distFormatted: `${distVal.toFixed(1)} ${distUnit}`,
            ascent,
            ascentFormatted: `+${eleGainVal} ${eleUnit}`,
            descent,
            descentFormatted: `${eleLossVal} ${eleUnit}`,
            timeFormatted: timeStr,
        };
    }, [pointsData, eleStats, profile, units]);

    // Chart.js rendering
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (pointsData.length < 2 || !elevationExpanded) {
            mapManager.setCursor(null);
            chartRef.current?.destroy();
            chartRef.current = null;
            return;
        }

        if (prevUnitsRef.current !== units) {
            prevUnitsRef.current = units;
            chartRef.current?.destroy();
            chartRef.current = null;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const step = Math.max(1, Math.floor(pointsData.length / 600));
        const sampled = pointsData.filter(
            (_, idx) => idx % step === 0 || idx === pointsData.length - 1
        );
        sampledRef.current = sampled;
        segmentMapRef.current = buildSegmentMap(sampled);

        const totalDist =
            units === 'mi'
                ? (sampled[sampled.length - 1]?.distanceKm ?? 0) * 0.621371
                : (sampled[sampled.length - 1]?.distanceKm ?? 0);
        totalDistRef.current = totalDist;

        const chartData = sampled.map((p) => ({
            x: units === 'mi' ? p.distanceKm * 0.621371 : p.distanceKm,
            y: units === 'mi' ? Number((p.ele * 3.28084).toFixed(1)) : p.ele,
        }));

        // Dynamic vertical range (BRouter Heightgraph formula) - single pass O(n) loop
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < chartData.length; i++) {
            const y = chartData[i]!.y;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        if (!Number.isFinite(minY)) minY = 0;
        if (!Number.isFinite(maxY)) maxY = 100;
        const rangeY = maxY - minY;
        const padY = rangeY < 10 ? 10 : Math.max(4, rangeY * 0.12);
        const yMinScale = Math.max(0, Math.floor(minY - padY));
        const yMaxScale = Math.ceil(maxY + padY);

        if (chartRef.current) {
            chartRef.current.data.datasets[0]!.data = chartData as any;
            if (chartRef.current.options.scales?.x) {
                chartRef.current.options.scales.x.min = 0;
                chartRef.current.options.scales.x.max = Math.max(0.01, totalDist);
            }
            if (chartRef.current.options.scales?.y) {
                chartRef.current.options.scales.y.min = yMinScale;
                chartRef.current.options.scales.y.max = yMaxScale;
            }
            chartRef.current.update('none');
            return;
        }

        chartRef.current = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Elevation',
                        data: chartData as any,
                        borderColor: '#863BFF',
                        borderWidth: 2,
                        cubicInterpolationMode: 'monotone',
                        tension: 0.15,
                        fill: true,
                        backgroundColor: 'rgba(134, 59, 255, 0.14)',
                        segment: {
                            borderColor: (ctx) => {
                                const seg = segmentMapRef.current[ctx.p0DataIndex];
                                return seg?.bracket.borderColor ?? '#863BFF';
                            },
                            backgroundColor: (ctx) => {
                                const seg = segmentMapRef.current[ctx.p0DataIndex];
                                return seg?.bracket.backgroundColor ?? 'rgba(134, 59, 255, 0.14)';
                            },
                        },
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: '#863BFF',
                        pointHoverBorderColor: '#FFFFFF',
                        pointHoverBorderWidth: 2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'nearest',
                    axis: 'x',
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: false,
                        animation: { duration: 0 },
                        external: (context) => {
                            const tooltip = context.tooltip;
                            const container = containerRef.current;
                            const tooltipEl = tooltipRef.current;
                            const arrowEl = tooltipArrowRef.current;
                            const contentEl = tooltipContentRef.current;

                            if (!container || !tooltipEl || !arrowEl || !contentEl) return;

                            if (tooltip.opacity === 0 || !tooltip.dataPoints || tooltip.dataPoints.length === 0) {
                                tooltipEl.style.opacity = '0';
                                return;
                            }

                            const idx = tooltip.dataPoints[0]!.dataIndex;
                            const pts = sampledRef.current;
                            if (!pts || pts.length === 0 || !pts[idx]) {
                                tooltipEl.style.opacity = '0';
                                return;
                            }

                            const curT = latestTRef.current;
                            const curUnits = latestUnitsRef.current;
                            const cur = pts[idx]!;
                            const distVal = curUnits === 'mi' ? cur.distanceKm * 0.621371 : cur.distanceKm;
                            const distUnit = curUnits === 'mi' ? 'mi' : 'km';
                            const eleVal = curUnits === 'mi' ? cur.ele * 3.28084 : cur.ele;
                            const eleUnit = curUnits === 'mi' ? 'ft' : 'm';

                            const seg = segmentMapRef.current[idx] || {
                                lengthKm: 0.05,
                                bracket: getSlopeBracket(0),
                                slope: 0,
                            };
                            let segLenStr: string;
                            if (curUnits === 'mi') {
                                const mi = seg.lengthKm * 0.621371;
                                if (mi < 0.2) {
                                    segLenStr = `${Math.round(mi * 5280)} ft`;
                                } else {
                                    segLenStr = `${mi.toFixed(1)} mi`;
                                }
                            } else {
                                if (seg.lengthKm < 1.0) {
                                    segLenStr = `${Math.round(seg.lengthKm * 1000)} m`;
                                } else {
                                    segLenStr = `${seg.lengthKm.toFixed(1)} km`;
                                }
                            }
                            const bracket = seg.bracket;

                            contentEl.innerHTML = `
                                <div class="flex items-center justify-between gap-3 text-[11px] leading-tight">
                                    <span class="text-zinc-400 font-normal">${curT.distance}:</span>
                                    <span class="font-bold text-white font-mono">${distVal.toFixed(1)} ${distUnit}</span>
                                </div>
                                <div class="flex items-center justify-between gap-3 text-[11px] leading-tight">
                                    <span class="text-zinc-400 font-normal">${curT.elevation}:</span>
                                    <span class="font-bold text-white font-mono">${Math.round(eleVal)} ${eleUnit}</span>
                                </div>
                                <div class="flex items-center justify-between gap-3 text-[11px] leading-tight">
                                    <span class="text-zinc-400 font-normal">${curT.segmentLength}:</span>
                                    <span class="font-bold text-white font-mono">${segLenStr}</span>
                                </div>
                                <div class="flex items-center justify-between gap-3 text-[11px] leading-tight">
                                    <span class="text-zinc-400 font-normal">${curT.slope}:</span>
                                    <span class="font-bold text-white">${bracket.label}</span>
                                </div>
                            `;

                            const canvas = context.chart.canvas;
                            const element = tooltip.dataPoints[0]?.element;
                            const caretX = element?.x ?? tooltip.caretX;
                            const caretY = element?.y ?? tooltip.caretY;

                            const pointX = canvas.offsetLeft + caretX;
                            const pointY = canvas.offsetTop + caretY;

                            const tooltipWidth = tooltipEl.offsetWidth || 140;
                            const tooltipHeight = tooltipEl.offsetHeight || 78;
                            const containerWidth = container.offsetWidth;

                            const halfWidth = tooltipWidth / 2;
                            const minLeft = 8;
                            const maxLeft = Math.max(minLeft, containerWidth - tooltipWidth - 8);
                            const boxLeft = Math.max(minLeft, Math.min(pointX - halfWidth, maxLeft));

                            // Float directly above the curve point
                            // Arrow extends ~4px below the box, hover dot radius is 5px
                            // Arrow tip lands directly at pointY - 6px pointing down at the curve point
                            const boxTop = pointY - tooltipHeight - 10;

                            // Horizontal position of caret arrow inside the tooltip box
                            const desiredArrowLeft = pointX - boxLeft;
                            const arrowLeft = Math.max(12, Math.min(desiredArrowLeft, tooltipWidth - 12));

                            tooltipEl.style.transform = `translate3d(${Math.round(boxLeft)}px, ${Math.round(boxTop)}px, 0)`;
                            arrowEl.style.left = `${Math.round(arrowLeft)}px`;
                            tooltipEl.style.opacity = '1';
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        max: Math.max(0.01, totalDist),
                        display: true,
                        grid: { display: false },
                        ticks: {
                            maxTicksLimit: 8,
                            font: { size: 10 },
                            callback: (val) => {
                                const num = Number(val);
                                const curUnits = latestUnitsRef.current;
                                const curTotalDist = totalDistRef.current;
                                if (curUnits === 'mi') {
                                    if (curTotalDist < 0.2) {
                                        return `${Math.round(num * 5280)}ft`;
                                    }
                                    return `${parseFloat(num.toFixed(2))}mi`;
                                } else {
                                    if (curTotalDist < 1.0) {
                                        return `${Math.round(num * 1000)}m`;
                                    }
                                    return `${parseFloat(num.toFixed(2))}km`;
                                }
                            },
                        },
                    },
                    y: {
                        display: true,
                        min: yMinScale,
                        max: yMaxScale,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        ticks: {
                            maxTicksLimit: 4,
                            font: { size: 10 },
                            callback: (val) => `${Math.round(Number(val))}${latestUnitsRef.current === 'mi' ? 'ft' : 'm'}`,
                        },
                    },
                },
                onHover: (_event, elements) => {
                    if (elements && elements.length > 0) {
                        const index = elements[0]!.index;
                        const pt = sampledRef.current[index];
                        if (pt && Number.isFinite(pt.lon) && Number.isFinite(pt.lat)) {
                            mapManager.setCursor({ lon: pt.lon, lat: pt.lat });
                            return;
                        }
                    }
                    mapManager.setCursor(null);
                    if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
                },
            },
        });

        return () => {
            mapManager.setCursor(null);
            if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [pointsData, elevationExpanded, units]);

    return (
        <footer
            onMouseLeave={() => {
                mapManager.setCursor(null);
                if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
            }}
            className="relative z-20 flex shrink-0 flex-col border-t border-border bg-background shadow-lg select-none"
        >
            {/* Elevation Chart Drawer */}
            {elevationExpanded && pointsData.length >= 2 && (
                <div
                    ref={containerRef}
                    className="relative h-24 sm:h-28 w-full border-b border-border/80 px-2 sm:px-4 py-1.5"
                    onMouseLeave={() => {
                        mapManager.setCursor(null);
                        if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
                    }}
                >

                    {/* Floating Elevation Tooltip pinned to curve point */}
                    <div
                        ref={tooltipRef}
                        className="pointer-events-none absolute left-0 top-0 z-30 opacity-0 transition-opacity duration-150 ease-out"
                        style={{ willChange: 'transform, opacity' }}
                    >
                        <div className="relative rounded-md border border-white/15 bg-zinc-900/95 px-3 py-2 text-zinc-200 shadow-xl backdrop-blur-xs min-w-[135px]">
                            <div ref={tooltipContentRef} className="flex flex-col gap-1 text-[11px]" />
                            <div
                                ref={tooltipArrowRef}
                                className="absolute -bottom-1 size-2 -translate-x-1/2 rotate-45 border-r border-b border-white/15 bg-zinc-900"
                            />
                        </div>
                    </div>

                    <canvas ref={canvasRef} />
                </div>
            )}

            {/* Bottom Stats Horizontal Bar (Strava Signature) */}
            <div className="flex h-14 sm:h-16 items-center justify-between px-3 sm:px-6 py-1.5 sm:py-2">
                {/* Left Stats Grid */}
                <div className="flex items-center gap-3 sm:gap-6 md:gap-12">
                    {/* Activity Icon & Label */}
                    <div className="flex items-center gap-2 sm:gap-2.5">
                        <div className="flex size-7 sm:size-9 items-center justify-center rounded-full bg-accent text-[#863BFF]">
                            {profile === 'foot' || profile === 'hike' ? (
                                <Footprints className="size-4 sm:size-5 text-[#863BFF]" />
                            ) : (
                                <Bike className="size-4 sm:size-5 text-[#863BFF]" />
                            )}
                        </div>
                        <div className="hidden sm:block">
                            <div className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                                {t.activity}
                            </div>
                            <div className="text-xs font-bold text-foreground">
                                {profile === 'foot' ? t.run : profile === 'hike' ? t.hike : t.ride}
                            </div>
                        </div>
                    </div>

                    {/* Distance */}
                    <div>
                        <div className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            {t.distance}
                        </div>
                        <div className="text-sm sm:text-base font-black text-foreground">
                            {stats.distFormatted}
                        </div>
                    </div>

                    {/* Elevation Gain */}
                    <div>
                        <div className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            {t.elevationGain}
                        </div>
                        <div className="text-sm sm:text-base font-black text-foreground">
                            {stats.ascentFormatted}
                        </div>
                    </div>

                    {/* Elevation Loss */}
                    <div className="hidden sm:block">
                        <div className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            {t.elevationLoss}
                        </div>
                        <div className="text-sm sm:text-base font-black text-foreground">
                            {stats.descentFormatted}
                        </div>
                    </div>

                    {/* Est. Moving Time */}
                    <div className="hidden md:block">
                        <div className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                            {t.estMovingTime}
                        </div>
                        <div className="text-sm sm:text-base font-black text-foreground">
                            {stats.timeFormatted}
                        </div>
                    </div>
                </div>

                {/* Right Toggle Elevation Button */}
                <button
                    onClick={toggleElevation}
                    disabled={pointsData.length < 2}
                    className={cn(
                        'flex items-center gap-1 rounded-lg border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-bold text-foreground transition hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer disabled:cursor-not-allowed print:hidden',
                        pointsData.length < 2 && 'opacity-40 cursor-not-allowed hover:border-border hover:text-foreground hover:bg-transparent'
                    )}
                    title={elevationExpanded ? t.hideElevation : t.showElevation}
                >
                    <span className="hidden sm:inline">{elevationExpanded ? t.hideElevation : t.showElevation}</span>
                    <span className="sm:hidden">{elevationExpanded ? t.hideShort : t.elevationShort}</span>
                    {elevationExpanded ? <ChevronDown className="size-3 sm:size-3.5" /> : <ChevronUp className="size-3 sm:size-3.5" />}
                </button>
            </div>
        </footer>
    );
}
