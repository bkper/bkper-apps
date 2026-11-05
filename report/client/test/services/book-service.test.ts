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

    it('maps bkper-js user, books and the selected Book into component-ready data', async () => {
        const bkper: BrowserBkperClient = {
            getUser: async () => ({
                getName: () => '',
                getFullName: () => 'Ada Lovelace',
            }),
            getBooks: async () => [
                { getId: () => 'book-1', getName: () => 'Main Book' },
                { getId: () => 'book-2', getName: () => undefined },
            ],
            getBook: async id => ({ getId: () => id, getName: () => 'Main Book' }),
        };

        const service = createBookService({ auth, bkper });

        await expect(service.getCurrentUser()).resolves.toEqual({
            displayName: 'Ada Lovelace',
        });
        await expect(service.listBooksDirect()).resolves.toEqual([
            { id: 'book-1', name: 'Main Book' },
            { id: 'book-2', name: 'Untitled book' },
        ]);
        await expect(service.getBook('book-1')).resolves.toEqual({
            id: 'book-1',
            name: 'Main Book',
        });
    });
});
