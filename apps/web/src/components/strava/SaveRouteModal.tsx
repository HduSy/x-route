import { useState, useMemo } from 'react';
import { Bookmark, Check, Mountain, Route, X } from 'lucide-react';
import { useRoutingStore } from '@/store/routing-slice';
import { useT } from '@/store/i18n-slice';
import { saveGPXFile, updateGPXFile } from '@/lib/file-actions';
import { GPXFile, Track, TrackSegment, distance } from '@x-route/gpx';
import { cn } from '@/lib/utils';
import { computeElevationStats } from '@/lib/elevation';
import { useSelectionStore } from '@/store/selection-slice';
import { routingLayer } from '@/lib/map/routing-layer';
import { mapManager } from '@/lib/map/MapManager';

export function SaveRouteModal() {
    const { t } = useT();

    const saveModalOpen = useRoutingStore((s) => s.saveModalOpen);
    const setSaveModalOpen = useRoutingStore((s) => s.setSaveModalOpen);
    const resultPoints = useRoutingStore((s) => s.resultPoints);
    const units = useRoutingStore((s) => s.units);
    const setMyRoutesOpen = useRoutingStore((s) => s.setMyRoutesOpen);
    const editingFileId = useRoutingStore((s) => s.editingFileId);

    const defaultName = `Route ${new Date().toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    })}`;

    const [routeName, setRouteName] = useState(defaultName);
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);

    // Compute route quick summary
    const summary = useMemo(() => {
        if (resultPoints.length < 2) return null;
        let km = 0;
        const pts = resultPoints.map((pt, i) => {
            if (i > 0) {
                const prev = resultPoints[i - 1]!;
                km +=
                    distance(
                        { lat: prev.attributes.lat, lon: prev.attributes.lon },
                        { lat: pt.attributes.lat, lon: pt.attributes.lon }
                    ) / 1000;
            }
            return {
                distanceKm: km,
                ele: pt.ele ?? 0,
            };
        });

        const eleStats = computeElevationStats(pts);
        const ascent = eleStats.ascent;

        const distFormatted =
            units === 'mi' ? `${(km * 0.621371).toFixed(1)} mi` : `${km.toFixed(1)} km`;
        const eleFormatted =
            units === 'mi' ? `+${Math.round(ascent * 3.28084)} ft` : `+${ascent} m`;

        return {
            distFormatted,
            eleFormatted,
        };
    }, [resultPoints, units]);

    if (!saveModalOpen) return null;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (resultPoints.length < 2 || saving) return;

        setSaving(true);
        try {
            const segment = new TrackSegment({ trkpt: resultPoints });
            const track = new Track({
                trkseg: [segment],
                name: routeName.trim() || defaultName,
                desc: description.trim() || undefined,
            });
            const file = new GPXFile({
                attributes: {},
                wpt: [],
                rte: [],
                trk: [track],
                metadata: {
                    name: routeName.trim() || defaultName,
                    desc: description.trim() || undefined,
                    time: new Date(),
                },
            });

            let targetFileId = editingFileId;
            if (editingFileId) {
                await updateGPXFile(editingFileId, file, false);
            } else {
                targetFileId = await saveGPXFile(file, false);
            }
            setSavedSuccess(true);
            setTimeout(() => {
                setSavedSuccess(false);
                setSaveModalOpen(false);

                // 1. Activate the saved route as loaded on the map (via gpxLayers)
                if (targetFileId) {
                    useSelectionStore.getState().addLoadedFile(targetFileId);
                    useSelectionStore.getState().selectFile(targetFileId);
                }

                // 2. Clear editing planner so editor is in ready state for continuous creation
                useRoutingStore.getState().clear(true);
                routingLayer.clear();
                useRoutingStore.getState().setEditingFileId(null);
                mapManager.clearUserLocation();

                // 3. Open My Routes drawer
                setMyRoutesOpen(true);
            }, 800);
        } catch (err) {
            console.error('Failed to save route:', err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in select-none">
            <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border/80 bg-background p-6 shadow-2xl animate-in zoom-in-95">
                {/* Top Accent Gradient Line */}
                <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-[#863BFF] via-[#A855F7] to-[#C084FC]" />

                {/* Close Button */}
                <button
                    onClick={() => setSaveModalOpen(false)}
                    className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground cursor-pointer"
                >
                    <X className="size-5" />
                </button>

                {/* Modal Header */}
                <div className="flex items-center gap-3 mb-5 mt-1">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-[#863BFF]/10 text-[#863BFF] ring-4 ring-[#863BFF]/5">
                        <Bookmark className="size-5 fill-[#863BFF]/20" />
                    </div>
                    <div>
                        <h2 className="text-base font-extrabold tracking-tight text-foreground">
                            {t.saveRouteModalTitle}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            {t.saveRouteModalSubtitle}
                        </p>
                    </div>
                </div>

                {/* Route Summary Pill */}
                {summary && (
                    <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-accent/40 p-3 text-center border border-border/60">
                        <div>
                            <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                <Route className="size-3 text-[#863BFF]" />
                                <span>{t.distance}</span>
                            </div>
                            <div className="text-sm font-black text-foreground mt-0.5">
                                {summary.distFormatted}
                            </div>
                        </div>
                        <div className="border-l border-border/60">
                            <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                <Mountain className="size-3 text-[#863BFF]" />
                                <span>{t.elevationGain}</span>
                            </div>
                            <div className="text-sm font-black text-foreground mt-0.5">
                                {summary.eleFormatted}
                            </div>
                        </div>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label className="mb-1.5 block text-xs font-bold text-foreground">
                            {t.routeName}
                        </label>
                        <input
                            type="text"
                            value={routeName}
                            onChange={(e) => setRouteName(e.target.value)}
                            required
                            placeholder={t.routeNamePlaceholder}
                            className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm text-foreground outline-none transition focus:border-[#863BFF] focus:ring-2 focus:ring-[#863BFF]/20"
                        />
                    </div>

                    <div>
                        <label className="mb-1.5 block text-xs font-bold text-foreground">
                            {t.routeDescription}
                        </label>
                        <textarea
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t.routeDescriptionPlaceholder}
                            className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm text-foreground outline-none transition focus:border-[#863BFF] focus:ring-2 focus:ring-[#863BFF]/20"
                        />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={() => setSaveModalOpen(false)}
                            className="rounded-xl px-4 py-2 text-xs font-bold text-muted-foreground transition hover:bg-accent hover:text-foreground cursor-pointer"
                        >
                            {t.cancel}
                        </button>
                        <button
                            type="submit"
                            disabled={saving || savedSuccess}
                            className={cn(
                                'flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold text-white transition-all duration-150 shadow-sm',
                                saving || savedSuccess
                                    ? 'bg-muted text-muted-foreground cursor-not-allowed shadow-none'
                                    : 'bg-[#863BFF] hover:bg-[#7424F8] hover:shadow-md active:scale-98 active:bg-[#6517EA] cursor-pointer'
                            )}
                        >
                            {savedSuccess ? (
                                <>
                                    <Check className="size-4" />
                                    <span>{t.saved}</span>
                                </>
                            ) : (
                                <span>{saving ? t.loading : t.saveToMyRoutes}</span>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
