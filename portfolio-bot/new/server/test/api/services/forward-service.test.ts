import { describe, expect, test } from 'bun:test';
import { Bkper } from 'bkper-js';
import { ForwardService } from '../../../src/api/services/forward-service.js';
import { AppContext } from '../../../src/shared/app-context.js';

describe('Forward service operation', () => {
    test('resolves operation context before forwarding', async () => {
        const loadError = new Error('Portfolio Book unavailable');
        const bkper = new Bkper();
        bkper.getBook = async () => {
            throw loadError;
        };

        const request = ForwardService.forward(
            new AppContext(bkper, { ASSETS: { fetch } }),
            'portfolio-book',
            'instrument-account',
            { date: '2026-09-01' }
        );

        await expect(request).rejects.toBe(loadError);
    });
});
