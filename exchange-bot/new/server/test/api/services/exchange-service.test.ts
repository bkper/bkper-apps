import { describe, expect, test } from 'bun:test';
import { Amount } from 'bkper-js';
import type { ExchangeRates } from '../../../src/api/schemas.js';
import { ExchangeService } from '../../../src/api/services/exchange-service.js';

function getThrown(handler: () => void): unknown {
    try {
        handler();
    } catch (error: unknown) {
        return error;
    }
    throw new Error('Expected handler to throw');
}

describe('legacy menu exchange service', () => {
    test('preserves rebasing and conversion of mutable exchange rates', () => {
        const rates: ExchangeRates = {
            base: 'USD',
            date: '2026-08-05',
            rates: { EUR: '0.5', BRL: '5' },
        };

        const converted = ExchangeService.convert(new Amount('100'), 'EUR', 'BRL', rates);

        expect(rates.base).toBe('EUR');
        expect(converted.rate.toString()).toBe('10');
        expect(converted.amount.toString()).toBe('1000');
    });

    test('preserves missing source and target currency failures', () => {
        const missingSource = getThrown(() =>
            ExchangeService.convert(new Amount('100'), 'XXX', 'EUR', {
                base: 'USD',
                date: '2026-08-05',
                rates: { EUR: '0.5' },
            })
        );
        const missingTarget = getThrown(() =>
            ExchangeService.convert(new Amount('100'), 'USD', 'XXX', {
                base: 'USD',
                date: '2026-08-05',
                rates: { EUR: '0.5' },
            })
        );

        expect(missingSource).toBe('Code XXX not found in rates');
        expect(String(missingTarget)).toStartWith('Code XXX not found in ');
    });
});
