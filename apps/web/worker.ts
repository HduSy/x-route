// Worker entry for Workers Assets deployment.
// Serves /api/graphhopper/* as a CORS-free relay to graphhopper.gpx.studio
// (that upstream sends strict CORS: only https://gpx.studio origin allowed,
//  so the browser cannot call it directly from other origins).
// Everything else falls through to the static assets (SPA).

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

export default {
    async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

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

        // @ts-ignore - assets binding provided by wrangler assets config
        return env.ASSETS.fetch(request);
    },
};
