import { describe, expect, it } from 'bun:test';
import { ExchangeUpdateView } from '../../../src/components/exchange-update/exchange-update-view.js';

type RateChangeHandler = (this: ExchangeUpdateView, code: string, event: Event) => void;

const handleRateChanged = Reflect.get(
    ExchangeUpdateView.prototype,
    'handleRateChanged'
) as RateChangeHandler;

describe('Exchange update view', () => {
    it('updates a zero exchange rate', () => {
        const view = new ExchangeUpdateView();
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-05',
            rates: { ZERO: 0 },
        };

        handleRateChanged.call(view, 'ZERO', {
            currentTarget: { value: '1.25' },
        } as unknown as Event);

        expect(view.exchangeRates.rates.ZERO).toBe('1.25');
    });
});
