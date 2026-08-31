import { describe, expect, it, mock } from 'bun:test';
import type WaCheckbox from '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import { Account, Book, Group } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { RealizedResultsView } from '../../../src/components/realized-results/realized-results-view.js';
import {
    AccountOperationStatus,
    PortfolioService,
    type AppError,
    type RealizedResultsContext,
} from '../../../src/types.js';

const render = Reflect.get(RealizedResultsView.prototype, 'render') as (
    this: RealizedResultsView
) => TemplateResult;
const renderFullResetButton = Reflect.get(
    RealizedResultsView.prototype,
    'renderFullResetButton'
) as (this: RealizedResultsView) => TemplateResult;
const renderPermissionError = Reflect.get(
    RealizedResultsView.prototype,
    'renderPermissionError'
) as (this: RealizedResultsView) => TemplateResult;
const renderOperationError = Reflect.get(RealizedResultsView.prototype, 'renderOperationError') as (
    this: RealizedResultsView
) => TemplateResult;
const handlePerformMtmChanged = Reflect.get(
    RealizedResultsView.prototype,
    'handlePerformMtmChanged'
) as (this: RealizedResultsView, event: Event) => void;
const handleDateInputted = Reflect.get(RealizedResultsView.prototype, 'handleDateInputted') as (
    this: RealizedResultsView,
    event: Event
) => void;
const handleFullResetClicked = Reflect.get(
    RealizedResultsView.prototype,
    'handleFullResetClicked'
) as (this: RealizedResultsView) => void;
const handleFullResetConfirmed = Reflect.get(
    RealizedResultsView.prototype,
    'handleFullResetConfirmed'
) as (this: RealizedResultsView) => void;
const handleResetClicked = Reflect.get(RealizedResultsView.prototype, 'handleResetClicked') as (
    this: RealizedResultsView
) => void;
const handleCalculateClicked = Reflect.get(
    RealizedResultsView.prototype,
    'handleCalculateClicked'
) as (this: RealizedResultsView) => void;
const isServiceSwitcherDisabled = Reflect.get(
    RealizedResultsView.prototype,
    'isServiceSwitcherDisabled'
) as (this: RealizedResultsView) => boolean;
const isPerformMtmCheckboxDisabled = Reflect.get(
    RealizedResultsView.prototype,
    'isPerformMtmCheckboxDisabled'
) as (this: RealizedResultsView) => boolean;
const isDateInputDisabled = Reflect.get(RealizedResultsView.prototype, 'isDateInputDisabled') as (
    this: RealizedResultsView
) => boolean;
const isFullResetButtonDisabled = Reflect.get(
    RealizedResultsView.prototype,
    'isFullResetButtonDisabled'
) as (this: RealizedResultsView) => boolean;
const isResetButtonDisabled = Reflect.get(
    RealizedResultsView.prototype,
    'isResetButtonDisabled'
) as (this: RealizedResultsView) => boolean;
const isCalculateButtonDisabled = Reflect.get(
    RealizedResultsView.prototype,
    'isCalculateButtonDisabled'
) as (this: RealizedResultsView) => boolean;

function isTemplateResult(value: unknown): value is TemplateResult {
    return typeof value === 'object' && value !== null && 'strings' in value;
}

function getTemplateMarkup(result: TemplateResult): string {
    let markup = '';
    for (let i = 0; i < result.strings.length; i++) {
        markup += result.strings[i];
        const value = result.values[i];
        if (isTemplateResult(value)) {
            markup += getTemplateMarkup(value);
        }
    }
    return markup;
}

function getTemplateValues(result: TemplateResult): unknown[] {
    const values: unknown[] = [];
    for (const value of result.values) {
        values.push(value);
        if (isTemplateResult(value)) {
            values.push(...getTemplateValues(value));
        }
    }
    return values;
}

function createCheckboxEvent(checked: boolean): Event {
    return { currentTarget: { checked } as WaCheckbox } as unknown as Event;
}

function createInputEvent(value: string): Event {
    return { currentTarget: { value } as WaInput } as unknown as Event;
}

function createContext(): RealizedResultsContext {
    const portfolioBook = new Book({ id: 'portfolio-book', name: 'Portfolio Book' });
    return {
        portfolioBook,
        selectedGroup: new Group(portfolioBook, {
            id: 'technology',
            name: 'Technology',
        }),
        accounts: [
            new Account(portfolioBook, { id: 'alphabet', name: 'Alphabet' }),
            new Account(portfolioBook, { id: 'apple', name: 'Apple' }),
        ],
        resetEnabled: true,
        fullResetEnabled: false,
    };
}

describe('Realized results view', () => {
    it('renders the current introduction and delegates the Account scope', () => {
        const view = new RealizedResultsView();
        const context = createContext();
        context.fullResetEnabled = true;
        view.context = context;
        view.date = '2026-03-10';

        const result = render.call(view);
        const markup = getTemplateMarkup(result);
        const values = getTemplateValues(result);

        expect(markup).toContain('<service-switcher');
        expect(markup).toContain('<account-list');
        expect(markup).toContain('<wa-checkbox');
        expect(markup).toContain('Perform MTM valuations');
        expect(markup).toContain('<confirmation-dialog');
        expect(markup).toContain('<wa-input');
        expect(markup).toContain('type="date"');
        expect(markup.indexOf('<wa-input')).toBeLessThan(markup.indexOf('<wa-checkbox'));
        expect(markup.indexOf('<wa-checkbox')).toBeLessThan(
            markup.indexOf('<div class="actions">')
        );
        const fullResetButtonIndex = values.findIndex(
            value => isTemplateResult(value) && value.strings.join('').includes('Full Reset')
        );
        expect(fullResetButtonIndex).not.toBe(-1);
        expect(fullResetButtonIndex).toBeLessThan(values.indexOf(handleResetClicked));
        const fullResetButton = values[fullResetButtonIndex];
        expect(isTemplateResult(fullResetButton)).toBe(true);
        if (isTemplateResult(fullResetButton)) {
            expect(fullResetButton.strings.join('')).toContain('variant="danger"');
            expect(fullResetButton.values).toContain(handleFullResetClicked);
        }
        expect(markup).toContain('Reset');
        expect(markup).toContain('Calculate');
        expect(result.values[0]).toBe(PortfolioService.REALIZED_RESULTS);
        expect(result.values[1]).toBe(true);
        expect(result.values[2]).toBe(false);
        expect(result.values[3]).toBe(context.accounts);
        expect(result.values[4]).toBeUndefined();
        expect(result.values[5]).toBe(context.selectedGroup);
        expect(values).toContain('2026-03-10');
    });

    it('does not render Full Reset when it is unavailable', () => {
        const view = new RealizedResultsView();
        view.context = createContext();

        const result = renderFullResetButton.call(view);

        expect(result.strings.join('')).toBe('');
        expect(result.values).not.toContain(handleFullResetClicked);
    });

    it('defaults MTM valuations to false and updates them from checkbox changes', () => {
        const view = new RealizedResultsView();
        view.context = createContext();

        expect(view.performMtm).toBe(false);

        handlePerformMtmChanged.call(view, createCheckboxEvent(true));
        const result = render.call(view);
        const values = getTemplateValues(result);

        expect(view.performMtm).toBe(true);
        expect(values).toContain(true);
        expect(values).toContain(handlePerformMtmChanged);
    });

    it('clears stale results and delegates actions through the required boundaries', () => {
        const view = new RealizedResultsView();
        view.context = createContext();
        view.date = '2026-03-10';
        view.results.set('alphabet', {
            status: AccountOperationStatus.COMPLETE,
            message: 'Calculated',
        });
        view.context.fullResetEnabled = true;
        const controller = Reflect.get(view, 'controller') as {
            clearResults: () => void;
            runCalculate: () => Promise<void>;
            runReset: () => Promise<void>;
            runFullReset: () => Promise<void>;
        };
        const clearResults = mock(() => {
            view.results = new Map();
        });
        const runCalculate = mock(async () => undefined);
        const runReset = mock(async () => undefined);
        const runFullReset = mock(async () => undefined);
        const showConfirmation = mock(() => undefined);
        controller.clearResults = clearResults;
        controller.runCalculate = runCalculate;
        controller.runReset = runReset;
        controller.runFullReset = runFullReset;
        Object.defineProperty(view, 'fullResetConfirmationDialog', {
            value: { show: showConfirmation },
        });

        handleDateInputted.call(view, createInputEvent('2026-04-15'));
        handlePerformMtmChanged.call(view, createCheckboxEvent(true));
        handleFullResetClicked.call(view);
        expect(showConfirmation).toHaveBeenCalledTimes(1);
        expect(runFullReset).not.toHaveBeenCalled();
        handleFullResetConfirmed.call(view);
        handleResetClicked.call(view);
        handleCalculateClicked.call(view);
        const result = render.call(view);
        const values = getTemplateValues(result);

        expect(view.date).toBe('2026-04-15');
        expect(view.performMtm).toBe(true);
        expect(clearResults).toHaveBeenCalledTimes(2);
        expect(runFullReset).toHaveBeenCalledTimes(1);
        expect(runReset).toHaveBeenCalledTimes(1);
        expect(runCalculate).toHaveBeenCalledTimes(1);
        expect(values).toContain(handleDateInputted);
        expect(values).toContain(handleFullResetConfirmed);
        expect(values).toContain(handleResetClicked);
        expect(values).toContain(handleCalculateClicked);
    });

    it('blocks controls while executing and disables unavailable Reset', () => {
        const view = new RealizedResultsView();
        const context = createContext();
        view.context = context;
        view.date = '2026-03-10';

        expect(isServiceSwitcherDisabled.call(view)).toBe(false);
        expect(isPerformMtmCheckboxDisabled.call(view)).toBe(false);
        expect(isDateInputDisabled.call(view)).toBe(false);
        expect(isFullResetButtonDisabled.call(view)).toBe(true);
        expect(isResetButtonDisabled.call(view)).toBe(false);
        expect(isCalculateButtonDisabled.call(view)).toBe(false);

        context.fullResetEnabled = true;
        expect(isFullResetButtonDisabled.call(view)).toBe(false);

        context.resetEnabled = false;
        expect(isResetButtonDisabled.call(view)).toBe(true);
        expect(isCalculateButtonDisabled.call(view)).toBe(false);

        view.executing = true;
        handlePerformMtmChanged.call(view, createCheckboxEvent(true));
        handleDateInputted.call(view, createInputEvent('2026-05-20'));
        expect(view.performMtm).toBe(false);
        expect(view.date).toBe('2026-03-10');
        expect(isServiceSwitcherDisabled.call(view)).toBe(true);
        expect(isPerformMtmCheckboxDisabled.call(view)).toBe(true);
        expect(isDateInputDisabled.call(view)).toBe(true);
        expect(isFullResetButtonDisabled.call(view)).toBe(true);
        expect(isResetButtonDisabled.call(view)).toBe(true);
        expect(isCalculateButtonDisabled.call(view)).toBe(true);
        expect(render.call(view).values).toContain(true);
    });

    it('blocks actions without permission, Accounts, or a calculation date', () => {
        const view = new RealizedResultsView();
        view.context = createContext();
        view.date = '';

        view.context.fullResetEnabled = true;
        expect(isFullResetButtonDisabled.call(view)).toBe(false);
        expect(isResetButtonDisabled.call(view)).toBe(false);
        expect(isCalculateButtonDisabled.call(view)).toBe(true);

        view.permissionError = {
            type: 'error',
            message: { before: 'Editor permission is required.' },
        };
        expect(isFullResetButtonDisabled.call(view)).toBe(true);
        expect(isResetButtonDisabled.call(view)).toBe(true);
        expect(isCalculateButtonDisabled.call(view)).toBe(true);

        view.permissionError = undefined;
        view.context.accounts = [];
        view.date = '2026-03-10';
        expect(isPerformMtmCheckboxDisabled.call(view)).toBe(true);
        expect(isDateInputDisabled.call(view)).toBe(true);
        expect(isFullResetButtonDisabled.call(view)).toBe(true);
        expect(isResetButtonDisabled.call(view)).toBe(true);
        expect(isCalculateButtonDisabled.call(view)).toBe(true);

        handlePerformMtmChanged.call(view, createCheckboxEvent(true));
        handleDateInputted.call(view, createInputEvent('2026-05-20'));
        expect(view.performMtm).toBe(false);
        expect(view.date).toBe('2026-03-10');
    });

    it('keeps service switching available for an empty selected context', () => {
        const pendingContext = createContext();
        pendingContext.selectedGroup = undefined;
        const emptyGroupContext = createContext();
        emptyGroupContext.accounts = [];

        const pendingView = new RealizedResultsView();
        pendingView.context = pendingContext;
        const emptyGroupView = new RealizedResultsView();
        emptyGroupView.context = emptyGroupContext;

        expect(render.call(pendingView).values[1]).toBe(false);
        expect(render.call(emptyGroupView).values[1]).toBe(true);
    });

    it('renders the supplied permission error without hiding the Account scope', () => {
        const view = new RealizedResultsView();
        const permissionError: AppError = {
            type: 'error',
            message: { before: 'User needs EDITOR or OWNER permission in BRL books' },
        };
        view.context = createContext();
        view.permissionError = permissionError;

        const result = render.call(view);
        const errorResult = renderPermissionError.call(view);

        expect(result.strings.join('')).toContain('<account-list');
        expect(errorResult.strings.join('')).toContain('<app-error');
        expect(errorResult.values[0]).toBe(permissionError);
    });

    it('renders an operation error in the same actions area as permission errors', () => {
        const view = new RealizedResultsView();
        view.operationError = {
            type: 'error',
            message: { before: 'Cannot start operation: Portfolio Book has pending tasks.' },
        };

        const result = renderOperationError.call(view);

        expect(result.strings.join('')).toContain('<app-error');
        expect(result.values[0]).toBe(view.operationError);
    });

    it('does not render absent permission or operation errors', () => {
        const view = new RealizedResultsView();

        expect(renderPermissionError.call(view).strings.join('')).toBe('');
        expect(renderOperationError.call(view).strings.join('')).toBe('');
    });
});
