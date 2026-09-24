// Worker entry for Workers Assets deployment.
// Serves /api/graphhopper/* as a CORS-free relay to graphhopper.gpx.studio
// (that upstream sends strict CORS: only https://gpx.studio origin allowed,
//  so the browser cannot call it directly from other origins).
// Also serves the route-share API (/api/share) and the /r/:key short links
// backed by the ROUTE_SHARES KV namespace. Everything else falls through to
// the static assets (SPA).

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

// --- Route sharing (KV: key = 6-char base62, value = gzip'd GPX, TTL 1 day) ---

const KEY_RE = /^[0-9A-Za-z]{6}$/;
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHARE_TTL_SECONDS = 86400; // 1 day — links are a delivery channel, not storage
const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024; // reject > 2 MB gzip payloads
const MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024; // gzip bombs must die here, not in the client's DOMParser

function json(message: unknown, status: number): Response {
    return new Response(JSON.stringify(message), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Random 6-char base62 key with rejection sampling (256 % 62 != 0). */
function generateShareKey(): string {
    let key = '';
    while (key.length < 6) {
        const rand = crypto.getRandomValues(new Uint8Array(8));
        for (const b of rand) {
            if (b < 248) {
                // 248 = 62 * 4 — bytes above it would bias the alphabet
                key += KEY_ALPHABET[b % 62];
                if (key.length === 6) break;
            }
        }
    }
    return key;
}

/** Validate a gzip'd GPX payload: magic bytes, both size caps, and an XML/GPX
 *  prefix peek — keeps the namespace from doubling as free anonymous blob hosting. */
async function validateGzipGPX(bytes: ArrayBuffer): Promise<string | null> {
    if (bytes.byteLength < 64) return 'payload too small';
    if (bytes.byteLength > MAX_COMPRESSED_BYTES) return 'payload too large';
    const u8 = new Uint8Array(bytes);
    if (u8[0] !== 0x1f || u8[1] !== 0x8b) return 'payload is not gzip';

    try {
        const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
        const reader = stream.getReader();
        let total = 0;
        let head = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_DECOMPRESSED_BYTES) {
                await reader.cancel();
                return 'decompressed payload too large';
            }
            if (head.length < 512) {
                head += new TextDecoder().decode(value.slice(0, 512 - head.length));
            }
        }
        const trimmed = head.replace(/^[\uFEFF\s]+/, '');
        if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<gpx')) return 'payload is not GPX';
        return null;
    } catch {
        return 'corrupt gzip payload';
    }
}

async function handleCreateShare(request: Request, env: any): Promise<Response> {
    const body = await request.arrayBuffer();
    const error = await validateGzipGPX(body);
    if (error) return json({ message: error }, 400);

    // get-then-put has a microscopic TOCTOU window (two workers minting the
    // same key in the same instant); the odds are astronomically against it
    // and the worst case is one share overwriting another. Accepted.
    for (let attempt = 0; attempt < 5; attempt++) {
        const key = generateShareKey();
        if ((await env.ROUTE_SHARES.get(key)) !== null) continue;
        await env.ROUTE_SHARES.put(key, body, { expirationTtl: SHARE_TTL_SECONDS });
        return json({ key }, 201);
    }
    return json({ message: 'could not allocate a free key' }, 503);
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
 *  the app. Nothing legitimate lives under /r/ besides 6-char keys. */
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
 * GeoIP redirection for Mainland China visitors.
 * When enabled (ENABLE_CN_REDIRECT=true), requests originating from CN (China)
 * accessing x-route.app will be 302-redirected to the CN target domain (default: x-route.cn).
 */
export function handleGeoRedirect(request: Request, url: URL, env: any): Response | null {
    const isEnabled = env.ENABLE_CN_REDIRECT === 'true' || env.ENABLE_CN_REDIRECT === true;
    if (!isEnabled) return null;

    const targetDomain = env.CN_TARGET_DOMAIN || 'x-route.cn';

    // Avoid self-redirect loops if request is already targeting the CN domain
    if (url.hostname === targetDomain || url.hostname.endsWith(`.${targetDomain}`)) {
        return null;
    }

    // Check Cloudflare GeoIP metadata
    const country = (request as any).cf?.country;
    if (country !== 'CN') return null;

    // Do NOT redirect backend API requests to avoid CORS / cross-origin breakage
    if (url.pathname.startsWith('/api/')) return null;

    // Redirect document navigation, root, or share links
    const accept = request.headers.get('accept') ?? '';
    const isNavRequest =
        request.method === 'GET' &&
        (accept.includes('text/html') || url.pathname === '/' || url.pathname.startsWith('/r/'));

    if (isNavRequest) {
        const targetUrl = new URL(request.url);
        targetUrl.hostname = targetDomain;
        targetUrl.protocol = 'https:';
        targetUrl.port = '';
        return Response.redirect(targetUrl.toString(), 302);
    }

    return null;
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

        // @ts-ignore - assets binding provided by wrangler assets config
        return env.ASSETS.fetch(request);
    },
};
