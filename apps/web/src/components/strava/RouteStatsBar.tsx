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
    const g = Math.round(slope);
    if (g <= -16) {
        return { id: -5, label: '< -15%', borderColor: '#0369A1', backgroundColor: 'rgba(3, 105, 161, 0.16)' };
    } else if (g <= -10) {
        return { id: -4, label: '-10 ~ -15%', borderColor: '#0284C7', backgroundColor: 'rgba(2, 132, 199, 0.16)' };
    } else if (g <= -7) {
        return { id: -3, label: '-7 ~ -9%', borderColor: '#0EA5E9', backgroundColor: 'rgba(14, 165, 233, 0.16)' };
    } else if (g <= -4) {
        return { id: -2, label: '-4 ~ -6%', borderColor: '#38BDF8', backgroundColor: 'rgba(56, 189, 248, 0.16)' };
    } else if (g <= -1) {
        return { id: -1, label: '-1 ~ -3%', borderColor: '#60A5FA', backgroundColor: 'rgba(96, 165, 250, 0.16)' };
    } else if (g === 0) {
        return { id: 0, label: '0%', borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.16)' };
    } else if (g <= 3) {
        return { id: 1, label: '1-3%', borderColor: '#FACC15', backgroundColor: 'rgba(250, 204, 21, 0.18)' };
    } else if (g <= 6) {
        return { id: 2, label: '4-6%', borderColor: '#F59E0B', backgroundColor: 'rgba(245, 158, 11, 0.20)' };
    } else if (g <= 9) {
        return { id: 3, label: '7-9%', borderColor: '#F97316', backgroundColor: 'rgba(249, 115, 22, 0.22)' };
    } else if (g <= 15) {
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

    // 1. Calculate smoothed slope at each point using ~150m baseline window (±75m)
    const pointSlopes = pts.map((p, i) => {
        const curDist = p.distanceKm;
        let p0 = p;
        let p1 = p;
        for (let j = i; j >= 0; j--) {
            if ((curDist - pts[j]!.distanceKm) * 1000 >= 75) {
                p0 = pts[j]!;
                break;
            }
            p0 = pts[0]!;
        }
        for (let j = i; j < pts.length; j++) {
            if ((pts[j]!.distanceKm - curDist) * 1000 >= 75) {
                p1 = pts[j]!;
                break;
            }
            p1 = pts[pts.length - 1]!;
        }
        const dMeters = (p1.distanceKm - p0.distanceKm) * 1000;
        const slope = dMeters > 10 ? ((p1.ele - p0.ele) / dMeters) * 100 : 0;
        return { slope, bracket: getSlopeBracket(slope) };
    });

    // 2. Initial contiguous runs
    interface RawSeg {
        startIdx: number;
        endIdx: number;
        bracket: SlopeBracket;
        lenMeters: number;
    }

    const segs: RawSeg[] = [];
    let segStart = 0;
    for (let i = 0; i < pts.length; i++) {
        if (i === pts.length - 1 || pointSlopes[i]!.bracket.id !== pointSlopes[i + 1]!.bracket.id) {
            segs.push({
                startIdx: segStart,
                endIdx: i,
                bracket: pointSlopes[i]!.bracket,
                lenMeters: (pts[i]!.distanceKm - pts[segStart]!.distanceKm) * 1000,
            });
            segStart = i + 1;
        }
    }

    // 3. Merge short transitional blips (< 120m) into adjacent neighbors
    let changed = true;
    let iterations = 0;
    while (changed && segs.length > 1 && iterations < 50) {
        changed = false;
        iterations++;
        for (let i = 0; i < segs.length; i++) {
            if (segs[i]!.lenMeters < 120) {
                const target = i > 0 ? i - 1 : i + 1;
                segs[target]!.startIdx = Math.min(segs[target]!.startIdx, segs[i]!.startIdx);
                segs[target]!.endIdx = Math.max(segs[target]!.endIdx, segs[i]!.endIdx);
                segs[target]!.lenMeters =
                    (pts[segs[target]!.endIdx]!.distanceKm - pts[segs[target]!.startIdx]!.distanceKm) * 1000;
                segs.splice(i, 1);
                changed = true;
                break;
            }
        }
    }

    // 4. Coalesce adjacent segments with matching bracket IDs
    const coalesced: RawSeg[] = [];
    for (const seg of segs) {
        if (coalesced.length > 0 && coalesced[coalesced.length - 1]!.bracket.id === seg.bracket.id) {
            const last = coalesced[coalesced.length - 1]!;
            last.endIdx = seg.endIdx;
            last.lenMeters = (pts[seg.endIdx]!.distanceKm - pts[last.startIdx]!.distanceKm) * 1000;
        } else {
            coalesced.push({ ...seg });
        }
    }

    // 5. Build point-to-segment map
    const map: SegmentInfo[] = new Array(pts.length);
    for (const seg of coalesced) {
        const lengthKm = Math.max(0.01, pts[seg.endIdx]!.distanceKm - pts[seg.startIdx]!.distanceKm);
        for (let i = seg.startIdx; i <= seg.endIdx; i++) {
            map[i] = {
                lengthKm,
                bracket: seg.bracket,
                slope: pointSlopes[i]?.slope ?? 0,
            };
        }
    }

    // Fallback fill for any unassigned indices
    for (let i = 0; i < pts.length; i++) {
        if (!map[i]) {
            map[i] = {
                lengthKm: 0.05,
                bracket: pointSlopes[i]?.bracket || getSlopeBracket(0),
                slope: pointSlopes[i]?.slope ?? 0,
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
                ele: Math.round(stats.smoothedElevations[idx] ?? p.ele),
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

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const step = Math.max(1, Math.floor(pointsData.length / 600));
        const sampled = pointsData.filter(
            (_, idx) => idx % step === 0 || idx === pointsData.length - 1
        );
        sampledRef.current = sampled;
        segmentMapRef.current = buildSegmentMap(sampled);

        if (chartRef.current) {
            chartRef.current.data.labels = sampled.map((p) =>
                units === 'mi' ? (p.distanceKm * 0.621371).toFixed(1) : p.distanceKm.toFixed(1)
            );
            chartRef.current.data.datasets[0]!.data = sampled.map((p) =>
                units === 'mi' ? Math.round(p.ele * 3.28084) : p.ele
            );
            chartRef.current.update('none');
            return;
        }

        chartRef.current = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sampled.map((p) =>
                    units === 'mi' ? (p.distanceKm * 0.621371).toFixed(1) : p.distanceKm.toFixed(1)
                ),
                datasets: [
                    {
                        label: 'Elevation',
                        data: sampled.map((p) =>
                            units === 'mi' ? Math.round(p.ele * 3.28084) : p.ele
                        ),
                        borderColor: '#863BFF',
                        borderWidth: 2.5,
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
                        tension: 0.1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index',
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
                            const eleVal = curUnits === 'mi' ? Math.round(cur.ele * 3.28084) : cur.ele;
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
                                    <span class="font-bold text-white font-mono">${eleVal} ${eleUnit}</span>
                                </div>
                                <div class="flex items-center justify-between gap-3 text-[11px] leading-tight">
                                    <span class="text-zinc-400 font-normal">${curT.segmentLength}:</span>
                                    <span class="font-bold text-white font-mono">${segLenStr}</span>
                                </div>
                                <div class="flex items-center justify-between gap-3 text-[11px] leading-tight">
                                    <span class="text-zinc-400 font-normal">${curT.type}:</span>
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
                        display: true,
                        grid: { display: false },
                        ticks: {
                            maxTicksLimit: 10,
                            font: { size: 10 },
                            callback: (val) =>
                                `${
                                    units === 'mi'
                                        ? ((sampledRef.current[Number(val)]?.distanceKm ?? 0) * 0.621371).toFixed(0)
                                        : (sampledRef.current[Number(val)]?.distanceKm.toFixed(0) ?? val)
                                }${units === 'mi' ? 'mi' : 'km'}`,
                        },
                    },
                    y: {
                        display: true,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        ticks: {
                            maxTicksLimit: 4,
                            font: { size: 10 },
                            callback: (val) => `${val}${units === 'mi' ? 'ft' : 'm'}`,
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
                    {/* Slope Grade Color Legend (BRouter-Web style with modern translucency) */}
                    <div className="absolute top-1.5 right-3 hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground bg-background/85 backdrop-blur-xs px-2.5 py-0.5 rounded-md border border-border/60 pointer-events-none z-10 shadow-2xs">
                        <span className="font-semibold text-foreground/80">{t.slope}:</span>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#0284C7]" />
                            <span>&lt; 0%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#10B981]" />
                            <span>0%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#FACC15]" />
                            <span>1-3%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#F59E0B]" />
                            <span>4-6%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#F97316]" />
                            <span>7-9%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#EF4444]" />
                            <span>10-15%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#863BFF]" />
                            <span>&gt; 15%</span>
                        </div>
                    </div>

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
                        'flex items-center gap-1 rounded-lg border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-bold text-foreground transition hover:border-[#863BFF] hover:bg-[#F5F0FF] dark:hover:bg-[#2C184D] hover:text-[#863BFF] cursor-pointer disabled:cursor-not-allowed',
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
