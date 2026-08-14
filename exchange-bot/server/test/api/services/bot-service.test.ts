import { describe, expect, test } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
import { BotService } from '../../../src/api/services/bot-service.js';
import { AppContext } from '../../../src/shared/app-context.js';

function createService(): BotService {
    return new BotService(
        new AppContext(new Bkper(), {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

describe('legacy menu bot service', () => {
    test('preserves the legacy exchange-code alias and historical flag handling', () => {
        const book = new Book({
            properties: {
                exchange_code: 'USD',
                exc_historical: ' TrUe ',
            },
        });
        const service = createService();

        expect(service.getBaseCode(book)).toBe('USD');
        expect(service.isHistorical(book)).toBe(true);
    });
});
