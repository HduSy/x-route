import { describe, it, expect } from 'vitest';
import { handleGeoRedirect } from '../../worker';

describe('handleGeoRedirect', () => {
    it('returns null when ENABLE_CN_REDIRECT is disabled', () => {
        const req = new Request('https://x-route.app/');
        (req as any).cf = { country: 'CN' };
        const url = new URL(req.url);

        const res = handleGeoRedirect(req, url, { ENABLE_CN_REDIRECT: 'false' });
        expect(res).toBeNull();
    });

    it('redirects mainland China visitors when ENABLE_CN_REDIRECT is enabled', () => {
        const req = new Request('https://x-route.app/r/aB3xK9', {
            headers: { accept: 'text/html' },
        });
        (req as any).cf = { country: 'CN' };
        const url = new URL(req.url);

        const res = handleGeoRedirect(req, url, {
            ENABLE_CN_REDIRECT: 'true',
            CN_TARGET_DOMAIN: 'x-route.cn',
        });
        expect(res).not.toBeNull();
        expect(res?.status).toBe(302);
        expect(res?.headers.get('Location')).toBe('https://x-route.cn/r/aB3xK9');
    });

    it('does not redirect non-China visitors', () => {
        const req = new Request('https://x-route.app/', {
            headers: { accept: 'text/html' },
        });
        (req as any).cf = { country: 'US' };
        const url = new URL(req.url);

        const res = handleGeoRedirect(req, url, {
            ENABLE_CN_REDIRECT: 'true',
            CN_TARGET_DOMAIN: 'x-route.cn',
        });
        expect(res).toBeNull();
    });

    it('avoids infinite redirect loops if request is already targeting the CN domain', () => {
        const req = new Request('https://x-route.cn/', {
            headers: { accept: 'text/html' },
        });
        (req as any).cf = { country: 'CN' };
        const url = new URL(req.url);

        const res = handleGeoRedirect(req, url, {
            ENABLE_CN_REDIRECT: 'true',
            CN_TARGET_DOMAIN: 'x-route.cn',
        });
        expect(res).toBeNull();
    });

    it('does not redirect backend API requests', () => {
        const req = new Request('https://x-route.app/api/share', {
            method: 'POST',
        });
        (req as any).cf = { country: 'CN' };
        const url = new URL(req.url);

        const res = handleGeoRedirect(req, url, {
            ENABLE_CN_REDIRECT: 'true',
            CN_TARGET_DOMAIN: 'x-route.cn',
        });
        expect(res).toBeNull();
    });
});
