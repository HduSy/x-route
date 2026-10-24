// Worker entry for Workers Assets deployment.
// Serves /api/graphhopper/* as a CORS-free relay to graphhopper.gpx.studio
// (that upstream sends strict CORS: only https://gpx.studio origin allowed,
//  so the browser cannot call it directly from other origins).
// Also serves the route-share API (/api/share) and the /r/:key short links
// backed by the ROUTE_SHARES KV namespace. Everything else falls through to
// the static assets (SPA).

import { deriveShareKey } from './src/lib/share-key';

const UPSTREAM = 'https://graphhopper.gpx.studio';

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

async function handleGraphHopper(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const target = `${UPSTREAM}${url.pathname.replace(/^\/api\/graphhopper/, '')}${url.search}`;

    const init: RequestInit = {
        method: request.method,
        headers: {
            'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
            Accept: request.headers.get('Accept') ?? 'application/json',
        },
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = await request.text();
    }

    const upstream = await fetch(target, init);

    const headers = new Headers(upstream.headers);
    Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
    });
}

// --- Route sharing (KV, content-addressed, write-once, no expiry) ---
// key = first 16 hex chars of the route's canonical SHA-256 (name + track
// points), derived HERE from the posted GPX — never from client input. The
// same route content (including a route re-imported from a share link, after
// the lossless parse/buildGPX round-trip) therefore always resolves to the
// same permanent link. Entries are write-once: an existing key is returned
// as-is and never overwritten. Legacy random 6-char keys keep resolving.

const KEY_RE = /^[0-9a-f]{16}$|^[0-9A-Za-z]{6}$/;
const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024; // reject > 2 MB gzip payloads
const MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024; // gzip bombs must die here, not in the client's DOMParser

function json(message: unknown, status: number): Response {
    return new Response(JSON.stringify(message), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Validate a gzip'd GPX payload and return its decompressed XML: magic
 *  bytes, both size caps, and an XML/GPX prefix peek — keeps the namespace
 *  from doubling as free anonymous blob hosting. */
async function validateGzipGPX(bytes: ArrayBuffer): Promise<{ error: string } | { xml: string }> {
    if (bytes.byteLength < 64) return { error: 'payload too small' };
    if (bytes.byteLength > MAX_COMPRESSED_BYTES) return { error: 'payload too large' };
    const u8 = new Uint8Array(bytes);
    if (u8[0] !== 0x1f || u8[1] !== 0x8b) return { error: 'payload is not gzip' };

    try {
        const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        const chunks: string[] = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_DECOMPRESSED_BYTES) {
                await reader.cancel();
                return { error: 'decompressed payload too large' };
            }
            chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
        const xml = chunks.join('');
        const trimmed = xml.slice(0, 512).replace(/^[﻿\s]+/, '');
        if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<gpx')) {
            return { error: 'payload is not GPX' };
        }
        return { xml };
    } catch {
        return { error: 'corrupt gzip payload' };
    }
}

async function handleCreateShare(request: Request, env: any): Promise<Response> {
    const body = await request.arrayBuffer();
    const result = await validateGzipGPX(body);
    if ('error' in result) return json({ message: result.error }, 400);

    const key = await deriveShareKey(result.xml);

    // Write-once: an existing key means this exact content was already shared
    // (dedup hit, zero writes) or — at ~3e-8 odds per million distinct routes —
    // a 64-bit prefix collision; either way the existing entry wins untouched,
    // which also makes targeted overwrites of live links impossible.
    if ((await env.ROUTE_SHARES.get(key)) !== null) return json({ key }, 200);

    // no expirationTtl — share links are permanent (KV entries never expire)
    await env.ROUTE_SHARES.put(key, body);
    return json({ key }, 201);
}

async function handleGetShare(key: string, env: any): Promise<Response> {
    if (!KEY_RE.test(key)) return json({ message: 'not found' }, 404);
    const value: ArrayBuffer | null = await env.ROUTE_SHARES.get(key, 'arrayBuffer');
    if (value === null) return json({ message: 'not found' }, 404);
    return new Response(value, {
        headers: { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store' },
    });
}

/** /r/:key — share short link. A live key serves the SPA at its pretty URL
 *  (assets SPA fallback); anything else 302s home so dead links never boot
 *  the app. Keys are 16-hex content hashes, plus legacy 6-char base62. */
async function handleShareLink(request: Request, url: URL, env: any): Promise<Response> {
    const key = url.pathname.slice(3).replace(/\/+$/, '');
    const exists = KEY_RE.test(key) ? await env.ROUTE_SHARES.get(key) : null;
    if (!exists) {
        return Response.redirect(new URL('/', url), 302);
    }
    // @ts-ignore - assets binding provided by wrangler assets config
    return env.ASSETS.fetch(request);
}

/**
 * Bidirectional GeoIP redirection between the two domains.
 * When enabled (ENABLE_CN_REDIRECT=true):
 *  - CN visitors on x-route.app are 302-redirected to x-route.cn (ICP-filed)
 *  - non-CN visitors on x-route.cn are 302-redirected back to x-route.app
 * Each side only sends visitors across — nobody bounces twice.
 */
export function handleGeoRedirect(request: Request, url: URL, env: any): Response | null {
    const isEnabled = env.ENABLE_CN_REDIRECT === 'true' || env.ENABLE_CN_REDIRECT === true;
    if (!isEnabled) return null;

    const cnDomain = env.CN_TARGET_DOMAIN || 'x-route.cn';
    const appDomain = env.APP_TARGET_DOMAIN || 'x-route.app';
    const isCnHost = url.hostname === cnDomain || url.hostname.endsWith(`.${cnDomain}`);
    const isAppHost = url.hostname === appDomain || url.hostname.endsWith(`.${appDomain}`);

    // Cloudflare GeoIP metadata. Unknown country stays put — a failed geo
    // lookup must never move a visitor, least of all a mainland one.
    const country = (request as any).cf?.country;
    let targetDomain: string | null = null;
    if (isAppHost && country === 'CN') targetDomain = cnDomain;
    else if (isCnHost && country && country !== 'CN') targetDomain = appDomain;
    if (!targetDomain) return null;

    // Do NOT redirect backend API requests to avoid CORS / cross-origin breakage
    if (url.pathname.startsWith('/api/')) return null;

    // Redirect document navigation, root, or share links only
    const accept = request.headers.get('accept') ?? '';
    const isNavRequest =
        request.method === 'GET' &&
        (accept.includes('text/html') || url.pathname === '/' || url.pathname.startsWith('/r/'));

    if (!isNavRequest) return null;

    const targetUrl = new URL(request.url);
    targetUrl.hostname = targetDomain;
    targetUrl.protocol = 'https:';
    targetUrl.port = '';
    return Response.redirect(targetUrl.toString(), 302);
}

export default {
    async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Optional GeoIP redirection for mainland China visitors
        const redirect = handleGeoRedirect(request, url, env);
        if (redirect) return redirect;

        if (url.pathname.startsWith('/api/graphhopper')) {
            if (request.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: CORS_HEADERS });
            }
            try {
                return await handleGraphHopper(request);
            } catch (err: any) {
                return new Response(JSON.stringify({ message: err?.message ?? 'relay error' }), {
                    status: 502,
                    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
                });
            }
        }

        // Route sharing: publish a route / fetch a shared route's GPX payload
        if (url.pathname === '/api/share' && request.method === 'POST') {
            return handleCreateShare(request, env);
        }
        if (url.pathname.startsWith('/api/share/') && request.method === 'GET') {
            return handleGetShare(decodeURIComponent(url.pathname.slice('/api/share/'.length)), env);
        }

        // Share short links (/r/:key) — see handleShareLink
        if (url.pathname.startsWith('/r/')) {
            return handleShareLink(request, url, env);
        }

        // Public runtime config endpoint (exposes Cloudflare Dashboard env vars to client)
        if (url.pathname === '/api/config') {
            const foundKey = env.VITE_TIANDITU_KEY || env.TIANDITU_KEY || '';
            return new Response(
                JSON.stringify({
                    tiandituKey: foundKey,
                }),
                {
                    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
                }
            );
        }

        // @ts-ignore - assets binding provided by wrangler assets config
        const response = await env.ASSETS.fetch(request);
        const tiandituKey = env.VITE_TIANDITU_KEY || env.TIANDITU_KEY;
        if (tiandituKey && response.headers.get('content-type')?.includes('text/html')) {
            // @ts-ignore - HTMLRewriter provided by Cloudflare Workers runtime
            return new HTMLRewriter()
                .on('head', {
                    element(head: any) {
                        head.append(`<script>window.__TIANDITU_KEY__=${JSON.stringify(tiandituKey)};</script>`, {
                            html: true,
                        });
                    },
                })
                .transform(response);
        }
        return response;
    },
};
