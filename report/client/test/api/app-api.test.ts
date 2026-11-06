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

describe('report API', () => {
    const intent = { root: 'net-result', period: '2011', monthly: false };

    it('asks for the suggestions of a Book in a language', async () => {
        const requests: Request[] = [];
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async request => {
                requests.push(request);
                return jsonResponse({ suggestions: [{ text: 'Net result in 2011', intent }] });
            },
        });

        await expect(api.suggestions('book 1', { language: 'pt' })).resolves.toEqual([
            { text: 'Net result in 2011', intent },
        ]);
        expect(requests[0].url).toBe(
            'https://app.example.test/api/v1/books/book%201/suggestions?language=pt'
        );
    });

    it('posts a report request with its abort signal', async () => {
        const requests: Request[] = [];
        const controller = new AbortController();
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async request => {
                requests.push(request);
                return jsonResponse({
                    spec: {},
                    intent,
                    language: 'en',
                    query: 'q',
                    dataAt: 'x',
                    url: 'u',
                });
            },
        });

        await api.report('book-1', { prompt: 'net result 2011' }, { signal: controller.signal });
        controller.abort();

        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toBe('https://app.example.test/api/v1/books/book-1/report');
        await expect(requests[0].json()).resolves.toEqual({ prompt: 'net result 2011' });
        expect(requests[0].signal.aborted).toBe(true);
    });

    it('keeps the suggestions of a request that is not a report', async () => {
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async () =>
                jsonResponse(
                    {
                        success: false,
                        error: { code: 'not_a_report', message: 'Not a report' },
                        suggestions: [{ text: 'Net result in 2011', intent }],
                    },
                    422
                ),
        });

        const error = await api.report('book-1', { prompt: 'hello there' }).catch(reason => reason);

        expect(error).toBeInstanceOf(AppApiError);
        expect(error).toMatchObject({
            code: 'not_a_report',
            status: 422,
            suggestions: [{ text: 'Net result in 2011', intent }],
        });
    });
});
