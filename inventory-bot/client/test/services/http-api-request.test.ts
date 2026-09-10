import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { authService } from '../../src/services/auth-service.js';
import { HttpAPIRequest } from '../../src/services/http-api-request.js';
import { HttpError } from '../../src/services/http-request.js';

class TestAPIRequest<ResponseType> extends HttpAPIRequest<ResponseType> {
    constructor() {
        super('/api/test');
    }
}

const originalFetch = globalThis.fetch;
const originalRefresh = authService.refresh;

beforeEach(() => {
    authService.accessToken = 'expired-token';
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    authService.accessToken = undefined;
    authService.refresh = originalRefresh;
});

describe('authenticated HTTP request', () => {
    it('refreshes authentication and retries a GET once after 401', async () => {
        const fetchMock = Object.assign(
            mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
                const token = new Headers(init?.headers).get('authorization');
                return token === 'Bearer refreshed-token'
                    ? Response.json({ result: 'ok' })
                    : Response.json(
                          { error: { message: 'Unauthorized' } },
                          { status: 401, statusText: 'Unauthorized' }
                      );
            }),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;
        authService.refresh = mock(async () => {
            authService.accessToken = 'refreshed-token';
        });

        const result = await new TestAPIRequest<{ result: string }>().execute();

        expect(result).toEqual({ result: 'ok' });
        expect(authService.refresh).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry a mutation after 401', async () => {
        const fetchMock = Object.assign(
            mock(async () =>
                Response.json(
                    { error: { message: 'Unauthorized' } },
                    { status: 401, statusText: 'Unauthorized' }
                )
            ),
            { preconnect: originalFetch.preconnect }
        );
        globalThis.fetch = fetchMock;
        authService.refresh = mock(async () => {
            authService.accessToken = 'refreshed-token';
        });

        const request = new TestAPIRequest<{ result: string }>()
            .setMethod('POST')
            .setPayload({ value: 'movement' });

        expect(request.execute()).rejects.toBeInstanceOf(HttpError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(authService.refresh).not.toHaveBeenCalled();
    });
});
