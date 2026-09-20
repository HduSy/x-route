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

interface SlopeStyle {
    borderColor: string;
    backgroundColor: string;
}

/**
 * Maps gradient (slope) to color and translucent background matching BRouter-Web logic
 * while harmonizing with x-route's violet/purple athletic aesthetic.
 */
function getSlopeStyle(p0: ProfilePoint, p1: ProfilePoint): SlopeStyle {
    const distMeters = (p1.distanceKm - p0.distanceKm) * 1000;
    const eleDiff = p1.ele - p0.ele;
    const slope = distMeters > 0.5 ? (eleDiff / distMeters) * 100 : 0;

    if (slope < -1.5) {
        // Downhill (< -1.5%): Cool Azure / Sky
        return {
            borderColor: '#0284C7',
            backgroundColor: 'rgba(2, 132, 199, 0.16)',
        };
    } else if (slope < 2.5) {
        // Flat / Gentle cruise (-1.5% ~ 2.5%): Emerald
        return {
            borderColor: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.16)',
        };
    } else if (slope < 5.0) {
        // Mild Climb (2.5% ~ 5%): Amber Gold
        return {
            borderColor: '#F59E0B',
            backgroundColor: 'rgba(245, 158, 11, 0.18)',
        };
    } else if (slope < 8.5) {
        // Moderate Climb (5% ~ 8.5%): Warm Orange
        return {
            borderColor: '#F97316',
            backgroundColor: 'rgba(249, 115, 22, 0.20)',
        };
    } else if (slope < 12.0) {
        // Steep Climb (8.5% ~ 12%): Coral Red
        return {
            borderColor: '#EF4444',
            backgroundColor: 'rgba(239, 68, 68, 0.22)',
        };
    } else {
        // Extreme / HC Climb (>12%): Signature Electric Purple
        return {
            borderColor: '#863BFF',
            backgroundColor: 'rgba(134, 59, 255, 0.26)',
        };
    }
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
                                const pts = sampledRef.current;
                                const p0 = pts[ctx.p0DataIndex];
                                const p1 = pts[ctx.p1DataIndex];
                                if (!p0 || !p1) return '#863BFF';
                                return getSlopeStyle(p0, p1).borderColor;
                            },
                            backgroundColor: (ctx) => {
                                const pts = sampledRef.current;
                                const p0 = pts[ctx.p0DataIndex];
                                const p1 = pts[ctx.p1DataIndex];
                                if (!p0 || !p1) return 'rgba(134, 59, 255, 0.14)';
                                return getSlopeStyle(p0, p1).backgroundColor;
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
                        enabled: true,
                        callbacks: {
                            title: (items) =>
                                `${items[0]?.label ?? 0} ${units === 'mi' ? 'mi' : 'km'}`,
                            label: (item) => {
                                const idx = item.dataIndex;
                                const pts = sampledRef.current;
                                const cur = pts[idx];
                                let slopeStr = '';
                                if (cur && pts.length > 1) {
                                    const prev = pts[Math.max(0, idx - 1)]!;
                                    const next = pts[Math.min(pts.length - 1, idx + 1)]!;
                                    const dM = (next.distanceKm - prev.distanceKm) * 1000;
                                    const dH = next.ele - prev.ele;
                                    const slope = dM > 0.5 ? (dH / dM) * 100 : 0;
                                    const sign = slope > 0 ? '+' : '';
                                    slopeStr = ` (${sign}${slope.toFixed(1)}%)`;
                                }
                                return ` ${item.raw} ${units === 'mi' ? 'ft' : 'm'}${slopeStr}`;
                            },
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
                },
            },
        });

        return () => {
            mapManager.setCursor(null);
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [pointsData, elevationExpanded, units]);

    return (
        <footer
            onMouseLeave={() => mapManager.setCursor(null)}
            className="relative z-20 flex shrink-0 flex-col border-t border-border bg-background shadow-lg select-none"
        >
            {/* Elevation Chart Drawer */}
            {elevationExpanded && pointsData.length >= 2 && (
                <div
                    className="relative h-24 sm:h-28 w-full border-b border-border/80 px-2 sm:px-4 py-1.5"
                    onMouseLeave={() => mapManager.setCursor(null)}
                >
                    {/* Slope Grade Color Legend (BRouter-Web style with modern translucency) */}
                    <div className="absolute top-1.5 right-3 hidden sm:flex items-center gap-2.5 text-[10px] text-muted-foreground bg-background/85 backdrop-blur-xs px-2.5 py-0.5 rounded-md border border-border/60 pointer-events-none z-10 shadow-2xs">
                        <span className="font-semibold text-foreground/80">{t.slope}:</span>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#0284C7]" />
                            <span>&lt; -1.5%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#10B981]" />
                            <span>0~2.5%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#F59E0B]" />
                            <span>2.5~5%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#F97316]" />
                            <span>5~8.5%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#EF4444]" />
                            <span>8.5~12%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="size-2 rounded-full bg-[#863BFF]" />
                            <span>&gt; 12%</span>
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
                            {profile === 'foot' ? (
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
                                {profile === 'foot' ? t.run : t.ride}
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
