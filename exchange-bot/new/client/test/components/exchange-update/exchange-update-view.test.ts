import { describe, expect, it } from 'bun:test';
import { Book } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { ExchangeUpdateView } from '../../../src/components/exchange-update/exchange-update-view.js';
import type { ExchangeBotBook } from '../../../src/types.js';
import { ExchangeUpdateStatus } from '../../../src/components/exchange-update/exchange-update-controller.js';

type DateChangeHandler = (this: ExchangeUpdateView, event: Event) => void;
type RateChangeHandler = (this: ExchangeUpdateView, code: string, event: Event) => void;

const handleDateChanged = Reflect.get(
    ExchangeUpdateView.prototype,
    'handleDateChanged'
) as DateChangeHandler;
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
) as (this: ExchangeUpdateView, book: ExchangeBotBook) => TemplateResult;
const renderRate = Reflect.get(ExchangeUpdateView.prototype, 'renderRate') as (
    this: ExchangeUpdateView,
    code: string,
    rate: number | string,
    disabled?: boolean
) => TemplateResult;

describe('Exchange update view', () => {
    it('keeps Run visible and disabled when the view is disabled', () => {
        const view = new ExchangeUpdateView();
        view.disabled = true;

        const result = renderActions.call(view);

        expect(result.values[0]).toBe(true);
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

    it('applies the shared disabled states to date and rate inputs', () => {
        const view = new ExchangeUpdateView();

        expect(view.render().values[1]).toBe(false);
        expect(renderRate.call(view, 'BRL', 5.25).values[2]).toBe(false);

        for (const state of ['disabled', 'ratesLoading', 'executing'] as const) {
            view[state] = true;
            expect(view.render().values[1]).toBe(true);
            expect(renderRate.call(view, 'BRL', 5.25).values[2]).toBe(true);
            view[state] = false;
        }

        expect(renderRate.call(view, 'USD', 1, true).values[2]).toBe(true);
    });

    it('renders a spinner and retry progress beside the Book being retried', () => {
        const view = new ExchangeUpdateView();
        const book: ExchangeBotBook = {
            book: new Book({ id: 'usd-book' }),
            excCode: 'USD',
            isBase: true,
        };
        view.results.set(book.book.getId(), {
            status: ExchangeUpdateStatus.RETRYING,
            retryCount: 1,
            retryLimit: 5,
        });

        const result = renderExchangeUpdateResult.call(view, book);

        expect(result.strings.join('')).toContain('<wa-spinner>');
        expect(result.values).toEqual([1, 5]);
    });

    it('delegates a completed summary to the result component', () => {
        const view = new ExchangeUpdateView();
        const book: ExchangeBotBook = {
            book: new Book({ id: 'usd-book' }),
            excCode: 'USD',
            isBase: true,
        };
        const summary = { 'Cash Exchange': '47,73' };
        view.results.set(book.book.getId(), {
            status: ExchangeUpdateStatus.COMPLETE,
            summary,
        });

        const result = renderExchangeUpdateResult.call(view, book);

        expect(result.strings.join('')).toContain('<exchange-update-result');
        expect(result.values).toContain(summary);
    });

    it('ignores date and rate changes while controls are disabled', () => {
        const view = new ExchangeUpdateView();
        view.disabled = true;
        view.date = '2026-08-05';
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-05',
            rates: { ZERO: 0 },
        };

        handleDateChanged.call(view, {
            currentTarget: { value: '2026-08-06' },
        } as unknown as Event);
        handleRateChanged.call(view, 'ZERO', {
            currentTarget: { value: '1.25' },
        } as unknown as Event);

        expect(view.date).toBe('2026-08-05');
        expect(view.exchangeRates.rates.ZERO).toBe(0);
    });

    it('updates a zero exchange rate while controls are enabled', () => {
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
