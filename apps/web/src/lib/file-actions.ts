import { buildGPX, GPXFile, type GPXFileType } from '@x-route/gpx';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { db } from './db';
import { useSelectionStore } from '@/store/selection-slice';
import { useRoutingStore } from '@/store/routing-slice';
import { mapManager } from '@/lib/map/MapManager';
import type { ParseResponse } from '@/workers/gpx.worker';

// --- GPX parse worker (keeps large XML parsing off the main thread) ---

let worker: Worker | null = null;
let requestIdCounter = 0;
const pending = new Map<number, { resolve: (file: GPXFile) => void; reject: (reason: Error) => void }>();

function getWorker(): Worker {
    if (!worker) {
        worker = new Worker(new URL('../workers/gpx.worker.ts', import.meta.url), {
            type: 'module',
        });
        worker.onmessage = (event: MessageEvent<ParseResponse>) => {
            const { type, requestId } = event.data;
            const entry = pending.get(requestId);
            if (!entry) return;
            pending.delete(requestId);
            if (type === 'parsed') {
                entry.resolve(new GPXFile(event.data.file as GPXFileType));
            } else {
                entry.reject(new Error(`Failed to parse ${event.data.fileName}: ${event.data.message}`));
            }
        };
    }
    return worker;
}

function parseInWorker(fileName: string, xml: string): Promise<GPXFile> {
    const requestId = ++requestIdCounter;
    return new Promise<GPXFile>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        getWorker().postMessage({ type: 'parse', requestId, fileName, xml });
    });
}

// --- Import ---

export function triggerFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gpx,.zip';
    input.multiple = true;
    input.className = 'hidden';
    input.onchange = () => {
        if (input.files?.length) {
            void importFiles(Array.from(input.files));
        }
    };
    input.click();
}

async function computeTextHash(text: string): Promise<string> {
    try {
        const buffer = new TextEncoder().encode(text.trim());
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return '';
    }
}

function getRouteGeometryFingerprint(file: GPXFileType): string {
    const gpx = file instanceof GPXFile ? file : new GPXFile(file);
    const trkpts = gpx.getTrackPoints();
    if (trkpts.length === 0) {
        return `empty:${(gpx.metadata?.name || '').trim().toLowerCase()}`;
    }

    const { global } = gpx.getStatistics();
    const pointCount = trkpts.length;
    const totalDist = Math.round(global.distance.total * 100);
    const totalAscent = Math.round(global.elevation.gain);

    const sample: string[] = [];
    const step = Math.max(1, Math.floor(pointCount / 10));
    for (let i = 0; i < pointCount; i += step) {
        const c = trkpts[i]!.getCoordinates();
        sample.push(`${c.lat.toFixed(4)},${c.lon.toFixed(4)}`);
    }
    const end = trkpts[pointCount - 1]!.getCoordinates();
    sample.push(`${end.lat.toFixed(4)},${end.lon.toFixed(4)}`);

    return `${pointCount}|${totalDist}|${totalAscent}|${sample.join(';')}`;
}

export async function importFiles(list: File[]): Promise<GPXFile[]> {
    const parsed: GPXFile[] = [];

    for (const file of list) {
        if (file.name.toLowerCase().endsWith('.zip')) {
            const zip = await JSZip.loadAsync(file);
            for (const entry of Object.values(zip.files)) {
                if (entry.dir || !entry.name.toLowerCase().endsWith('.gpx')) continue;
                const xml = await entry.async('text');
                const gpx = await parseInWorker(entry.name, xml);
                gpx._data.rawHash = await computeTextHash(xml);
                parsed.push(gpx);
            }
        } else {
            const xml = await file.text();
            const gpx = await parseInWorker(file.name, xml);
            gpx._data.rawHash = await computeTextHash(xml);
            parsed.push(gpx);
        }
    }

    await addFiles(parsed);
    return parsed;
}

async function addFiles(files: GPXFile[]) {
    const select = useSelectionStore.getState();
    const routing = useRoutingStore.getState();

    // Query existing saved routes from Dexie to detect duplicate imports
    const existingStored = await db.files.toArray();
    const existingFingerprints = new Map<string, string>();
    const existingRawHashes = new Map<string, string>();

    for (const stored of existingStored) {
        const id = stored._data?.id;
        if (!id) continue;
        if (stored._data?.rawHash) {
            existingRawHashes.set(stored._data.rawHash, id);
        }
        try {
            const fp = getRouteGeometryFingerprint(stored);
            existingFingerprints.set(fp, id);
        } catch {
            // ignore corrupt entries
        }
    }

    let firstId: string | null = null;
    let firstFile: GPXFile | null = null;
    const targetFileIds: string[] = [];
    const filesToInsert: { file: GPXFile; id: string }[] = [];

    for (const file of files) {
        let matchedId: string | null = null;

        // 1. Check raw XML hash match
        if (file._data?.rawHash && existingRawHashes.has(file._data.rawHash)) {
            matchedId = existingRawHashes.get(file._data.rawHash)!;
        }

        // 2. Check geometry fingerprint match
        if (!matchedId) {
            try {
                const fp = getRouteGeometryFingerprint(file);
                if (existingFingerprints.has(fp)) {
                    matchedId = existingFingerprints.get(fp)!;
                }
            } catch {
                // ignore
            }
        }

        if (matchedId) {
            // Duplicate found! Reuse existing route ID without creating duplicate card
            targetFileIds.push(matchedId);
            if (firstId === null) {
                firstId = matchedId;
                firstFile = file;
            }
        } else {
            // New route: generate UUID and schedule database write
            const newId = crypto.randomUUID();
            file._data.id = newId;
            targetFileIds.push(newId);
            if (firstId === null) {
                firstId = newId;
                firstFile = file;
            }
            filesToInsert.push({ file, id: newId });

            // Record into maps so multiple duplicate files in the same batch import are also deduplicated
            if (file._data?.rawHash) {
                existingRawHashes.set(file._data.rawHash, newId);
            }
            try {
                existingFingerprints.set(getRouteGeometryFingerprint(file), newId);
            } catch {
                // ignore
            }
        }
    }

    if (filesToInsert.length > 0) {
        await db.transaction('rw', db.files, db.fileids, async () => {
            for (const { file, id } of filesToInsert) {
                await db.files.put(file, id);
                await db.fileids.put(id, id);
            }
        });
    }

    if (firstId !== null && firstFile !== null) {
        // 1. Add all target files to loaded files so they are highlighted in My Routes and rendered on the map
        for (const id of targetFileIds) {
            select.addLoadedFile(id);
        }
        select.selectFile(firstId);

        // 2. Load the primary route into the routing planner (active editing with nodes)
        const trkpts = (firstFile as GPXFile).getTrackPoints();
        if (trkpts.length >= 2) {
            const coords = trkpts.map((pt) => pt.getCoordinates());
            routing.loadRouteFromPoints(coords, trkpts);
            routing.setEditingFileId(firstId);
            routing.setSidebarCollapsed(false);
        }

        // 3. Fit camera bounds to the route
        mapManager.onReady((map) => {
            map.resize();
            const { global } = (firstFile as GPXFile).getStatistics();
            if (trkpts.length >= 2) {
                mapManager.fitToPlannerRoute();
            } else if (global?.bounds) {
                const sw = global.bounds.southWest;
                const ne = global.bounds.northEast;
                mapManager.fitBounds([[sw.lon, sw.lat], [ne.lon, ne.lat]], 80);
            }
        });
    }
}

// --- Export ---

export async function exportFile(fileId: string) {
    const data = await db.files.get(fileId);
    if (!data) return;

    const file = new GPXFile(data as GPXFileType);
    const xml = buildGPX(file, []);
    const name = file.metadata?.name?.trim() || 'route';
    saveAs(new Blob([xml], { type: 'application/gpx+xml' }), `${name}.gpx`);
}

// --- Save a computed route as a new file ---

export async function saveGPXFile(file: GPXFile, autoSelect = true): Promise<string> {
    const id = crypto.randomUUID();
    file._data.id = id;
    await db.transaction('rw', db.files, db.fileids, async () => {
        await db.files.put(file, id);
        await db.fileids.put(id, id);
    });
    if (autoSelect) {
        useSelectionStore.getState().selectFile(id);
    }
    return id;
}

/** Update an existing route in-place (editing mode). Does NOT create a new UUID. */
export async function updateGPXFile(fileId: string, file: GPXFile, autoSelect = true): Promise<void> {
    file._data.id = fileId;
    await db.transaction('rw', db.files, db.fileids, async () => {
        await db.files.put(file, fileId);
        // fileids entry already exists — no need to re-insert
    });
    if (autoSelect) {
        useSelectionStore.getState().selectFile(fileId);
    }
}

// --- Delete ---

export async function deleteFile(fileId: string) {
    await db.transaction('rw', db.files, db.fileids, async () => {
        await db.files.delete(fileId);
        await db.fileids.delete(fileId);
    });

    const select = useSelectionStore.getState();
    select.removeLoadedFile(fileId);
    if (select.selectedFileId === fileId) {
        const remaining = await db.fileids.toArray();
        select.selectFile(remaining[0] ?? null);
    }

    // If the deleted route is loaded in the editor, clear the drawn route too
    // so it disappears from the map completely.
    const routing = useRoutingStore.getState();
    if (routing.editingFileId === fileId) {
        routing.clear();
    }
}

// --- Track Editing Operations (Phase 4) ---

import { ramerDouglasPeucker, Waypoint, type Coordinates } from '@x-route/gpx';

export async function reverseTrack(fileId: string) {
    const data = await db.files.get(fileId);
    if (!data) return;

    const file = new GPXFile(data as GPXFileType);
    file.reverse();
    file._data.id = fileId;
    await db.files.put(file, fileId);
}

export async function simplifyTrack(fileId: string, toleranceMeters = 15) {
    const data = await db.files.get(fileId);
    if (!data) return;

    const file = new GPXFile(data as GPXFileType);
    file.forEachSegment((segment) => {
        if (segment.trkpt.length > 2) {
            const simplified = ramerDouglasPeucker(segment.trkpt, toleranceMeters);
            segment.trkpt = simplified.map((s) => s.point);
        }
    });
    file._data.id = fileId;
    await db.files.put(file, fileId);
}

export async function closeLoop(fileId: string) {
    const data = await db.files.get(fileId);
    if (!data) return;

    const file = new GPXFile(data as GPXFileType);
    const segments = file.getSegments();
    if (segments.length > 0 && segments[0]!.trkpt.length > 1) {
        const firstPt = segments[0]!.trkpt[0]!;
        const lastSeg = segments[segments.length - 1]!;
        lastSeg.trkpt.push(firstPt.clone());
    }
    file._data.id = fileId;
    await db.files.put(file, fileId);
}

export async function splitTrackAtMiddle(fileId: string) {
    const data = await db.files.get(fileId);
    if (!data) return;

    const file = new GPXFile(data as GPXFileType);
    const totalPts = file.getNumberOfTrackPoints();
    if (totalPts < 4) return;

    const mid = Math.floor(totalPts / 2);

    // Part 1: keep first half
    file.crop(0, mid);
    file._data.id = fileId;
    await db.files.put(file, fileId);

    // Part 2: second half as new file
    const file2 = new GPXFile(data as GPXFileType);
    file2.crop(mid, totalPts - 1);
    const id2 = crypto.randomUUID();
    file2._data.id = id2;
    file2.metadata.name = `${file.metadata?.name ?? 'track'} (part 2)`;

    await db.transaction('rw', db.files, db.fileids, async () => {
        await db.files.put(file2, id2);
        await db.fileids.put(id2, id2);
    });
    useSelectionStore.getState().selectFile(id2);
}

export async function addWaypointToFile(
    fileId: string,
    name: string,
    coords: Coordinates,
    sym = 'Waypoint'
) {
    const data = await db.files.get(fileId);
    if (!data) return;

    const file = new GPXFile(data as GPXFileType);
    const wpt = new Waypoint({
        attributes: { lat: coords.lat, lon: coords.lon },
        name,
        sym,
    });
    file.wpt.push(wpt);
    file._data.id = fileId;
    await db.files.put(file, fileId);
}

