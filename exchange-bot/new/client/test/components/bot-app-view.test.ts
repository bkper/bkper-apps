import { describe, expect, it } from 'bun:test';
import { BotAppView } from '../../src/components/bot-app-view.js';

type RateChangeHandler = (this: BotAppView, code: string, event: Event) => void;

const handleRateChanged = Reflect.get(
    BotAppView.prototype,
    'handleRateChanged'
) as RateChangeHandler;

describe('Bot app view', () => {
    it('updates a zero exchange rate', () => {
        const view = new BotAppView();
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
