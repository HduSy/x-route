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

    // Selected file from Dexie (if not planning or viewing saved file)
    const selectedFile = useLiveQuery(
        () => (selectedFileId ? db.files.get(selectedFileId) : undefined),
        [selectedFileId]
    );

    // Build data points
    const pointsData = useMemo<ProfilePoint[]>(() => {
        if (resultPoints.length >= 2) {
            const list: ProfilePoint[] = [];
            let totalDist = 0;
            for (let i = 0; i < resultPoints.length; i++) {
                const pt = resultPoints[i]!;
                const lat = pt.attributes.lat;
                const lon = pt.attributes.lon;
                if (i > 0) {
                    const prev = resultPoints[i - 1]!;
                    totalDist +=
                        distance(
                            { lat: prev.attributes.lat, lon: prev.attributes.lon },
                            { lat, lon }
                        ) / 1000;
                }
                list.push({
                    distanceKm: totalDist,
                    ele: Math.round(pt.ele ?? 0),
                    lat,
                    lon,
                });
            }
            const eleStats = computeElevationStats(list);
            return list.map((p, idx) => ({
                ...p,
                ele: Math.round(eleStats.smoothedElevations[idx] ?? p.ele),
            }));
        }

        if (selectedFile) {
            const file = new GPXFile(selectedFile);
            const trkpts = file.getTrackPoints();
            if (trkpts.length < 2) return [];

            const list: ProfilePoint[] = [];
            let totalDist = 0;
            for (let i = 0; i < trkpts.length; i++) {
                const pt = trkpts[i]!;
                const coords = pt.getCoordinates();
                if (i > 0) {
                    const prev = trkpts[i - 1]!.getCoordinates();
                    totalDist += distance(prev, coords) / 1000;
                }
                list.push({
                    distanceKm: totalDist,
                    ele: Math.round(pt.ele ?? 0),
                    lat: coords.lat,
                    lon: coords.lon,
                });
            }
            const eleStats = computeElevationStats(list);
            return list.map((p, idx) => ({
                ...p,
                ele: Math.round(eleStats.smoothedElevations[idx] ?? p.ele),
            }));
        }

        return [];
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
        const eleStats = computeElevationStats(pointsData);
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
    }, [pointsData, profile, units]);

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

        const gradient = ctx.createLinearGradient(0, 0, 0, 110);
        gradient.addColorStop(0, 'rgba(134, 59, 255, 0.45)');
        gradient.addColorStop(1, 'rgba(134, 59, 255, 0.02)');

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
                        borderWidth: 2,
                        fill: true,
                        backgroundColor: gradient,
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
                            label: (item) =>
                                ` ${item.raw} ${units === 'mi' ? 'ft' : 'm'}`,
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
                                        ? ((sampled[Number(val)]?.distanceKm ?? 0) * 0.621371).toFixed(0)
                                        : (sampled[Number(val)]?.distanceKm.toFixed(0) ?? val)
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
                        const pt = sampled[index];
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
