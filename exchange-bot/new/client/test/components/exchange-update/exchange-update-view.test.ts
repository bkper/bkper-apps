import { describe, expect, it } from 'bun:test';
import type { TemplateResult } from 'lit';
import {
    type BotAppBook,
    ExchangeUpdateView,
} from '../../../src/components/exchange-update/exchange-update-view.js';
import { ExchangeUpdateStatus } from '../../../src/components/exchange-update/exchange-update-controller.js';

type RateChangeHandler = (this: ExchangeUpdateView, code: string, event: Event) => void;

const handleRateChanged = Reflect.get(
    ExchangeUpdateView.prototype,
    'handleRateChanged'
) as RateChangeHandler;
const renderActions = Reflect.get(ExchangeUpdateView.prototype, 'renderActions') as (
    this: ExchangeUpdateView
) => TemplateResult;
const renderExchangeUpdateResult = Reflect.get(
    ExchangeUpdateView.prototype,
    'renderExchangeUpdateResult'
) as (this: ExchangeUpdateView, book: BotAppBook) => TemplateResult;

describe('Exchange update view', () => {
    it('hides Exchange Update actions when disabled', () => {
        const view = new ExchangeUpdateView();
        view.disabled = true;

        const result = renderActions.call(view);

        expect(result.values).toEqual([]);
    });

    it('disables Run until rates are available and while an update is running', () => {
        const view = new ExchangeUpdateView();
        view.disabled = false;

        expect(renderActions.call(view).values[0]).toBe(true);

        view.exchangeRates = { base: 'USD', date: '2026-08-05', rates: {} };
        expect(renderActions.call(view).values[0]).toBe(false);

        view.executing = true;
        expect(renderActions.call(view).values[0]).toBe(true);
    });

    it('renders a spinner and retry progress beside the Book being retried', () => {
        const view = new ExchangeUpdateView();
        const book: BotAppBook = {
            id: 'usd-book',
            code: 'USD',
            isBase: true,
        };
        view.results.set(book.id, {
            status: ExchangeUpdateStatus.RETRYING,
            retryCount: 1,
            retryLimit: 5,
        });

        const result = renderExchangeUpdateResult.call(view, book);

        expect(result.strings.join('')).toContain('<wa-spinner>');
        expect(result.values).toEqual([1, 5]);
    });

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
