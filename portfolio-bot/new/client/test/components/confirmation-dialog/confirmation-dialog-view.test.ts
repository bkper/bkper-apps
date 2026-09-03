import { describe, expect, it } from 'bun:test';
import type WaCheckbox from '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import type { TemplateResult } from 'lit';
import { ConfirmationDialogView } from '../../../src/components/confirmation-dialog/confirmation-dialog-view.js';

const render = Reflect.get(ConfirmationDialogView.prototype, 'render') as (
    this: ConfirmationDialogView
) => TemplateResult;
const handleConfirmationChanged = Reflect.get(
    ConfirmationDialogView.prototype,
    'handleConfirmationChanged'
) as (this: ConfirmationDialogView, event: Event) => void;
const handleActionClicked = Reflect.get(
    ConfirmationDialogView.prototype,
    'handleActionClicked'
) as (this: ConfirmationDialogView) => void;
const handleDialogAfterHide = Reflect.get(
    ConfirmationDialogView.prototype,
    'handleDialogAfterHide'
) as (this: ConfirmationDialogView) => void;

interface DialogState {
    open: boolean;
}

function attachDialog(view: ConfirmationDialogView): DialogState {
    const dialog = { open: false };
    Object.defineProperty(view, 'dialog', { value: dialog });
    return dialog;
}

function createChangeEvent(checked: boolean): Event {
    return { currentTarget: { checked } as WaCheckbox } as unknown as Event;
}

function collectTemplateStrings(result: TemplateResult): string {
    let strings = result.strings.join('');
    for (const value of result.values) {
        if (typeof value === 'string') {
            strings += value;
        } else if (typeof value === 'object' && value !== null && 'strings' in value) {
            strings += collectTemplateStrings(value as TemplateResult);
        }
    }
    return strings;
}

describe('Confirmation dialog', () => {
    it('renders and opens a standard confirmation without requiring acknowledgement', () => {
        const view = new ConfirmationDialogView();
        const dialog = attachDialog(view);
        view.show({
            headerLabel: 'Confirm operation',
            message: 'Review this operation.',
            actionLabel: 'Continue',
        });
        const result = render.call(view);
        const markup = collectTemplateStrings(result);

        expect(dialog.open).toBe(true);
        expect(markup).toContain('<wa-dialog');
        expect(markup).toContain('light-dismiss');
        expect(markup).not.toContain('<wa-checkbox');
        expect(result.values).toContain('brand');
        expect(result.values).toContain(false);
    });

    it('requires a checked acknowledgement checkbox and uses a danger action', () => {
        const view = new ConfirmationDialogView();
        attachDialog(view);
        view.show({
            headerLabel: 'Confirm Full Reset',
            message: 'This operation cannot be undone.',
            actionLabel: 'Full Reset',
            confirmationLabel: 'I understand',
        });

        const initialResult = render.call(view);
        expect(collectTemplateStrings(initialResult)).toContain('<wa-checkbox');
        expect(collectTemplateStrings(initialResult)).toContain('I understand');
        expect(initialResult.values).toContain('danger');
        expect(initialResult.values).toContain(true);

        handleConfirmationChanged.call(view, createChangeEvent(false));
        expect(render.call(view).values).toContain(true);

        handleConfirmationChanged.call(view, createChangeEvent(true));
        expect(render.call(view).values).toContain(false);
    });

    it('dispatches confirmed and hides only after its guard passes', () => {
        const view = new ConfirmationDialogView();
        const dialog = attachDialog(view);
        view.show({
            headerLabel: 'Confirm Full Reset',
            message: 'This operation cannot be undone.',
            actionLabel: 'Full Reset',
            confirmationLabel: 'I understand',
        });
        let confirmations = 0;
        view.addEventListener('confirmed', () => confirmations++);

        handleActionClicked.call(view);
        expect(confirmations).toBe(0);
        expect(dialog.open).toBe(true);

        handleConfirmationChanged.call(view, createChangeEvent(true));
        handleActionClicked.call(view);

        expect(confirmations).toBe(1);
        expect(dialog.open).toBe(false);
    });

    it('dispatches a standard confirmation only once per opening', () => {
        const view = new ConfirmationDialogView();
        attachDialog(view);
        view.show({
            headerLabel: 'Confirm operation',
            message: 'Review this operation.',
            actionLabel: 'Continue',
        });
        let confirmations = 0;
        view.addEventListener('confirmed', () => confirmations++);

        handleActionClicked.call(view);
        handleActionClicked.call(view);

        expect(confirmations).toBe(1);

        view.show({
            headerLabel: 'Confirm operation',
            message: 'Review this operation.',
            actionLabel: 'Continue',
        });
        handleActionClicked.call(view);

        expect(confirmations).toBe(2);
    });

    it('reconfigures and clears acknowledgement between openings', () => {
        const view = new ConfirmationDialogView();
        const dialog = attachDialog(view);
        view.show({
            headerLabel: 'Confirm Full Reset',
            message: 'This operation cannot be undone.',
            actionLabel: 'Full Reset',
            confirmationLabel: 'I understand',
        });
        handleConfirmationChanged.call(view, createChangeEvent(true));

        view.hide();
        expect(dialog.open).toBe(false);

        handleDialogAfterHide.call(view);
        view.show({
            headerLabel: 'Confirm Forward Date',
            message: 'Set the Forward Date?',
            actionLabel: 'Forward',
        });

        expect(dialog.open).toBe(true);
        expect(collectTemplateStrings(render.call(view))).not.toContain('<wa-checkbox');
        expect(render.call(view).values).toContain(false);
    });
});
