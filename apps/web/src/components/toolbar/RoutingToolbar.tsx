import { useState, useMemo } from 'react';
import { Check, Loader2, Redo2, Route, Save, Trash2, Undo2 } from 'lucide-react';
import { GPXFile, Track, TrackSegment, distance } from '@x-route/gpx';
import { Button } from '@/components/ui/button';
import { saveGPXFile } from '@/lib/file-actions';
import { routingProfiles } from '@/lib/routing';
import { cn } from '@/lib/utils';
import { useRoutingStore } from '@/store/routing-slice';
import { useT } from '@/store/i18n-slice';

export function RoutingToolbar() {
    const { t } = useT();
    const [saved, setSaved] = useState(false);
    const active = useRoutingStore((s) => s.active);
    const setActive = useRoutingStore((s) => s.setActive);
    const profile = useRoutingStore((s) => s.profile);
    const setProfile = useRoutingStore((s) => s.setProfile);
    const anchors = useRoutingStore((s) => s.anchors);
    const resultPoints = useRoutingStore((s) => s.resultPoints);
    const routing = useRoutingStore((s) => s.routing);
    const error = useRoutingStore((s) => s.error);
    const clear = useRoutingStore((s) => s.clear);
    const undo = useRoutingStore((s) => s.undo);
    const redo = useRoutingStore((s) => s.redo);
    const canUndo = useRoutingStore((s) => s.past.length > 0);
    const canRedo = useRoutingStore((s) => s.future.length > 0);

    const summary = useMemo(() => {
        if (resultPoints.length < 2) return null;
        let km = 0;
        for (let i = 1; i < resultPoints.length; i++) {
            const a = resultPoints[i - 1]!;
            const b = resultPoints[i]!;
            km += distance(
                { lat: a.attributes.lat, lon: a.attributes.lon },
                { lat: b.attributes.lat, lon: b.attributes.lon }
            ) / 1000;
        }
        return km;
    }, [resultPoints]);

    const handleSave = async () => {
        const { resultPoints: points } = useRoutingStore.getState();
        if (points.length < 2) return;

        const segment = new TrackSegment({ trkpt: points });
        const track = new Track({ trkseg: [segment], name: 'route' });
        const file = new GPXFile({
            attributes: {},
            wpt: [],
            rte: [],
            trk: [track],
            metadata: {
                name: `route ${new Date().toISOString().slice(0, 10)}`,
            },
        });
        await saveGPXFile(file);
        useRoutingStore.getState().clear(true);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="flex items-center gap-1.5">
            <Button
                variant={active ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActive(!active)}
                title={t.togglePlan}
            >
                <Route className="size-4" />
                {active ? t.exitPlan : t.plan}
            </Button>

            {active && (
                <>
                    <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        value={profile}
                        onChange={(e) => setProfile(e.target.value)}
                        title={t.profiles[profile as keyof typeof t.profiles] ?? 'Profile'}
                    >
                        {Object.entries(routingProfiles).map(([key, p]) => (
                            <option key={key} value={key}>
                                {t.profiles[key as keyof typeof t.profiles] ?? p.label}
                            </option>
                        ))}
                    </select>

                    <Button variant="ghost" size="icon" className="size-8" disabled={!canUndo} onClick={undo} title={t.undo}>
                        <Undo2 className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" disabled={!canRedo} onClick={redo} title={t.redo}>
                        <Redo2 className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" disabled={anchors.length === 0} onClick={() => clear()} title={t.clear}>
                        <Trash2 className="size-4" />
                    </Button>

                    {routing && <Loader2 className="size-4 animate-spin text-muted-foreground" />}

                    {error && (
                        <span className="max-w-48 truncate text-xs text-destructive" title={error}>
                            {error}
                        </span>
                    )}

                    {!error && summary !== null && (
                        <span className="text-xs text-muted-foreground">{summary.toFixed(1)} km</span>
                    )}

                    <Button
                        variant="outline"
                        size="sm"
                        disabled={resultPoints.length < 2 || saved}
                        onClick={() => void handleSave()}
                        className={cn(resultPoints.length >= 2 && 'border-primary/40', saved && 'text-green-600 border-green-600/40')}
                    >
                        {saved ? <Check className="size-4 text-green-600" /> : <Save className="size-4" />}
                        {saved ? t.saved : t.save}
                    </Button>
                </>
            )}
        </div>
    );
}
