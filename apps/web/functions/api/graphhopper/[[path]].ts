// AD-5: edge relay for graphhopper.gpx.studio (strict CORS: only allows https://gpx.studio origin).
// The browser talks to /api/graphhopper/*; this function forwards server-side where CORS does not apply.

const UPSTREAM = 'https://graphhopper.gpx.studio';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

export const onRequestOptions = async () =>
    new Response(null, { status: 204, headers: CORS_HEADERS });

export const onRequest = async (context: EventContext<Env, string, unknown>) => {
    const url = new URL(context.request.url);
    const target = `${UPSTREAM}${url.pathname.replace(/^\/api\/graphhopper/, '')}${url.search}`;

    const init: RequestInit = {
        method: context.request.method,
        headers: {
            'Content-Type': context.request.headers.get('Content-Type') ?? 'application/json',
            Accept: context.request.headers.get('Accept') ?? 'application/json',
        },
    };
    if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
        init.body = await context.request.text();
    }

    const upstream = await fetch(target, init);

    const headers = new Headers(upstream.headers);
    Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
    });
};
