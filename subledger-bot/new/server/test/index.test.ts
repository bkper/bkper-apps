import { describe, expect, test } from 'bun:test';
import app from '../src/index';

describe('Subledger Bot Worker', () => {
    test('returns the health status', async () => {
        const response = await app.request('/health');

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
    });

    test('returns the legacy no-op response without consuming auth headers', async () => {
        const response = await app.request('/events', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: 'Bearer should-not-be-read',
                'bkper-oauth-token': 'should-not-be-read',
                'bkper-agent-id': 'should-not-be-read',
            },
            body: JSON.stringify({ type: 'UNKNOWN_EVENT' }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ result: false });
    });

    test('returns not found for unknown routes without requiring static assets', async () => {
        const response = await app.request('/missing');

        expect(response.status).toBe(404);
    });
});
