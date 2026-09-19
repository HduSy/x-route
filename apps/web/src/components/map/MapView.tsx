import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Popup as MapLibrePopup, type MapMouseEvent } from 'maplibre-gl';
import { useLiveQuery } from 'dexie-react-hooks';
import { Compass, Minus, Plus } from 'lucide-react';
import { GPXFile, type GPXFileType } from '@x-route/gpx';
import { db, type StoredGPXFile } from '@/lib/db';
import { mapManager } from '@/lib/map/MapManager';
import { gpxLayers } from '@/lib/map/gpx-layer';
import { useSelectionStore } from '@/store/selection-slice';
import { useRoutingStore } from '@/store/routing-slice';
import { useRoutingSync } from '@/hooks/use-routing-sync';
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

const EMPTY_IDS: string[] = [];

export function MapView() {
    useRoutingSync();
    const containerRef = useRef<HTMLDivElement>(null);
    const popupContainerRef = useRef<HTMLDivElement | null>(null);
    const popupRef = useRef<MapLibrePopup | null>(null);
    const fileMapRef = useRef<Map<string, GPXFileType>>(new Map());
    const prevCountRef = useRef(0);
    const [popupFile, setPopupFile] = useState<GPXFileType | null>(null);
    const [is3D, setIs3D] = useState(false);

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

    useEffect(() => {
        fileMapRef.current = fileMap;
    }, [fileMap]);

    useEffect(() => {
        gpxLayers.onFileClick = (fileId) => selectFile(fileId);
        return () => {
            gpxLayers.onFileClick = null;
        };
    }, [selectFile]);

    useEffect(() => {
        if (!containerRef.current) return;
        const map = mapManager.init(containerRef.current);
        const unwireStyleReload = mapManager.onStyleReload(() => gpxLayers.resync());

        const popup = new MapLibrePopup({ closeButton: false, offset: 8 });
        const popupContainer = document.createElement('div');
        popupContainerRef.current = popupContainer;
        popupRef.current = popup;

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

    useEffect(() => {
        const layerFiles = fileIds
            .map((id) => ({ fileId: id, file: fileMap.get(id) }))
            .filter((entry): entry is { fileId: string; file: GPXFileType } => !!entry.file);
        gpxLayers.sync(layerFiles, selectedFileId);

        if (layerFiles.length > prevCountRef.current) {
            const bounds = gpxLayers.getBounds(layerFiles);
            if (bounds) mapManager.fitBounds(bounds);
        }
        prevCountRef.current = layerFiles.length;
    }, [fileIds, fileMap, selectedFileId]);

    // Zoom & 3D handlers
    const handleZoomIn = () => mapManager.getMap()?.zoomIn();
    const handleZoomOut = () => mapManager.getMap()?.zoomOut();
    const handleResetCompass = () => mapManager.getMap()?.resetNorthPitch();
    const handleToggle3D = () => {
        const map = mapManager.getMap();
        if (!map) return;
        if (is3D) {
            map.easeTo({ pitch: 0, bearing: 0 });
            setIs3D(false);
        } else {
            map.easeTo({ pitch: 60, bearing: -20 });
            setIs3D(true);
        }
    };

    return (
        <div className="relative h-full w-full">
            <div ref={containerRef} className="h-full w-full" />

            {/* Strava style Map Controls (Zoom in, Zoom out, Compass) */}
            <div className="absolute left-3 top-16 z-10 flex flex-col gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-sm backdrop-blur select-none">
                <button
                    onClick={handleZoomIn}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition"
                    title="Zoom in"
                >
                    <Plus className="size-4" />
                </button>
                <button
                    onClick={handleZoomOut}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition"
                    title="Zoom out"
                >
                    <Minus className="size-4" />
                </button>
                <div className="h-px w-full bg-border" />
                <button
                    onClick={handleResetCompass}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition"
                    title="Reset bearing"
                >
                    <Compass className="size-4" />
                </button>
            </div>

            {/* 3D toggle button on bottom-left */}
            <div className="absolute bottom-4 left-3 z-10 select-none">
                <button
                    onClick={handleToggle3D}
                    className="flex h-8 items-center justify-center rounded-lg border border-border bg-background/95 px-2.5 text-xs font-bold text-foreground shadow-sm backdrop-blur transition hover:border-[#863BFF] hover:text-[#863BFF]"
                    title="Toggle 2D / 3D tilt"
                >
                    {is3D ? '2D' : '3D'}
                </button>
            </div>

            {popupFile && popupContainerRef.current
                ? createPortal(<TrackPopupContent file={popupFile} />, popupContainerRef.current)
                : null}
        </div>
    );
}
