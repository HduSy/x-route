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
