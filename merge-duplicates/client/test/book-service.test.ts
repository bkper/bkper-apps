import { describe, expect, it } from 'bun:test';
import { createBkperClientConfig } from '../src/services/book-service';

describe('createBkperClientConfig', () => {
    it('refreshes the token only on the first authentication retry', async () => {
        let refreshCalls = 0;
        const config = createBkperClientConfig({
            authenticatedFetch: async () => new Response(),
            getAccessToken: () => 'token-123',
            refresh: async () => {
                refreshCalls += 1;
            },
        });

        await expect(config.oauthTokenProvider?.()).resolves.toBe('token-123');
        await config.requestRetryHandler?.(403, undefined, 1);
        await config.requestRetryHandler?.(403, undefined, 2);
        await config.requestRetryHandler?.(500, undefined, 1);

        expect(refreshCalls).toBe(1);
    });
});
