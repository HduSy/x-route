import { useState, useMemo } from 'react';
import { Bookmark, Check, Mountain, Route, X } from 'lucide-react';
import { useRoutingStore } from '@/store/routing-slice';
import { useT } from '@/store/i18n-slice';
import { saveGPXFile } from '@/lib/file-actions';
import { GPXFile, Track, TrackSegment, distance } from '@x-route/gpx';

export function SaveRouteModal() {
    const { t } = useT();

    const saveModalOpen = useRoutingStore((s) => s.saveModalOpen);
    const setSaveModalOpen = useRoutingStore((s) => s.setSaveModalOpen);
    const resultPoints = useRoutingStore((s) => s.resultPoints);
    const units = useRoutingStore((s) => s.units);
    const setMyRoutesOpen = useRoutingStore((s) => s.setMyRoutesOpen);

    const defaultName = useMemo(() => {
        const today = new Date().toISOString().slice(0, 10);
        return `Route ${today}`;
    }, []);

    const [routeName, setRouteName] = useState(defaultName);
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);

    // Compute route quick summary
    const summary = useMemo(() => {
        if (resultPoints.length < 2) return null;
        let km = 0;
        let ascent = 0;
        for (let i = 1; i < resultPoints.length; i++) {
            const p1 = resultPoints[i - 1]!;
            const p2 = resultPoints[i]!;
            km +=
                distance(
                    { lat: p1.attributes.lat, lon: p1.attributes.lon },
                    { lat: p2.attributes.lat, lon: p2.attributes.lon }
                ) / 1000;
            const diff = (p2.ele ?? 0) - (p1.ele ?? 0);
            if (diff > 0) ascent += diff;
        }

        const distFormatted =
            units === 'mi' ? `${(km * 0.621371).toFixed(1)} mi` : `${km.toFixed(1)} km`;
        const eleFormatted =
            units === 'mi' ? `+${Math.round(ascent * 3.28084)} ft` : `+${Math.round(ascent)} m`;

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

            await saveGPXFile(file);
            setSavedSuccess(true);
            setTimeout(() => {
                setSavedSuccess(false);
                setSaveModalOpen(false);
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
            <div className="relative w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl animate-in zoom-in-95">
                {/* Close Button */}
                <button
                    onClick={() => setSaveModalOpen(false)}
                    className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <X className="size-5" />
                </button>

                {/* Modal Header */}
                <div className="flex items-center gap-2 mb-4">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-[#863BFF]/10 text-[#863BFF]">
                        <Bookmark className="size-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold tracking-tight text-foreground">
                            {t.saveRouteModalTitle}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            Save this planned route to your local library
                        </p>
                    </div>
                </div>

                {/* Route Summary Pill */}
                {summary && (
                    <div className="mb-5 flex items-center justify-around rounded-xl bg-accent/40 p-3 text-center border border-border/60">
                        <div>
                            <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground">
                                <Route className="size-3.5 text-[#863BFF]" /> {t.distance}
                            </div>
                            <div className="text-sm font-bold text-foreground">
                                {summary.distFormatted}
                            </div>
                        </div>
                        <div className="h-6 w-px bg-border" />
                        <div>
                            <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground">
                                <Mountain className="size-3.5 text-[#863BFF]" /> {t.elevationGain}
                            </div>
                            <div className="text-sm font-bold text-foreground">
                                {summary.eleFormatted}
                            </div>
                        </div>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label className="mb-1 block text-xs font-semibold text-foreground">
                            {t.routeName}
                        </label>
                        <input
                            type="text"
                            value={routeName}
                            onChange={(e) => setRouteName(e.target.value)}
                            required
                            placeholder="e.g. Sunday Morning Mountain Loop"
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF]"
                        />
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-semibold text-foreground">
                            {t.routeDescription}
                        </label>
                        <textarea
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add notes about road surface, water stations, climbs..."
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-[#863BFF] focus:ring-1 focus:ring-[#863BFF]"
                        />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={() => setSaveModalOpen(false)}
                            className="rounded-lg px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            {t.cancel}
                        </button>
                        <button
                            type="submit"
                            disabled={saving || savedSuccess}
                            className="flex items-center gap-1.5 rounded-lg bg-[#863BFF] px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#7424F8] disabled:opacity-60"
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
