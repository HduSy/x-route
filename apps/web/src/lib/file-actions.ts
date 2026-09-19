import { buildGPX, GPXFile, type GPXFileType } from '@x-route/gpx';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { db } from './db';
import { useSelectionStore } from '@/store/selection-slice';
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

export async function importFiles(list: File[]): Promise<GPXFile[]> {
    const parsed: GPXFile[] = [];

    for (const file of list) {
        if (file.name.toLowerCase().endsWith('.zip')) {
            const zip = await JSZip.loadAsync(file);
            for (const entry of Object.values(zip.files)) {
                if (entry.dir || !entry.name.toLowerCase().endsWith('.gpx')) continue;
                const xml = await entry.async('text');
                parsed.push(await parseInWorker(entry.name, xml));
            }
        } else {
            const xml = await file.text();
            parsed.push(await parseInWorker(file.name, xml));
        }
    }

    await addFiles(parsed);
    return parsed;
}

async function addFiles(files: GPXFile[]) {
    const select = useSelectionStore.getState();
    let firstId: string | null = null;

    await db.transaction('rw', db.files, db.fileids, async () => {
        for (const file of files) {
            const id = crypto.randomUUID();
            file._data.id = id;
            if (firstId === null) firstId = id;
            await db.files.put(file, id);
            await db.fileids.put(id, id);
        }
    });

    if (firstId !== null) {
        select.selectFile(firstId);
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

export async function saveGPXFile(file: GPXFile): Promise<string> {
    const id = crypto.randomUUID();
    file._data.id = id;
    await db.transaction('rw', db.files, db.fileids, async () => {
        await db.files.put(file, id);
        await db.fileids.put(id, id);
    });
    useSelectionStore.getState().selectFile(id);
    return id;
}

// --- Delete ---

export async function deleteFile(fileId: string) {
    await db.transaction('rw', db.files, db.fileids, async () => {
        await db.files.delete(fileId);
        await db.fileids.delete(fileId);
    });

    const select = useSelectionStore.getState();
    if (select.selectedFileId === fileId) {
        const remaining = await db.fileids.toArray();
        select.selectFile(remaining[0] ?? null);
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

