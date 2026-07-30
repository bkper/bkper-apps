import { describe, expect, test } from 'bun:test';
import app from '../src/index';

describe('Subledger Bot Worker', () => {
    test('returns the health status', async () => {
        const response = await app.request('/health');

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
    });

    test('returns not found for unknown routes without requiring static assets', async () => {
        const response = await app.request('/missing');

        expect(response.status).toBe(404);
    });
});
