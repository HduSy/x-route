import { buildGPX, GPXFile, type GPXFileType } from '@x-route/gpx';
import { db } from './db';
import { importFiles } from './file-actions';

// --- Route sharing ---
// Share links look like https://x-route.app/r/aB3xK9p — the worker checks the
// key against KV (302 home when dead), then the SPA boots, reads the key off
// its pathname, and runs the shared GPX through the exact same pipeline as a
// local file import (dedup, card, planner load, camera fit included).

/** Share short-link path shape served by the worker. */
export const SHARE_PATH_RE = /^\/r\/([0-9A-Za-z]{6})\/?$/;

async function gzipText(text: string): Promise<Uint8Array<ArrayBuffer>> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipToText(bytes: ArrayBuffer): Promise<string> {
    const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
}

/** Serialize a saved route to GPX, publish it, and return the share URL. */
export async function createShareLink(fileId: string): Promise<string> {
    const data = await db.files.get(fileId);
    if (!data) throw new Error('route not found');
    const xml = buildGPX(new GPXFile(data as GPXFileType), []);
    const payload = await gzipText(xml);

    const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/gzip' },
        body: payload,
    });
    if (!res.ok) throw new Error(`share request failed (${res.status})`);
    const { key } = (await res.json()) as { key: string };
    return `${location.origin}/r/${key}`;
}

/** Copy text to the clipboard with a fallback for older/insecure contexts. */
export async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
        } finally {
            textarea.remove();
        }
    }
}

/** Read the share key from the current URL. Scrubs the path immediately so a
 *  refresh (or a re-run of this effect) can never re-trigger the import. */
export function consumeShareKeyFromLocation(): string | null {
    const match = SHARE_PATH_RE.exec(location.pathname);
    if (!match) return null;
    history.replaceState(null, '', '/');
    return match[1]!;
}

/** Fetch a shared route and import it exactly like a local .gpx file —
 *  returns the route name for the success toast. */
export async function importSharedRoute(key: string): Promise<string> {
    const res = await fetch(`/api/share/${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`share not found (${res.status})`);
    const xml = await gunzipToText(await res.arrayBuffer());
    const file = new File([xml], 'shared-route.gpx', { type: 'application/gpx+xml' });
    const parsed = await importFiles([file]);
    return parsed[0]?.metadata?.name?.trim() || '';
}
