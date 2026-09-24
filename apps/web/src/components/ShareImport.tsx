import { useEffect } from 'react';
import { consumeShareKeyFromLocation, importSharedRoute } from '@/lib/share';
import { toast } from '@/lib/toast';
import { useT } from '@/store/i18n-slice';
import { mapManager } from '@/lib/map/MapManager';

/** Boot-time bridge for share links (/r/:key). Mounted after MapView so the
 *  map singleton exists before the import pipeline fits the camera. The URL
 *  is scrubbed on detection, so StrictMode double-mounts and re-renders are
 *  naturally idempotent. */
export function ShareImport() {
    const { t } = useT();

    useEffect(() => {
        const key = consumeShareKeyFromLocation();
        if (!key) return;
        let cancelled = false;
        importSharedRoute(key)
            .then((name) => {
                if (!cancelled) {
                    toast(t.sharedRouteImported.replace('{name}', name || t.untitled));
                    mapManager.onReady((map) => {
                        map.resize();
                        mapManager.fitToPlannerRoute();
                    });
                }
            })
            .catch(() => {
                // The worker 302s dead keys home before the SPA ever boots, so
                // this branch is only reachable for corrupted payloads.
                if (!cancelled) toast(t.shareLinkBroken, 'error');
            });
        return () => {
            cancelled = true;
        };
    }, [t]);

    return null;
}
