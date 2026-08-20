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

    it('preserves a structured API error', async () => {
        globalThis.fetch = Object.assign(
            mock(async () =>
                Response.json(
                    { error: { message: 'Portfolio Book not found' } },
                    { status: 404, statusText: 'Not Found' }
                )
            ),
            { preconnect: originalFetch.preconnect }
        );

        const request = botApiService.listAccountsPendingCalculation('portfolio-book');

        await expect(request).rejects.toEqual(new BotApiError('Portfolio Book not found', 404));
    });
});
