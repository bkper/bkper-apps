import { describe, expect, it, mock } from 'bun:test';
import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import { Account, Book, Group } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { ForwardDateView } from '../../../src/components/forward-date/forward-date-view.js';
import {
    AccountOperationStatus,
    PortfolioService,
    type AppError,
    type ForwardDateContext,
} from '../../../src/types.js';

const render = Reflect.get(ForwardDateView.prototype, 'render') as (
    this: ForwardDateView
) => TemplateResult;
const renderForwardConfirmationDialog = Reflect.get(
    ForwardDateView.prototype,
    'renderForwardConfirmationDialog'
) as (this: ForwardDateView) => TemplateResult;
const renderFullResetButton = Reflect.get(ForwardDateView.prototype, 'renderFullResetButton') as (
    this: ForwardDateView
) => TemplateResult;
const renderForwardButton = Reflect.get(ForwardDateView.prototype, 'renderForwardButton') as (
    this: ForwardDateView
) => TemplateResult;
const renderFullResetConfirmationDialog = Reflect.get(
    ForwardDateView.prototype,
    'renderFullResetConfirmationDialog'
) as (this: ForwardDateView) => TemplateResult;
const renderPermissionError = Reflect.get(ForwardDateView.prototype, 'renderPermissionError') as (
    this: ForwardDateView
) => TemplateResult;
const renderOperationError = Reflect.get(ForwardDateView.prototype, 'renderOperationError') as (
    this: ForwardDateView
) => TemplateResult;
const handleDateInputted = Reflect.get(ForwardDateView.prototype, 'handleDateInputted') as (
    this: ForwardDateView,
    event: Event
) => void;
const handleRunClicked = Reflect.get(ForwardDateView.prototype, 'handleRunClicked') as (
    this: ForwardDateView
) => void;
const handleForwardConfirmed = Reflect.get(ForwardDateView.prototype, 'handleForwardConfirmed') as (
    this: ForwardDateView
) => void;
const handleFullResetClicked = Reflect.get(ForwardDateView.prototype, 'handleFullResetClicked') as (
    this: ForwardDateView
) => void;
const handleFullResetConfirmed = Reflect.get(
    ForwardDateView.prototype,
    'handleFullResetConfirmed'
) as (this: ForwardDateView) => void;
const isServiceSwitcherDisabled = Reflect.get(
    ForwardDateView.prototype,
    'isServiceSwitcherDisabled'
) as (this: ForwardDateView) => boolean;
const isDateInputDisabled = Reflect.get(ForwardDateView.prototype, 'isDateInputDisabled') as (
    this: ForwardDateView
) => boolean;
const isFullResetButtonDisabled = Reflect.get(
    ForwardDateView.prototype,
    'isFullResetButtonDisabled'
) as (this: ForwardDateView) => boolean;
const isRunButtonDisabled = Reflect.get(ForwardDateView.prototype, 'isRunButtonDisabled') as (
    this: ForwardDateView
) => boolean;

function createInputEvent(value: string): Event {
    return { currentTarget: { value } as WaInput } as unknown as Event;
}

describe('Forward Date view', () => {
    it('renders its feature shell and delegates the Account scope', () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const accounts = [new Account(portfolioBook, { id: 'apple', name: 'Apple' })];
        const selectedAccount = accounts[0];
        const selectedGroup = new Group(portfolioBook, {
            id: 'technology',
            name: 'Technology',
        });
        const context: ForwardDateContext = {
            portfolioBook,
            accounts,
            selectedAccount,
            selectedGroup,
            fullResetEnabled: false,
        };
        const view = new ForwardDateView();
        view.context = context;
        view.date = '2026-03-10';
        view.results.set('apple', {
            status: AccountOperationStatus.COMPLETE,
            message: 'Forwarded',
        });

        const result = render.call(view);
        const markup = result.strings.join('');
        const forwardButton = renderForwardButton.call(view);

        expect(markup).toContain('<service-switcher');
        expect(markup).toContain('<account-list');
        expect(markup).toContain('<wa-input');
        expect(markup).toContain('type="date"');
        expect(forwardButton.values).toContain(handleRunClicked);
        expect(result.values[0]).toBe(PortfolioService.FORWARD_DATE);
        expect(result.values[1]).toBe(true);
        expect(result.values[2]).toBe(false);
        expect(result.values[3]).toBe(context.accounts);
        expect(result.values[4]).toBe(context.selectedAccount);
        expect(result.values[5]).toBe(context.selectedGroup);
        expect(result.values[6]).toBe(view.results);
        expect(result.values).toContain('2026-03-10');

        const confirmation = renderForwardConfirmationDialog.call(view);
        expect(confirmation.strings.join('')).toContain('<confirmation-dialog');
        expect(confirmation.strings.join('')).not.toContain('confirmationPhrase');
        expect(confirmation.values).toContain(handleForwardConfirmed);
    });

    it('renders and confirms Full Reset in the Forward Date view', () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const view = new ForwardDateView();
        view.context = {
            portfolioBook,
            accounts: [new Account(portfolioBook, { id: 'apple', name: 'Apple' })],
            fullResetEnabled: true,
        };
        const controller = Reflect.get(view, 'controller') as {
            runFullReset: () => Promise<void>;
        };
        const runFullReset = mock(async () => undefined);
        const showConfirmation = mock(() => undefined);
        controller.runFullReset = runFullReset;
        Object.defineProperty(view, 'fullResetConfirmationDialog', {
            value: { show: showConfirmation },
        });

        const button = renderFullResetButton.call(view);
        const confirmation = renderFullResetConfirmationDialog.call(view);
        handleFullResetClicked.call(view);
        expect(showConfirmation).toHaveBeenCalledTimes(1);
        expect(runFullReset).not.toHaveBeenCalled();
        handleFullResetConfirmed.call(view);

        expect(button.strings.join('')).toContain('variant="danger"');
        expect(button.values).toContain(handleFullResetClicked);
        expect(confirmation.strings.join('')).toContain('<confirmation-dialog');
        expect(confirmation.values).toContain('FULL RESET');
        expect(confirmation.values).toContain(handleFullResetConfirmed);
        expect(runFullReset).toHaveBeenCalledTimes(1);
    });

    it('clears stale results and confirms Forward before delegating to the controller', () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const view = new ForwardDateView();
        view.context = {
            portfolioBook,
            accounts: [new Account(portfolioBook, { id: 'apple', name: 'Apple' })],
            fullResetEnabled: false,
        };
        const controller = Reflect.get(view, 'controller') as {
            clearResults: () => void;
            runForward: () => Promise<void>;
        };
        const clearResults = mock(() => {
            view.results = new Map();
            view.operationError = undefined;
        });
        const runForward = mock(async () => undefined);
        const showConfirmation = mock(() => undefined);
        controller.clearResults = clearResults;
        controller.runForward = runForward;
        Object.defineProperty(view, 'forwardConfirmationDialog', {
            value: { show: showConfirmation },
        });

        handleDateInputted.call(view, createInputEvent('2026-04-15'));
        handleRunClicked.call(view);
        expect(showConfirmation).toHaveBeenCalledTimes(1);
        expect(runForward).not.toHaveBeenCalled();
        handleForwardConfirmed.call(view);
        const result = render.call(view);

        expect(view.date).toBe('2026-04-15');
        expect(clearResults).toHaveBeenCalledTimes(1);
        expect(runForward).toHaveBeenCalledTimes(1);

        view.executing = true;
        handleForwardConfirmed.call(view);
        expect(runForward).toHaveBeenCalledTimes(1);

        expect(result.values).toContain(handleDateInputted);
        expect(renderForwardButton.call(view).values).toContain(handleRunClicked);
    });

    it('does not render confirmation without an available date and Account scope', () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const view = new ForwardDateView();
        view.context = {
            portfolioBook,
            accounts: [new Account(portfolioBook, { id: 'apple', name: 'Apple' })],
            fullResetEnabled: false,
        };

        expect(renderForwardConfirmationDialog.call(view).strings.join('')).toBe('');

        view.date = '2026-03-10';
        view.context.accounts = [];

        expect(renderForwardConfirmationDialog.call(view).strings.join('')).toBe('');
    });

    it('blocks controls while executing or when the operation is unavailable', () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const view = new ForwardDateView();
        view.context = {
            portfolioBook,
            accounts: [new Account(portfolioBook, { id: 'apple', name: 'Apple' })],
            fullResetEnabled: false,
        };
        view.date = '2026-03-10';

        expect(isServiceSwitcherDisabled.call(view)).toBe(false);
        expect(isDateInputDisabled.call(view)).toBe(false);
        expect(isFullResetButtonDisabled.call(view)).toBe(true);
        expect(isRunButtonDisabled.call(view)).toBe(false);

        view.context.fullResetEnabled = true;
        expect(isFullResetButtonDisabled.call(view)).toBe(false);

        view.executing = true;
        handleDateInputted.call(view, createInputEvent('2026-05-20'));
        expect(view.date).toBe('2026-03-10');
        expect(isServiceSwitcherDisabled.call(view)).toBe(true);
        expect(isDateInputDisabled.call(view)).toBe(true);
        expect(isFullResetButtonDisabled.call(view)).toBe(true);
        expect(isRunButtonDisabled.call(view)).toBe(true);
        expect(render.call(view).values).toContain(true);

        view.executing = false;
        view.permissionError = {
            type: 'error',
            message: { before: 'Editor permission is required.' },
        };
        expect(isFullResetButtonDisabled.call(view)).toBe(true);
        expect(isRunButtonDisabled.call(view)).toBe(true);

        view.permissionError = undefined;
        view.context.accounts = [];
        expect(isDateInputDisabled.call(view)).toBe(true);
        expect(isFullResetButtonDisabled.call(view)).toBe(true);
        expect(isRunButtonDisabled.call(view)).toBe(true);

        handleDateInputted.call(view, createInputEvent('2026-05-20'));
        expect(view.date).toBe('2026-03-10');

        view.context.accounts = [new Account(portfolioBook, { id: 'apple' })];
        view.date = '';
        expect(isRunButtonDisabled.call(view)).toBe(true);
    });

    it('keeps service switching available when the selected context has no eligible Accounts', () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const view = new ForwardDateView();
        view.context = {
            portfolioBook,
            accounts: [],
            selectedGroup: new Group(portfolioBook, { id: 'empty-group' }),
            fullResetEnabled: false,
        };

        expect(render.call(view).values[1]).toBe(true);
    });

    it('renders the supplied permission error without hiding the Account scope', () => {
        const view = new ForwardDateView();
        const permissionError: AppError = {
            type: 'error',
            message: { before: 'Editor permission is required.' },
        };
        view.permissionError = permissionError;

        const result = render.call(view);
        const errorResult = renderPermissionError.call(view);

        expect(result.strings.join('')).toContain('<account-list');
        expect(errorResult.strings.join('')).toContain('<app-error');
        expect(errorResult.values[0]).toBe(permissionError);
    });

    it('renders an operation error in the actions area', () => {
        const view = new ForwardDateView();
        view.operationError = {
            type: 'error',
            message: { before: 'Forward Date failed.' },
        };

        const result = renderOperationError.call(view);

        expect(result.strings.join('')).toContain('<app-error');
        expect(result.values[0]).toBe(view.operationError);
    });

    it('does not render absent permission or operation errors', () => {
        const view = new ForwardDateView();

        expect(renderPermissionError.call(view).strings.join('')).toBe('');
        expect(renderOperationError.call(view).strings.join('')).toBe('');
    });
});
