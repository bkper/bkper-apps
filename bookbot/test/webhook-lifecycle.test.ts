import { describe, expect, it, mock } from 'bun:test';
import { restoreWebhookUrlDev } from '../webhook-lifecycle.js';

describe('local webhook lifecycle', () => {
    it('restores the configured remote dev webhook on shutdown', async () => {
        const update = mock(async () => undefined);
        const setWebhookUrlDev = mock((_url: string) => ({ update }));
        const app = { setWebhookUrlDev };
        const configuredRemoteUrl = 'https://remote-dev.example/events';

        await restoreWebhookUrlDev(app, configuredRemoteUrl);

        expect(setWebhookUrlDev).toHaveBeenCalledWith(configuredRemoteUrl);
        expect(update).toHaveBeenCalledTimes(1);
    });
});
