import { afterEach, describe, expect, it } from 'bun:test';
import { Bkper } from 'bkper-js';
import { initBkperAPI } from '../src/api-init.js';
import { authService } from '../src/services/auth-service.js';

const originalRefresh = authService.refresh;

afterEach(() => {
    authService.accessToken = undefined;
    authService.refresh = originalRefresh;
});

describe('Bkper browser API initialization', () => {
    it('provides the singleton auth token and refreshes the session once after a forbidden response', async () => {
        let refreshCount = 0;
        authService.accessToken = 'access-token';
        authService.refresh = async () => {
            refreshCount++;
        };

        initBkperAPI();

        const config = new Bkper().getConfig();
        expect(await config.oauthTokenProvider?.()).toBe('access-token');

        await config.requestRetryHandler?.(403, new Error('Forbidden'), 1);
        await config.requestRetryHandler?.(403, new Error('Forbidden'), 2);
        await config.requestRetryHandler?.(500, new Error('Server error'), 1);

        expect(refreshCount).toBe(1);
    });
});
