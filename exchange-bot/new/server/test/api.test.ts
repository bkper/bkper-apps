import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/index.js';
import { ExchangeRatesSchema } from '../src/api/schemas.js';

const env = {
    OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
    ASSETS: { fetch: async () => new Response('asset') },
};

const validRates = {
    base: 'USD',
    date: '2026-08-05',
    rates: { EUR: 0.86, BRL: '5.42', ZERO: 0, NEGATIVE: '-1.25' },
};

async function request(path: string, init?: RequestInit): Promise<Response> {
    return createApp().request(path, init, env);
}

describe('typed menu API', () => {
    it('validates the rates request date and routable book id', async () => {
        const missingDate = await request('/api/v1/books/book-1/exchange-rates');
        const invalidDate = await request('/api/v1/books/book-1/exchange-rates?date=2026-02-30');
        const emptyBookId = await request('/api/v1/books/%20/exchange-rates?date=2026-08-05');

        expect(missingDate.status).toBe(400);
        expect(invalidDate.status).toBe(400);
        expect(emptyBookId.status).toBe(400);
    });

    it('accepts empty rates and finite Bkper amounts, including zero and negatives', () => {
        expect(ExchangeRatesSchema.safeParse({ ...validRates, rates: {} }).success).toBe(true);
        expect(
            ExchangeRatesSchema.safeParse({
                ...validRates,
                rates: { SCIENTIFIC: '1e-7', FRACTION: '.5', ZERO: 0, NEGATIVE: '-1.25' },
            }).success
        ).toBe(true);
    });

    it('rejects structurally invalid and non-numeric rates', async () => {
        expect(
            ExchangeRatesSchema.safeParse({
                ...validRates,
                rates: { EUR: Number.POSITIVE_INFINITY },
            }).success
        ).toBe(false);
        expect(
            ExchangeRatesSchema.safeParse({ ...validRates, rates: { EUR: 'not-a-number' } }).success
        ).toBe(false);

        const response = await request('/api/v1/books/book-1/exchange-update', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...validRates, rates: { EUR: 'not-a-number' } }),
        });

        expect(response.status).toBe(400);
    });

    it('returns the standard JSON error for unknown API routes', async () => {
        const response = await request('/api/v1/missing');

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            error: { message: 'Route not found: GET /api/v1/missing' },
        });
    });
});
