import { describe, expect, it } from 'vitest';
import { createBkperClientConfig, createBookService } from '../../src/services/book-service';
import type { BrowserBkperClient } from '../../src/services/book-service';

const auth = {
    authenticatedFetch: async () => new Response(),
    getAccessToken: () => 'token-123',
    refresh: async () => undefined,
};

describe('createBookService', () => {
    it('wires token refresh into the bkper-js client config', async () => {
        let refreshCalls = 0;
        const config = createBkperClientConfig({
            ...auth,
            refresh: async () => {
                refreshCalls += 1;
            },
        });

        await expect(config.oauthTokenProvider?.()).resolves.toBe('token-123');
        await config.requestRetryHandler?.(401, undefined, 1);
        await config.requestRetryHandler?.(401, undefined, 2);
        await config.requestRetryHandler?.(403, undefined, 1);
        await config.requestRetryHandler?.(500, undefined, 1);

        expect(refreshCalls).toBe(1);
    });

    it('maps bkper-js Books, with when each last changed, and the selected Book', async () => {
        const bkper: BrowserBkperClient = {
            getBooks: async () => [
                { getId: () => 'book-1', getName: () => 'Main Book', getLastUpdateMs: () => 20 },
                {
                    getId: () => 'book-2',
                    getName: () => undefined,
                    getLastUpdateMs: () => undefined,
                },
            ],
            getBook: async id => ({
                getId: () => id,
                getName: () => 'Main Book',
                getLastUpdateMs: () => 20,
            }),
        };

        const service = createBookService({ auth, bkper });

        await expect(service.listBooksDirect()).resolves.toEqual([
            { id: 'book-1', name: 'Main Book', lastUpdateMs: 20 },
            // A Book without a name is named by the interface, in its language.
            { id: 'book-2', name: '' },
        ]);
        await expect(service.getBook('book-1')).resolves.toEqual({
            id: 'book-1',
            name: 'Main Book',
            lastUpdateMs: 20,
        });
    });
});
