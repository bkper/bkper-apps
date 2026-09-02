import { describe, expect, it, mock } from 'bun:test';
import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import { Account, Book, Group } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { CostOfGoodsSoldView } from '../../../src/components/cost-of-goods-sold/cost-of-goods-sold-view.js';
import {
    AccountOperationStatus,
    type AppError,
    type CostOfGoodsSoldContext,
} from '../../../src/types.js';

const render = Reflect.get(CostOfGoodsSoldView.prototype, 'render') as (
    this: CostOfGoodsSoldView
) => TemplateResult;
const renderPermissionError = Reflect.get(
    CostOfGoodsSoldView.prototype,
    'renderPermissionError'
) as (this: CostOfGoodsSoldView) => TemplateResult;
const renderOperationError = Reflect.get(CostOfGoodsSoldView.prototype, 'renderOperationError') as (
    this: CostOfGoodsSoldView
) => TemplateResult;
const handleDateInputted = Reflect.get(CostOfGoodsSoldView.prototype, 'handleDateInputted') as (
    this: CostOfGoodsSoldView,
    event: Event
) => void;
const handleResetClicked = Reflect.get(CostOfGoodsSoldView.prototype, 'handleResetClicked') as (
    this: CostOfGoodsSoldView
) => void;
const handleCalculateClicked = Reflect.get(
    CostOfGoodsSoldView.prototype,
    'handleCalculateClicked'
) as (this: CostOfGoodsSoldView) => void;
const isDateInputDisabled = Reflect.get(CostOfGoodsSoldView.prototype, 'isDateInputDisabled') as (
    this: CostOfGoodsSoldView
) => boolean;
const isResetButtonDisabled = Reflect.get(
    CostOfGoodsSoldView.prototype,
    'isResetButtonDisabled'
) as (this: CostOfGoodsSoldView) => boolean;
const isCalculateButtonDisabled = Reflect.get(
    CostOfGoodsSoldView.prototype,
    'isCalculateButtonDisabled'
) as (this: CostOfGoodsSoldView) => boolean;

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

function createInputEvent(value: string): Event {
    return { currentTarget: { value } as WaInput } as unknown as Event;
}

function createContext(): CostOfGoodsSoldContext {
    const inventoryBook = new Book({ id: 'inventory-book', name: 'Inventory Book' });
    return {
        inventoryBook,
        selectedGroup: new Group(inventoryBook, {
            id: 'products',
            name: 'Products',
        }),
        accounts: [
            new Account(inventoryBook, { id: 'apple', name: 'Apple' }),
            new Account(inventoryBook, { id: 'banana', name: 'Banana' }),
        ],
        resetEnabled: true,
    };
}

describe('Cost of goods sold view', () => {
    it('renders the Account scope, date, and operation controls', () => {
        const view = new CostOfGoodsSoldView();
        const context = createContext();
        view.context = context;
        view.date = '2026-03-10';

        const result = render.call(view);
        const markup = getTemplateMarkup(result);
        const values = getTemplateValues(result);

        expect(markup).toContain('<account-list');
        expect(markup).toContain('<wa-input');
        expect(markup).toContain('type="date"');
        expect(markup).not.toContain('MTM');
        expect(markup).toContain('Reset');
        expect(markup).toContain('Calculate');
        expect(values).toContain(context.accounts);
        expect(values).toContain(context.selectedGroup);
        expect(values).toContain('2026-03-10');
    });

    it('clears stale results and delegates actions through the required boundaries', () => {
        const view = new CostOfGoodsSoldView();
        view.context = createContext();
        view.date = '2026-03-10';
        view.results.set('apple', {
            status: AccountOperationStatus.COMPLETE,
            message: 'Calculated',
        });
        const controller = Reflect.get(view, 'controller') as {
            clearResults: () => void;
            runCalculate: () => Promise<void>;
            runReset: () => Promise<void>;
        };
        const clearResults = mock(() => {
            view.results = new Map();
        });
        const runCalculate = mock(async () => undefined);
        const runReset = mock(async () => undefined);
        controller.clearResults = clearResults;
        controller.runCalculate = runCalculate;
        controller.runReset = runReset;

        handleDateInputted.call(view, createInputEvent('2026-04-15'));
        handleResetClicked.call(view);
        handleCalculateClicked.call(view);

        expect(view.date).toBe('2026-04-15');
        expect(clearResults).toHaveBeenCalledTimes(1);
        expect(runReset).toHaveBeenCalledTimes(1);
        expect(runCalculate).toHaveBeenCalledTimes(1);
    });

    it('blocks controls while executing and disables unavailable Reset', () => {
        const view = new CostOfGoodsSoldView();
        const context = createContext();
        view.context = context;
        view.date = '2026-03-10';

        expect(isDateInputDisabled.call(view)).toBe(false);
        expect(isResetButtonDisabled.call(view)).toBe(false);
        expect(isCalculateButtonDisabled.call(view)).toBe(false);

        context.resetEnabled = false;
        expect(isResetButtonDisabled.call(view)).toBe(true);
        expect(isCalculateButtonDisabled.call(view)).toBe(false);

        view.executing = true;
        handleDateInputted.call(view, createInputEvent('2026-05-20'));
        expect(view.date).toBe('2026-03-10');
        expect(isDateInputDisabled.call(view)).toBe(true);
        expect(isResetButtonDisabled.call(view)).toBe(true);
        expect(isCalculateButtonDisabled.call(view)).toBe(true);
    });

    it('blocks actions without permission, Accounts, or a calculation date', () => {
        const view = new CostOfGoodsSoldView();
        view.context = createContext();
        view.date = '';

        expect(isResetButtonDisabled.call(view)).toBe(false);
        expect(isCalculateButtonDisabled.call(view)).toBe(true);

        view.permissionError = {
            type: 'error',
            message: { before: 'Editor permission is required.' },
        };
        expect(isResetButtonDisabled.call(view)).toBe(true);
        expect(isCalculateButtonDisabled.call(view)).toBe(true);

        view.permissionError = undefined;
        view.context.accounts = [];
        view.date = '2026-03-10';
        expect(isDateInputDisabled.call(view)).toBe(true);
        expect(isResetButtonDisabled.call(view)).toBe(true);
        expect(isCalculateButtonDisabled.call(view)).toBe(true);
    });

    it('renders supplied permission and operation errors', () => {
        const view = new CostOfGoodsSoldView();
        const permissionError: AppError = {
            type: 'error',
            message: { before: 'EDITOR or OWNER permission is required.' },
        };
        view.context = createContext();
        view.permissionError = permissionError;
        view.operationError = {
            type: 'error',
            message: {
                before: 'Cannot start operation while the Inventory Book has pending tasks.',
            },
        };

        const result = render.call(view);
        const permissionResult = renderPermissionError.call(view);
        const operationResult = renderOperationError.call(view);

        expect(result.strings.join('')).toContain('<account-list');
        expect(permissionResult.strings.join('')).toContain('<app-error');
        expect(permissionResult.values[0]).toBe(permissionError);
        expect(operationResult.strings.join('')).toContain('<app-error');
        expect(operationResult.values[0]).toBe(view.operationError);
    });

    it('does not render absent permission or operation errors', () => {
        const view = new CostOfGoodsSoldView();

        expect(renderPermissionError.call(view).strings.join('')).toBe('');
        expect(renderOperationError.call(view).strings.join('')).toBe('');
    });
});
