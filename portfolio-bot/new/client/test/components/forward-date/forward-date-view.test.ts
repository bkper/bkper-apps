import { describe, expect, it } from 'bun:test';
import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import { Account, Book, Group } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { ForwardDateView } from '../../../src/components/forward-date/forward-date-view.js';
import { PortfolioService, type AppError, type ForwardDateContext } from '../../../src/types.js';

const render = Reflect.get(ForwardDateView.prototype, 'render') as (
    this: ForwardDateView
) => TemplateResult;
const renderPermissionError = Reflect.get(ForwardDateView.prototype, 'renderPermissionError') as (
    this: ForwardDateView
) => TemplateResult;
const handleDateInputted = Reflect.get(ForwardDateView.prototype, 'handleDateInputted') as (
    this: ForwardDateView,
    event: Event
) => void;
const handleRunClicked = Reflect.get(ForwardDateView.prototype, 'handleRunClicked') as (
    this: ForwardDateView
) => void;
const isServiceSwitcherDisabled = Reflect.get(
    ForwardDateView.prototype,
    'isServiceSwitcherDisabled'
) as (this: ForwardDateView) => boolean;
const isDateInputDisabled = Reflect.get(ForwardDateView.prototype, 'isDateInputDisabled') as (
    this: ForwardDateView
) => boolean;
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
        };
        const view = new ForwardDateView();
        view.context = context;
        view.date = '2026-03-10';

        const result = render.call(view);
        const markup = result.strings.join('');

        expect(markup).toContain('<service-switcher');
        expect(markup).toContain('<account-list');
        expect(markup).toContain('<wa-input');
        expect(markup).toContain('type="date"');
        expect(markup).toContain('Run');
        expect(result.values[0]).toBe(PortfolioService.FORWARD_DATE);
        expect(result.values[1]).toBe(true);
        expect(result.values[2]).toBe(false);
        expect(result.values[3]).toBe(context.accounts);
        expect(result.values[4]).toBe(context.selectedAccount);
        expect(result.values[5]).toBe(context.selectedGroup);
        expect(result.values).toContain('2026-03-10');
    });

    it('updates the date and wires the Run click boundary', () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const view = new ForwardDateView();
        view.context = {
            portfolioBook,
            accounts: [new Account(portfolioBook, { id: 'apple', name: 'Apple' })],
        };

        handleDateInputted.call(view, createInputEvent('2026-04-15'));
        const result = render.call(view);

        expect(view.date).toBe('2026-04-15');
        expect(result.values).toContain(handleDateInputted);
        expect(result.values).toContain(handleRunClicked);
    });

    it('blocks controls while executing or when the operation is unavailable', () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const view = new ForwardDateView();
        view.context = {
            portfolioBook,
            accounts: [new Account(portfolioBook, { id: 'apple', name: 'Apple' })],
        };
        view.date = '2026-03-10';

        expect(isServiceSwitcherDisabled.call(view)).toBe(false);
        expect(isDateInputDisabled.call(view)).toBe(false);
        expect(isRunButtonDisabled.call(view)).toBe(false);

        view.executing = true;
        handleDateInputted.call(view, createInputEvent('2026-05-20'));
        expect(view.date).toBe('2026-03-10');
        expect(isServiceSwitcherDisabled.call(view)).toBe(true);
        expect(isDateInputDisabled.call(view)).toBe(true);
        expect(isRunButtonDisabled.call(view)).toBe(true);
        expect(render.call(view).values).toContain(true);

        view.executing = false;
        view.permissionError = {
            type: 'error',
            message: { before: 'Editor permission is required.' },
        };
        expect(isRunButtonDisabled.call(view)).toBe(true);

        view.permissionError = undefined;
        view.context.accounts = [];
        expect(isDateInputDisabled.call(view)).toBe(true);
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

    it('does not render a permission error when none is supplied', () => {
        const result = renderPermissionError.call(new ForwardDateView());

        expect(result.strings.join('')).toBe('');
    });
});
