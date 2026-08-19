import { describe, expect, test } from 'bun:test';
import { createApp } from '../../src/index.js';

const env = {
    ASSETS: { fetch: async () => new Response('asset') },
};

describe('event ingress stub', () => {
    test('returns the event error envelope when the request body is invalid', async () => {
        const originalConsoleError = console.error;
        console.error = () => undefined;

        try {
            const response = await createApp().request(
                '/events',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{',
                },
                env
            );
            const body = (await response.json()) as { error?: unknown };

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('application/json');
            expect(body.error).toBeDefined();
        } finally {
            console.error = originalConsoleError;
        }
    });
});
