import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Popup as MapLibrePopup, type MapMouseEvent } from 'maplibre-gl';
import { useLiveQuery } from 'dexie-react-hooks';
import { Layers } from 'lucide-react';
import { GPXFile, type GPXFileType } from '@x-route/gpx';
import { db, type StoredGPXFile } from '@/lib/db';
import { BASEMAPS, mapManager, type BasemapKey } from '@/lib/map/MapManager';
import { gpxLayers } from '@/lib/map/gpx-layer';
import { useSelectionStore } from '@/store/selection-slice';
import { useRoutingStore } from '@/store/routing-slice';
import { useRoutingSync } from '@/hooks/use-routing-sync';
import { cn } from '@/lib/utils';
import { useT } from '@/store/i18n-slice';

// --- Track info popup bridged into MapLibre's DOM via createPortal (AD-6) ---

function TrackPopupContent({ file }: { file: GPXFileType }) {
    const { t } = useT();
    const { global } = useMemo(() => new GPXFile(file).getStatistics(), [file]);
    return (
        <div className="space-y-0.5 text-sm">
            <div className="font-semibold">{file.metadata?.name ?? t.untitled}</div>
            <div className="text-muted-foreground">
                {global.distance.total.toFixed(1)} km · ↑{Math.round(global.elevation.gain)} m
            </div>
        </div>
    );
}

// --- Basemap switcher ---

function BasemapSwitcher({
    current,
    onChange,
}: {
    current: BasemapKey;
    onChange: (key: BasemapKey) => void;
}) {
    const { t } = useT();
    return (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-md backdrop-blur">
            <Layers className="mx-1 size-4 text-muted-foreground" />
            {(Object.keys(BASEMAPS) as BasemapKey[]).map((key) => (
                <button
                    key={key}
                    className={cn(
                        'rounded px-2 py-1 text-xs transition-colors',
                        current === key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                    )}
                    onClick={() => onChange(key)}
                >
                    {t.basemaps[key as keyof typeof t.basemaps] ?? BASEMAPS[key].label}
                </button>
            ))}
        </div>
    );
}

// --- Map view ---

const EMPTY_IDS: string[] = [];

export function MapView() {
    useRoutingSync();
    const containerRef = useRef<HTMLDivElement>(null);
    const popupContainerRef = useRef<HTMLDivElement | null>(null);
    const popupRef = useRef<MapLibrePopup | null>(null);
    const fileMapRef = useRef<Map<string, GPXFileType>>(new Map());
    const prevCountRef = useRef(0);
    const [basemap, setBasemap] = useState<BasemapKey>('liberty');
    const [popupFile, setPopupFile] = useState<GPXFileType | null>(null);

    const selectedFileId = useSelectionStore((state) => state.selectedFileId);
    const selectFile = useSelectionStore((state) => state.selectFile);

    const fileIds = useLiveQuery(() => db.fileids.toArray()) ?? EMPTY_IDS;
    const files = useLiveQuery(() => db.files.toArray());
    const fileMap = useMemo(() => {
        const map = new Map<string, GPXFileType>();
        for (const file of files ?? []) {
            const id = (file as StoredGPXFile)._data?.id;
            if (typeof id === 'string') map.set(id, file);
        }
        return map;
    }, [files]);

    // Keep the latest file map reachable from non-React map callbacks
    useEffect(() => {
        fileMapRef.current = fileMap;
    }, [fileMap]);

    // Wire selection callback once
    useEffect(() => {
        gpxLayers.onFileClick = (fileId) => selectFile(fileId);
        return () => {
            gpxLayers.onFileClick = null;
        };
    }, [selectFile]);

    // Map lifecycle (idempotent singleton per AD-6)
    useEffect(() => {
        if (!containerRef.current) return;
        const map = mapManager.init(containerRef.current);
        const unwireStyleReload = mapManager.onStyleReload(() => gpxLayers.resync());

        const popup = new MapLibrePopup({ closeButton: false, offset: 8 });
        const popupContainer = document.createElement('div');
        popupContainerRef.current = popupContainer;
        popupRef.current = popup;

        // Delegated click: show info popup for any rendered track under the
        // cursor — suppressed while the routing tool is placing anchors
        const onMapClick = (e: MapMouseEvent) => {
            if (useRoutingStore.getState().active) return;
            const layerIds = gpxLayers.getLayerIds().filter((id) => map.getLayer(id));
            const features = layerIds.length
                ? map.queryRenderedFeatures(e.point, { layers: layerIds })
                : [];
            const fileId = features[0]?.properties?.fileId as string | undefined;
            const file = fileId ? fileMapRef.current.get(fileId) : undefined;
            if (file) {
                setPopupFile(file);
                popup.setLngLat(e.lngLat).setDOMContent(popupContainer).addTo(map);
            }
        };
        map.on('click', onMapClick);

        return () => {
            unwireStyleReload();
            map.off('click', onMapClick);
            popup.remove();
            popupRef.current = null;
            popupContainerRef.current = null;
            mapManager.destroy();
        };
    }, []);

    // Sync track layers whenever files change
    useEffect(() => {
        const layerFiles = fileIds
            .map((id) => ({ fileId: id, file: fileMap.get(id) }))
            .filter((entry): entry is { fileId: string; file: GPXFileType } => !!entry.file);
        gpxLayers.sync(layerFiles, selectedFileId);

        // Fit bounds only when the file count grows (import) — not on selection changes
        if (layerFiles.length > prevCountRef.current) {
            const bounds = gpxLayers.getBounds(layerFiles);
            if (bounds) mapManager.fitBounds(bounds);
        }
        prevCountRef.current = layerFiles.length;
    }, [fileIds, fileMap, selectedFileId]);

    return (
        <div className="relative h-full w-full">
            <div ref={containerRef} className="h-full w-full" />
            <BasemapSwitcher
                current={basemap}
                onChange={(key) => {
                    setBasemap(key);
                    mapManager.setBasemap(key);
                }}
            />
            {popupFile && popupContainerRef.current
                ? createPortal(<TrackPopupContent file={popupFile} />, popupContainerRef.current)
                : null}
        </div>
    );
}
