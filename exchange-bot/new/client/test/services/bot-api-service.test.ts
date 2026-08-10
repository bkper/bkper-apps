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

    it('runs Exchange Update for one Book with the edited rates', async () => {
        const acceptedTransactions: bkper.Transaction[] = [
            {
                amount: '12.34',
                description: '#exchange_loss',
                debitAccount: { name: 'Cash EXC' },
            },
        ];
        const fetchMock = Object.assign(
            mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
                Response.json(acceptedTransactions)
            ),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;
        const exchangeRates = {
            base: 'USD',
            date: '2026-08-06',
            rates: { BRL: '5.25' },
        };

        const result: bkper.Transaction[] = await botApiService.performExchangeUpdate(
            'book/id',
            exchangeRates
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe('/api/v1/books/book%2Fid/exchange-update');
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token');
        expect(await new Request('https://test.invalid', init).json()).toEqual(exchangeRates);
        expect(result).toEqual(acceptedTransactions);
    });

    it('exposes an Exchange Update API error without retrying the mutation', async () => {
        const fetchMock = Object.assign(
            mock(async () =>
                Response.json({ error: { message: 'Update unavailable' } }, { status: 500 })
            ),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;

        expect(
            botApiService.performExchangeUpdate('book-id', {
                base: 'USD',
                date: '2026-08-06',
                rates: { BRL: 5.25 },
            })
        ).rejects.toThrow(/^Update unavailable$/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
