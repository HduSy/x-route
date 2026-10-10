import { describe, it, expect } from 'vitest';
import { defaultLanguageForHost } from './i18n-slice';

describe('defaultLanguageForHost', () => {
    it('defaults to Chinese on the CN domain and its subdomains', () => {
        expect(defaultLanguageForHost('x-route.cn')).toBe('zh');
        expect(defaultLanguageForHost('www.x-route.cn')).toBe('zh');
    });

    it('defaults to English on the international domain and unknown hosts', () => {
        expect(defaultLanguageForHost('x-route.app')).toBe('en');
        expect(defaultLanguageForHost('www.x-route.app')).toBe('en');
        expect(defaultLanguageForHost('localhost')).toBe('en');
        expect(defaultLanguageForHost(undefined)).toBe('en');
    });

    it('is not fooled by lookalike hostnames', () => {
        expect(defaultLanguageForHost('notx-route.cn')).toBe('en');
        expect(defaultLanguageForHost('foo.x-route.cn.example.com')).toBe('en');
    });
});
