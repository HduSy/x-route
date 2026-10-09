import { describe, it, expect } from 'vitest';
import { handleGeoRedirect } from '../../worker';

const ENABLED = {
    ENABLE_CN_REDIRECT: 'true',
    CN_TARGET_DOMAIN: 'x-route.cn',
};

function navRequest(href: string, country?: string): { req: Request; url: URL } {
    const req = new Request(href, { headers: { accept: 'text/html' } });
    if (country) (req as any).cf = { country };
    return { req, url: new URL(req.url) };
}

describe('handleGeoRedirect', () => {
    it('returns null when ENABLE_CN_REDIRECT is disabled', () => {
        const { req, url } = navRequest('https://x-route.app/', 'CN');
        expect(handleGeoRedirect(req, url, { ENABLE_CN_REDIRECT: 'false' })).toBeNull();
    });

    // --- CN visitor → .cn domain ---

    it('redirects mainland China visitors on the app domain to the CN domain', () => {
        const { req, url } = navRequest('https://x-route.app/r/aB3xK9', 'CN');
        const res = handleGeoRedirect(req, url, ENABLED);
        expect(res?.status).toBe(302);
        expect(res?.headers.get('Location')).toBe('https://x-route.cn/r/aB3xK9');
    });

    it('redirects mainland China visitors on www.x-route.app to the CN domain', () => {
        const { req, url } = navRequest('https://www.x-route.app/', 'CN');
        const res = handleGeoRedirect(req, url, ENABLED);
        expect(res?.headers.get('Location')).toBe('https://x-route.cn/');
    });

    it('avoids infinite redirect loops if request is already targeting the CN domain', () => {
        const { req, url } = navRequest('https://x-route.cn/', 'CN');
        expect(handleGeoRedirect(req, url, ENABLED)).toBeNull();
    });

    // --- Overseas visitor on .cn → .app domain ---

    it('redirects overseas visitors on the CN domain back to the app domain', () => {
        const { req, url } = navRequest('https://x-route.cn/r/aB3xK9', 'US');
        const res = handleGeoRedirect(req, url, ENABLED);
        expect(res?.status).toBe(302);
        expect(res?.headers.get('Location')).toBe('https://x-route.app/r/aB3xK9');
    });

    it('redirects overseas visitors on www.x-route.cn to the app domain', () => {
        const { req, url } = navRequest('https://www.x-route.cn/', 'DE');
        const res = handleGeoRedirect(req, url, ENABLED);
        expect(res?.headers.get('Location')).toBe('https://x-route.app/');
    });

    it('avoids infinite redirect loops if an overseas visitor is already on the app domain', () => {
        const { req, url } = navRequest('https://x-route.app/', 'US');
        expect(handleGeoRedirect(req, url, ENABLED)).toBeNull();
    });

    it('treats non-mainland regions (HK/MO/TW) as overseas on the CN domain', () => {
        const { req, url } = navRequest('https://x-route.cn/', 'HK');
        const res = handleGeoRedirect(req, url, ENABLED);
        expect(res?.headers.get('Location')).toBe('https://x-route.app/');
    });

    it('keeps visitors in place when GeoIP country is unknown', () => {
        const { req, url } = navRequest('https://x-route.cn/'); // no cf metadata
        expect(handleGeoRedirect(req, url, ENABLED)).toBeNull();
    });

    // --- Exemptions (apply in both directions) ---

    it('does not redirect backend API requests', () => {
        const req = new Request('https://x-route.app/api/share', { method: 'POST' });
        (req as any).cf = { country: 'CN' };
        expect(handleGeoRedirect(req, new URL(req.url), ENABLED)).toBeNull();
    });

    it('does not redirect non-navigation (asset) requests', () => {
        const req = new Request('https://x-route.cn/assets/index-abc.js'); // no text/html accept
        (req as any).cf = { country: 'US' };
        expect(handleGeoRedirect(req, new URL(req.url), ENABLED)).toBeNull();
    });
});
