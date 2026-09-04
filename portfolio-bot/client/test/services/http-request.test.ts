import { afterEach, describe, expect, it, mock } from 'bun:test';
import { HttpError, HttpRequest } from '../../src/services/http-request.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('HTTP request', () => {
    it('sends headers and encoded query parameters and returns typed JSON', async () => {
        const fetchMock = Object.assign(
            mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
                Response.json({ result: 'ok' })
            ),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;

        const result = await new HttpRequest<{ result: string }>('/api/items')
            .addParam('query', 'a b')
            .addParam('page', 2)
            .setHeader('x-test', 'yes')
            .fetch();

        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe('/api/items?query=a+b&page=2');
        expect(new Headers(init?.headers).get('x-test')).toBe('yes');
        expect(init?.credentials).toBe('include');
        expect(result).toEqual({ result: 'ok' });
    });

    it('sends a typed JSON payload without credentials', async () => {
        const fetchMock = Object.assign(
            mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
                Response.json({ accepted: true })
            ),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;

        await new HttpRequest<{ accepted: boolean }>('/api/items')
            .setMethod('POST')
            .setPayload({ value: 'amount' })
            .disableCredentials()
            .fetch();

        const [, init] = fetchMock.mock.calls[0] ?? [];
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
        expect(init?.body).toBe('{"value":"amount"}');
        expect(init?.credentials).toBe('omit');
    });

    it('throws a typed HTTP error with status and response data', async () => {
        globalThis.fetch = Object.assign(
            mock(async () =>
                Response.json(
                    { error: { message: 'Invalid request' } },
                    { status: 400, statusText: 'Bad Request' }
                )
            ),
            { preconnect: originalFetch.preconnect }
        );

        try {
            await new HttpRequest('/api/items').fetch();
            throw new Error('Expected request to fail');
        } catch (error: unknown) {
            expect(error).toBeInstanceOf(HttpError);
            if (!(error instanceof HttpError)) {
                throw error;
            }
            expect(error.status).toBe(400);
            expect(error.message).toBe('Bad Request');
            expect(error.data).toEqual({ error: { message: 'Invalid request' } });
        }
    });
});
