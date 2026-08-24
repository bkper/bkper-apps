import { describe, expect, test } from 'bun:test';
import { Bkper } from 'bkper-js';
import { ResetService } from '../../../src/api/services/reset-service.js';
import { AppContext } from '../../../src/shared/app-context.js';

describe('Reset service operations', () => {
    test('resolves operation context before Reset and Full Reset', async () => {
        const loadError = new Error('Portfolio Book unavailable');
        const bkper = new Bkper();
        bkper.getBook = async () => {
            throw loadError;
        };
        const context = new AppContext(bkper, { ASSETS: { fetch } });

        await expect(
            ResetService.reset(context, 'portfolio-book', 'instrument-account')
        ).rejects.toBe(loadError);
        await expect(
            ResetService.fullReset(context, 'portfolio-book', 'instrument-account')
        ).rejects.toBe(loadError);
    });
});
