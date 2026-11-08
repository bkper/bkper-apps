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

describe('saved-prompt API', () => {
    const item = { id: 'a'.repeat(64), prompt: 'Expenses this year' };
    const shelf = { reports: [item], capabilities: { list: true, save: true, remove: true } };

    it('uses encoded generated routes, prompt-only JSON, no-store and abort signals', async () => {
        const requests: Request[] = [];
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async request => {
                requests.push(request);
                if (request.method === 'DELETE') return new Response(null, { status: 204 });
                return jsonResponse(request.method === 'GET' ? shelf : { report: item });
            },
        });
        const controller = new AbortController();
        const options = { signal: controller.signal };
        await expect(api.savedReports('book /1', options)).resolves.toEqual(shelf);
        await expect(api.saveReport('book /1', { prompt: item.prompt }, options)).resolves.toEqual(
            item
        );
        await expect(api.removeReport('book /1', item.id, options)).resolves.toBeUndefined();
        const url = 'https://app.example.test/api/v1/books/book%20%2F1/reports';
        expect(requests.map(request => [request.method, request.url])).toEqual([
            ['GET', url],
            ['POST', url],
            ['DELETE', `${url}/${item.id}`],
        ]);
        expect(requests[0].cache).toBe('no-store');
        expect(requests[1].headers.get('content-type')).toBe('application/json');
        await expect(requests[1].json()).resolves.toEqual({ prompt: item.prompt });
        controller.abort();
        expect(requests.every(request => request.signal.aborted)).toBe(true);
    });

    it.each(['list', 'save', 'remove'] as const)(
        'normalizes %s errors and propagates network/cancel failures',
        async operation => {
            let response = async (): Promise<Response> =>
                jsonResponse(
                    { success: false, error: { code: 'storage_error', message: 'Try again' } },
                    502
                );
            const api = createAppApi({
                baseUrl: 'https://app.example.test',
                fetch: () => response(),
            });
            const call = (signal?: AbortSignal) =>
                operation === 'list'
                    ? api.savedReports('b', { signal })
                    : operation === 'save'
                      ? api.saveReport('b', { prompt: item.prompt }, { signal })
                      : api.removeReport('b', item.id, { signal });
            await expect(call()).rejects.toMatchObject({
                name: 'AppApiError',
                status: 502,
                code: 'storage_error',
                message: 'Try again',
            });
            response = async () => jsonResponse({ nonsense: true }, 403);
            await expect(call()).rejects.toMatchObject({
                name: 'AppApiError',
                status: 403,
                code: undefined,
            });
            const network = new TypeError('Offline');
            response = async () => {
                throw network;
            };
            await expect(call()).rejects.toBe(network);
            response = async () => {
                throw new DOMException('Cancelled', 'AbortError');
            };
            await expect(call()).rejects.toMatchObject({ name: 'AbortError' });
        }
    );

    it.each(['list', 'save', 'remove'] as const)(
        'cancels the actual %s transport',
        async operation => {
            const controller = new AbortController();
            const api = createAppApi({
                baseUrl: 'https://app.example.test',
                fetch: request =>
                    new Promise((_resolve, reject) => {
                        request.signal.addEventListener('abort', () =>
                            reject(new DOMException('cancelled', 'AbortError'))
                        );
                    }),
            });
            const options = { signal: controller.signal };
            const result =
                operation === 'list'
                    ? api.savedReports('b', options)
                    : operation === 'save'
                      ? api.saveReport('b', { prompt: item.prompt }, options)
                      : api.removeReport('b', item.id, options);
            controller.abort();
            await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        }
    );

    it('does not mistake an empty non-success removal response for a 204', async () => {
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async () =>
                new Response(null, { status: 403, headers: { 'content-length': '0' } }),
        });
        await expect(api.removeReport('b', item.id)).rejects.toMatchObject({
            name: 'AppApiError',
            status: 403,
        });
    });

    it.each(['list', 'save'] as const)('rejects empty %s success payloads', async operation => {
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async () =>
                new Response(null, { status: 200, headers: { 'content-length': '0' } }),
        });
        const result =
            operation === 'list'
                ? api.savedReports('b')
                : api.saveReport('b', { prompt: item.prompt });
        await expect(result).rejects.toBeInstanceOf(AppApiError);
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

        await expect(api.suggestions('book 1', { language: 'pt' })).resolves.toEqual({
            suggestions: [{ text: 'Net result in 2011', intent }],
        });
        expect(requests[0].url).toBe(
            'https://app.example.test/api/v1/books/book%201/suggestions?language=pt'
        );
    });

    it('asks for the names of a Book with its abort signal', async () => {
        const requests: Request[] = [];
        const controller = new AbortController();
        const name = { id: 'a-1', name: 'Credit Card', kind: 'account', root: 'g-1' };
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async request => {
                requests.push(request);
                return jsonResponse({ names: [name] });
            },
        });

        await expect(api.names('book 1', { signal: controller.signal })).resolves.toEqual([name]);
        controller.abort();
        expect(requests[0].url).toBe('https://app.example.test/api/v1/books/book%201/names');
        expect(requests[0].signal.aborted).toBe(true);
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

    it('tells the problem of a Book that has no reports, with no suggestions', async () => {
        const problem = { code: 'empty_book', bookName: 'Acme', canOrganize: true } as const;
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async () => jsonResponse({ suggestions: [], problem }),
        });

        await expect(api.suggestions('book-1')).resolves.toEqual({ suggestions: [], problem });
    });

    it('keeps the problem of a Book that keeps it from the report asked for', async () => {
        const problem = {
            code: 'mixed_group',
            bookName: 'Acme',
            canOrganize: false,
            group: 'Everything',
        } as const;
        const api = createAppApi({
            baseUrl: 'https://app.example.test',
            fetch: async () =>
                jsonResponse(
                    {
                        success: false,
                        error: { code: 'mixed_group', message: 'Mixed' },
                        problem,
                    },
                    422
                ),
        });

        const error = await api.report('book-1', { prompt: 'everything' }).catch(reason => reason);

        expect(error).toBeInstanceOf(AppApiError);
        expect(error).toMatchObject({ code: 'mixed_group', status: 422, problem });
    });
});
