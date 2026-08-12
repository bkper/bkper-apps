import { describe, expect, test } from 'bun:test';
import app from '../src/index';

describe('Subledger Bot Worker', () => {
    test('does not expose a standalone health endpoint', async () => {
        const response = await app.request('/health');

        expect(response.status).toBe(404);
    });

    test('returns not found for unknown routes without requiring static assets', async () => {
        const response = await app.request('/missing');

        expect(response.status).toBe(404);
    });
});
