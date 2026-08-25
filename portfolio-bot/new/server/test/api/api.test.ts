import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createApp } from '../../src/index.js';
import { CalculateService } from '../../src/api/services/calculate-service.js';
import { ForwardService } from '../../src/api/services/forward-service.js';
import { ResetService } from '../../src/api/services/reset-service.js';

const env = {
    ASSETS: { fetch: async () => new Response('asset') },
};

const originalListAccountsPendingCalculation = CalculateService.listAccountsPendingCalculation;
const originalCalculate = CalculateService.calculate;
const originalReset = ResetService.reset;
const originalFullReset = ResetService.fullReset;
const originalForward = ForwardService.forward;

async function request(path: string, init?: RequestInit): Promise<Response> {
    return createApp().request(path, init, env);
}

afterEach(() => {
    CalculateService.listAccountsPendingCalculation = originalListAccountsPendingCalculation;
    CalculateService.calculate = originalCalculate;
    ResetService.reset = originalReset;
    ResetService.fullReset = originalFullReset;
    ForwardService.forward = originalForward;
});

describe('typed Portfolio Bot API', () => {
    test('lists pending-calculation Account ids', async () => {
        CalculateService.listAccountsPendingCalculation = mock(async (_context, bookId) => {
            expect(bookId).toBe('portfolio-book');
            return ['instrument-account'];
        });

        const response = await request('/api/v1/books/portfolio-book/accounts/pending-calculation');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ids: ['instrument-account'] });
    });

    test('passes Calculate inputs to the service and returns no content', async () => {
        CalculateService.calculate = mock(async (_context, bookId, accountId, calculateRequest) => {
            expect(bookId).toBe('portfolio-book');
            expect(accountId).toBe('instrument-account');
            expect(calculateRequest).toEqual({
                date: '2026-08-05',
                performMtm: true,
            });
        });

        const response = await request(
            '/api/v1/books/portfolio-book/accounts/instrument-account/calculate',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ date: '2026-08-05', performMtm: true }),
            }
        );

        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
    });

    test('returns no content when mutation stubs complete', async () => {
        CalculateService.calculate = mock(async () => undefined);
        ResetService.reset = mock(async () => undefined);
        ResetService.fullReset = mock(async () => undefined);
        ForwardService.forward = mock(async () => undefined);

        const requests: Array<[string, RequestInit]> = [
            [
                '/api/v1/books/portfolio-book/accounts/instrument-account/calculate',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ date: '2026-08-05', performMtm: false }),
                },
            ],
            ['/api/v1/books/portfolio-book/accounts/instrument-account/reset', { method: 'POST' }],
            [
                '/api/v1/books/portfolio-book/accounts/instrument-account/full-reset',
                { method: 'POST' },
            ],
            [
                '/api/v1/books/portfolio-book/accounts/instrument-account/forward',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ date: '2026-09-01' }),
                },
            ],
        ];

        for (const [path, init] of requests) {
            const response = await request(path, init);
            expect(response.status).toBe(204);
            expect(await response.text()).toBe('');
        }
    });

    test('rejects missing identifiers and invalid operation inputs', async () => {
        const responses = await Promise.all([
            request('/api/v1/books/%20/accounts/pending-calculation'),
            request('/api/v1/books/portfolio-book/accounts/%20/reset', { method: 'POST' }),
            request('/api/v1/books/portfolio-book/accounts/instrument-account/calculate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ date: '2026-02-30', performMtm: true }),
            }),
            request('/api/v1/books/portfolio-book/accounts/instrument-account/calculate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ date: '2026-08-05' }),
            }),
            request('/api/v1/books/portfolio-book/accounts/instrument-account/forward', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ date: 'not-a-date' }),
            }),
        ]);

        expect(responses.map(response => response.status)).toEqual([400, 400, 400, 400, 400]);
    });

    test('returns the standard JSON error for an unknown API route', async () => {
        const response = await request('/api/v1/missing');

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            error: { message: 'Route not found: GET /api/v1/missing' },
        });
    });
});
