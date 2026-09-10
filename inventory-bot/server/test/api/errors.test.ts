import { describe, expect, test } from 'bun:test';
import { apiError, getResponseErrorMessage } from '../../src/api/errors.js';

describe('API errors', () => {
    test('creates the standard API error envelope', () => {
        expect(apiError('Request failed')).toEqual({ error: { message: 'Request failed' } });
    });

    test('extracts a JSON description or message from an upstream response', async () => {
        const description = await getResponseErrorMessage(
            Response.json({ description: ' Provider unavailable ' }, { status: 502 })
        );
        const message = await getResponseErrorMessage(
            Response.json({ message: 'Invalid request' }, { status: 400 })
        );

        expect(description).toBe('Provider unavailable');
        expect(message).toBe('Invalid request');
    });

    test('uses plain text and falls back for HTML responses', async () => {
        const plainText = await getResponseErrorMessage(
            new Response('Provider unavailable', { status: 502, statusText: 'Bad Gateway' })
        );
        const html = await getResponseErrorMessage(
            new Response('<html>Error</html>', { status: 502, statusText: 'Bad Gateway' })
        );

        expect(plainText).toBe('Provider unavailable');
        expect(html).toBe('Bad Gateway');
    });
});
