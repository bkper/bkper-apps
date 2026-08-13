import { describe, expect, it, mock } from 'bun:test';
import { Book } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { ExchangeUpdateView } from '../../../src/components/exchange-update/exchange-update-view.js';
import { ExchangeUpdateStatus, type ExchangeBotBook } from '../../../src/types.js';

type DateHandler = (this: ExchangeUpdateView, event: Event) => void;
type RateChangeHandler = (this: ExchangeUpdateView, code: string, event: Event) => void;

const handleDateInputted = Reflect.get(
    ExchangeUpdateView.prototype,
    'handleDateInputted'
) as DateHandler;
const handleDateBlurred = Reflect.get(
    ExchangeUpdateView.prototype,
    'handleDateBlurred'
) as DateHandler;
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
    it('disables only Run when the caller lacks edit permission', () => {
        const view = new ExchangeUpdateView();
        view.hasPermission = false;
        view.date = '2026-08-05';
        view.exchangeRates = { base: 'USD', date: view.date, rates: { BRL: 5.25 } };

        expect(renderActions.call(view).values[1]).toBe(true);
        expect(view.render().values[1]).toBe(false);
        expect(renderRate.call(view, 'BRL', 5.25).values[2]).toBe(false);
    });

    it('disables Run until rates for the entered date are available', () => {
        const view = new ExchangeUpdateView();
        view.hasPermission = true;

        expect(renderActions.call(view).values[1]).toBe(true);

        view.date = '2026-08-06';
        view.exchangeRates = { base: 'USD', date: '2026-08-05', rates: {} };
        expect(renderActions.call(view).values[1]).toBe(true);
        expect(renderRate.call(view, 'BRL', 5.25).values[2]).toBe(true);

        view.exchangeRates = { base: 'USD', date: view.date, rates: {} };
        expect(renderActions.call(view).values[1]).toBe(false);
        expect(renderRate.call(view, 'BRL', 5.25).values[2]).toBe(false);

        view.executing = true;
        expect(renderActions.call(view).values[1]).toBe(true);
    });

    it('renders the permission error immediately above Run', () => {
        const view = new ExchangeUpdateView();
        view.permissionError = 'Editor permission is required.';

        const result = renderActions.call(view);
        const permissionError = result.values[0] as TemplateResult;

        expect(permissionError.values).toContain('Editor permission is required.');
        expect(result.strings[1]).toContain('<wa-button');
    });

    it('keeps the date editable while rates load', () => {
        const view = new ExchangeUpdateView();
        view.ratesLoading = true;

        expect(view.render().values[1]).toBe(false);
        expect(renderRate.call(view, 'BRL', 5.25).values[2]).toBe(true);

        view.executing = true;
        expect(view.render().values[1]).toBe(true);
        expect(renderRate.call(view, 'BRL', 5.25).values[2]).toBe(true);
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

    it('debounces date input and loads immediately when focus leaves the input', () => {
        const view = new ExchangeUpdateView();
        const controller = Reflect.get(view, 'controller') as {
            scheduleRatesLoad: () => void;
            loadRatesImmediately: () => Promise<void>;
        };
        const scheduleRatesLoad = mock(() => undefined);
        const loadRatesImmediately = mock(async () => undefined);
        controller.scheduleRatesLoad = scheduleRatesLoad;
        controller.loadRatesImmediately = loadRatesImmediately;
        const event = {
            currentTarget: { value: '2026-08-06' },
        } as unknown as Event;

        handleDateInputted.call(view, event);
        handleDateBlurred.call(view, event);

        expect(view.date).toBe('2026-08-06');
        expect(scheduleRatesLoad).toHaveBeenCalledTimes(1);
        expect(loadRatesImmediately).toHaveBeenCalledTimes(1);
        expect(view.render().strings.join('')).not.toContain('@change=');
    });

    it('continues accepting date input while rates load', () => {
        const view = new ExchangeUpdateView();
        view.ratesLoading = true;
        const controller = Reflect.get(view, 'controller') as {
            scheduleRatesLoad: () => void;
        };
        const scheduleRatesLoad = mock(() => undefined);
        controller.scheduleRatesLoad = scheduleRatesLoad;

        handleDateInputted.call(view, {
            currentTarget: { value: '2026-08-07' },
        } as unknown as Event);

        expect(view.date).toBe('2026-08-07');
        expect(scheduleRatesLoad).toHaveBeenCalledTimes(1);
    });

    it('schedules an empty date so the controller can clear the rates', () => {
        const view = new ExchangeUpdateView();
        const controller = Reflect.get(view, 'controller') as {
            scheduleRatesLoad: () => void;
        };
        const scheduleRatesLoad = mock(() => undefined);
        controller.scheduleRatesLoad = scheduleRatesLoad;

        handleDateInputted.call(view, {
            currentTarget: { value: '' },
        } as unknown as Event);

        expect(view.date).toBe('');
        expect(scheduleRatesLoad).toHaveBeenCalledTimes(1);
    });

    it('ignores date and rate changes while controls are disabled', () => {
        const view = new ExchangeUpdateView();
        view.executing = true;
        view.date = '2026-08-05';
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-05',
            rates: { ZERO: 0 },
        };

        handleDateInputted.call(view, {
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
        view.date = '2026-08-05';
        view.exchangeRates = {
            base: 'USD',
            date: view.date,
            rates: { ZERO: 0 },
        };

        handleRateChanged.call(view, 'ZERO', {
            currentTarget: { value: '1.25' },
        } as unknown as Event);

        expect(view.exchangeRates.rates.ZERO).toBe('1.25');
    });
});
