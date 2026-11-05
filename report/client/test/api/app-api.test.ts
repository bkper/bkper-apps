import { describe, expect, it } from 'vitest';
import { AppApiError, createAppApi } from '../../src/api/app-api';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

describe('createAppApi', () => {
    it('pings the versioned app API through the injected fetch', async () => {
        const requests: Request[] = [];
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async request => {
                requests.push(request);
                return jsonResponse({ ok: true, source: 'report' });
            },
        });

        await expect(api.ping()).resolves.toEqual({ ok: true, source: 'report' });
        expect(requests[0].url).toBe('https://app.example.test/api/v1/ping');
    });

    it('throws a normalized API error', async () => {
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async () =>
                jsonResponse(
                    {
                        success: false,
                        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
                    },
                    500
                ),
        });

        const error = await api.ping().then(
            () => undefined,
            (reason: unknown) => reason
        );

        expect(error).toBeInstanceOf(AppApiError);
        if (error instanceof AppApiError) {
            expect(error.message).toBe('An unexpected error occurred');
            expect(error.status).toBe(500);
            expect(error.code).toBe('INTERNAL_ERROR');
        }
    });
});
