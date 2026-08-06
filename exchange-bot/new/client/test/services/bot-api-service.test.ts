import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { authService } from '../../src/services/auth-service.js';
import { botApiService } from '../../src/services/bot-api-service.js';

const originalFetch = globalThis.fetch;
const originalRefresh = authService.refresh;

beforeEach(() => {
    authService.accessToken = 'access-token';
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    authService.accessToken = undefined;
    authService.refresh = originalRefresh;
});

describe('bot API service', () => {
    it('loads typed rates from the authenticated app API', async () => {
        const fetchMock = Object.assign(
            mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
                Response.json({
                    base: 'USD',
                    date: '2026-08-06',
                    rates: { BRL: 5.4 },
                })
            ),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;

        const result = await botApiService.loadExchangeRates('book/id', '2026-08-06');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe('/api/v1/books/book%2Fid/exchange-rates?date=2026-08-06');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token');
        expect(result).toEqual({
            base: 'USD',
            date: '2026-08-06',
            rates: { BRL: 5.4 },
        });
    });

    it('exposes the app API error message', async () => {
        globalThis.fetch = Object.assign(
            mock(async () =>
                Response.json({ error: { message: '400: Rates unavailable' } }, { status: 502 })
            ),
            { preconnect: originalFetch.preconnect }
        );

        expect(botApiService.loadExchangeRates('book-id', '2026-08-06')).rejects.toThrow(
            /^400: Rates unavailable$/
        );
    });
});
