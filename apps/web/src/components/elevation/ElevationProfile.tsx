import { useEffect, useRef, useMemo, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { ChevronDown, ChevronUp, Mountain, TrendingUp, TrendingDown } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { GPXFile, distance } from '@x-route/gpx';
import { useSelectionStore } from '@/store/selection-slice';
import { useRoutingStore } from '@/store/routing-slice';
import { mapManager } from '@/lib/map/MapManager';
import { Button } from '@/components/ui/button';

Chart.register(...registerables);

interface ProfilePoint {
    distanceKm: number;
    ele: number;
    lat: number;
    lon: number;
}

export function ElevationProfile() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const chartRef = useRef<Chart | null>(null);
    const [collapsed, setCollapsed] = useState(false);

    const selectedFileId = useSelectionStore((s) => s.selectedFileId);
    const routingResult = useRoutingStore((s) => s.resultPoints);
    const routingActive = useRoutingStore((s) => s.active);

    // Get selected file from db
    const selectedFile = useLiveQuery(
        () => (selectedFileId ? db.files.get(selectedFileId) : undefined),
        [selectedFileId]
    );

    // Build data points
    const profileData = useMemo<ProfilePoint[]>(() => {
        // Priority 1: if routing is active and has computed points, show routing profile
        if (routingActive && routingResult.length >= 2) {
            const points: ProfilePoint[] = [];
            let totalDist = 0;
            for (let i = 0; i < routingResult.length; i++) {
                const pt = routingResult[i]!;
                const lat = pt.attributes.lat;
                const lon = pt.attributes.lon;
                if (i > 0) {
                    const prev = routingResult[i - 1]!;
                    totalDist += distance(
                        { lat: prev.attributes.lat, lon: prev.attributes.lon },
                        { lat, lon }
                    ) / 1000;
                }
                points.push({
                    distanceKm: totalDist,
                    ele: Math.round(pt.ele ?? 0),
                    lat,
                    lon,
                });
            }
            return points;
        }

        // Priority 2: selected file from file list
        if (selectedFile) {
            const file = new GPXFile(selectedFile);
            const trkpts = file.getTrackPoints();
            if (trkpts.length < 2) return [];

            const points: ProfilePoint[] = [];
            let totalDist = 0;
            for (let i = 0; i < trkpts.length; i++) {
                const pt = trkpts[i]!;
                const coords = pt.getCoordinates();
                if (i > 0) {
                    const prev = trkpts[i - 1]!.getCoordinates();
                    totalDist += distance(prev, coords) / 1000;
                }
                points.push({
                    distanceKm: totalDist,
                    ele: Math.round(pt.ele ?? 0),
                    lat: coords.lat,
                    lon: coords.lon,
                });
            }
            return points;
        }

        return [];
    }, [routingActive, routingResult, selectedFile]);

    // Statistics
    const stats = useMemo(() => {
        if (profileData.length < 2) return null;
        let minEle = Number.POSITIVE_INFINITY;
        let maxEle = Number.NEGATIVE_INFINITY;
        let ascent = 0;
        let descent = 0;

        for (let i = 0; i < profileData.length; i++) {
            const ele = profileData[i]!.ele;
            if (ele < minEle) minEle = ele;
            if (ele > maxEle) maxEle = ele;
            if (i > 0) {
                const diff = ele - profileData[i - 1]!.ele;
                if (diff > 0) ascent += diff;
                else descent += Math.abs(diff);
            }
        }

        return {
            totalKm: profileData[profileData.length - 1]!.distanceKm.toFixed(1),
            minEle: Math.round(minEle),
            maxEle: Math.round(maxEle),
            ascent: Math.round(ascent),
            descent: Math.round(descent),
        };
    }, [profileData]);

    // Render / Update Chart.js
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (profileData.length < 2) {
            chartRef.current?.destroy();
            chartRef.current = null;
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Downsample for rendering performance if > 1000 points
        const step = Math.max(1, Math.floor(profileData.length / 800));
        const sampled = profileData.filter((_, idx) => idx % step === 0 || idx === profileData.length - 1);

        const gradient = ctx.createLinearGradient(0, 0, 0, 100);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.45)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.02)');

        if (chartRef.current) {
            chartRef.current.data.labels = sampled.map((p) => p.distanceKm.toFixed(1));
            chartRef.current.data.datasets[0]!.data = sampled.map((p) => p.ele);
            chartRef.current.update('none');
            return;
        }

        chartRef.current = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sampled.map((p) => p.distanceKm.toFixed(1)),
                datasets: [
                    {
                        label: 'Elevation',
                        data: sampled.map((p) => p.ele),
                        borderColor: '#3B82F6',
                        borderWidth: 2,
                        fill: true,
                        backgroundColor: gradient,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#EF4444',
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
                            title: (items) => `${items[0]?.label ?? 0} km`,
                            label: (item) => ` ${item.raw} m`,
                        },
                    },
                },
                scales: {
                    x: {
                        display: true,
                        grid: { display: false },
                        ticks: {
                            maxTicksLimit: 8,
                            font: { size: 10 },
                            callback: (val) => `${sampled[Number(val)]?.distanceKm.toFixed(0) ?? val}km`,
                        },
                    },
                    y: {
                        display: true,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        ticks: {
                            maxTicksLimit: 4,
                            font: { size: 10 },
                            callback: (val) => `${val}m`,
                        },
                    },
                },
                onHover: (_event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0]!.index;
                        const pt = sampled[index];
                        if (pt) {
                            mapManager.setCursor({ lon: pt.lon, lat: pt.lat });
                        }
                    } else {
                        mapManager.setCursor(null);
                    }
                },
            },
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [profileData]);

    if (profileData.length < 2) return null;

    return (
        <div className="absolute bottom-4 left-1/2 z-20 w-[94%] max-w-4xl -translate-x-1/2 rounded-lg border bg-background/95 shadow-xl backdrop-blur">
            {/* Header / stats bar */}
            <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                        <Mountain className="size-3.5 text-primary" /> Elevation Profile
                    </span>
                    {stats && (
                        <>
                            <span>{stats.totalKm} km</span>
                            <span className="flex items-center gap-0.5 text-emerald-600">
                                <TrendingUp className="size-3" /> +{stats.ascent} m
                            </span>
                            <span className="flex items-center gap-0.5 text-rose-600">
                                <TrendingDown className="size-3" /> -{stats.descent} m
                            </span>
                            <span>
                                {stats.minEle}m ~ {stats.maxEle}m
                            </span>
                        </>
                    )}
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => setCollapsed(!collapsed)}
                    title={collapsed ? 'Expand' : 'Collapse'}
                >
                    {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </Button>
            </div>

            {/* Canvas area */}
            {!collapsed && (
                <div
                    className="relative h-28 w-full p-2"
                    onMouseLeave={() => mapManager.setCursor(null)}
                >
                    <canvas ref={canvasRef} />
                </div>
            )}
        </div>
    );
}
