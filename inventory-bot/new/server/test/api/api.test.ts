import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createApp } from '../../src/index.js';
import { CalculateService } from '../../src/api/services/calculate-service.js';
import { ResetService } from '../../src/api/services/reset-service.js';

const env = {
    ASSETS: { fetch: async () => new Response('asset') },
};

const originalCalculate = CalculateService.execute;
const originalReset = ResetService.execute;

async function request(path: string, init?: RequestInit): Promise<Response> {
    return createApp().request(path, init, env);
}

afterEach(() => {
    CalculateService.execute = originalCalculate;
    ResetService.execute = originalReset;
});

describe('typed Inventory Bot API', () => {
    test('passes Calculate inputs to the service and returns the operation message', async () => {
        CalculateService.execute = mock(async (_context, bookId, accountId, calculateRequest) => {
            expect(bookId).toBe('inventory-book');
            expect(accountId).toBe('item-account');
            expect(calculateRequest).toEqual({ date: '2026-09-02' });
            return { message: 'Calculated' };
        });

        const response = await request(
            '/api/v1/books/inventory-book/accounts/item-account/calculate',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ date: '2026-09-02' }),
            }
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ message: 'Calculated' });
    });

    test('returns the shared operation response when non-mutating stubs complete', async () => {
        const requests: Array<[string, RequestInit]> = [
            [
                '/api/v1/books/inventory-book/accounts/item-account/calculate',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ date: '2026-09-02' }),
                },
            ],
            ['/api/v1/books/inventory-book/accounts/item-account/reset', { method: 'POST' }],
        ];

        for (const [path, init] of requests) {
            const response = await request(path, init);
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ message: '' });
        }
    });

    test('rejects missing identifiers and invalid Calculate inputs', async () => {
        const responses = await Promise.all([
            request('/api/v1/books/%20/accounts/item-account/reset', { method: 'POST' }),
            request('/api/v1/books/inventory-book/accounts/%20/reset', { method: 'POST' }),
            request('/api/v1/books/inventory-book/accounts/item-account/calculate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ date: '2026-02-30' }),
            }),
            request('/api/v1/books/inventory-book/accounts/item-account/calculate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            }),
        ]);

        expect(responses.map(response => response.status)).toEqual([400, 400, 400, 400]);
    });
});
