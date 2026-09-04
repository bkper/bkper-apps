import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { authService } from '../../src/services/auth-service.js';
import { BotApiError, botApiService } from '../../src/services/bot-api-service.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
    authService.accessToken = 'access-token';
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    authService.accessToken = undefined;
});

describe('Portfolio Bot API service', () => {
    it('loads pending-calculation Account ids for the Portfolio Book', async () => {
        const fetchMock = Object.assign(
            mock(async () => Response.json({ ids: ['account-2', 'account-1'] })),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;

        const pendingAccounts =
            await botApiService.listAccountsPendingCalculation('portfolio/book');

        expect(pendingAccounts).toEqual({ ids: ['account-2', 'account-1'] });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/books/portfolio%2Fbook/accounts/pending-calculation',
            expect.objectContaining({ method: 'GET' })
        );
    });

    it('calls every Account operation through its typed mutation route', async () => {
        const fetchMock = Object.assign(
            mock(async () => Response.json({ message: 'Done!' })),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;

        const results = await Promise.all([
            botApiService.calculateAccount('portfolio/book', 'account/1', {
                date: '2026-03-10',
                performMtm: true,
            }),
            botApiService.resetAccount('portfolio/book', 'account/1'),
            botApiService.fullResetAccount('portfolio/book', 'account/1'),
            botApiService.forwardAccount('portfolio/book', 'account/1', {
                date: '2026-03-11',
            }),
        ]);

        expect(results).toEqual([
            { message: 'Done!' },
            { message: 'Done!' },
            { message: 'Done!' },
            { message: 'Done!' },
        ]);
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            '/api/v1/books/portfolio%2Fbook/accounts/account%2F1/calculate',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ date: '2026-03-10', performMtm: true }),
            })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            '/api/v1/books/portfolio%2Fbook/accounts/account%2F1/reset',
            expect.objectContaining({ method: 'POST', body: undefined })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            '/api/v1/books/portfolio%2Fbook/accounts/account%2F1/full-reset',
            expect.objectContaining({ method: 'POST', body: undefined })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            4,
            '/api/v1/books/portfolio%2Fbook/accounts/account%2F1/forward',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ date: '2026-03-11' }),
            })
        );
    });

    it('preserves a structured mutation API error', async () => {
        globalThis.fetch = Object.assign(
            mock(async () =>
                Response.json(
                    { error: { message: 'Portfolio Book is locked' } },
                    { status: 400, statusText: 'Bad Request' }
                )
            ),
            { preconnect: originalFetch.preconnect }
        );

        const request = botApiService.resetAccount('portfolio-book', 'account-1');

        await expect(request).rejects.toEqual(new BotApiError('Portfolio Book is locked', 400));
    });
});
