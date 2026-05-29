import { describe, expect, test } from 'bun:test';
import app from '../src/index';

describe('inventory bot unified Worker', () => {
    test('returns health status from the server Worker', async () => {
        const response = await app.request('/health');

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
    });

    test('does not expose old event KV test endpoints', async () => {
        const response = await app.request('/events/test/kv/sample-key');

        expect(response.status).toBe(404);
    });
});
