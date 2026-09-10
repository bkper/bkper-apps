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

describe('Inventory Bot API service', () => {
    it('calls Calculate and Reset through their generated typed mutation routes', async () => {
        const fetchMock = Object.assign(
            mock(async () => Response.json({ message: 'Done!' })),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;

        const results = await Promise.all([
            botApiService.calculateAccount('inventory/book', 'account/1', {
                date: '2026-03-10',
            }),
            botApiService.resetAccount('inventory/book', 'account/1'),
        ]);

        expect(results).toEqual([{ message: 'Done!' }, { message: 'Done!' }]);
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            '/api/v1/books/inventory%2Fbook/accounts/account%2F1/calculate',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ date: '2026-03-10' }),
            })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            '/api/v1/books/inventory%2Fbook/accounts/account%2F1/reset',
            expect.objectContaining({ method: 'POST', body: undefined })
        );
    });

    it('preserves a structured mutation API error', async () => {
        globalThis.fetch = Object.assign(
            mock(async () =>
                Response.json(
                    { error: { message: 'Financial Book is unavailable' } },
                    { status: 400, statusText: 'Bad Request' }
                )
            ),
            { preconnect: originalFetch.preconnect }
        );

        const request = botApiService.resetAccount('inventory-book', 'account-1');

        await expect(request).rejects.toEqual(
            new BotApiError('Financial Book is unavailable', 400)
        );
    });
});
