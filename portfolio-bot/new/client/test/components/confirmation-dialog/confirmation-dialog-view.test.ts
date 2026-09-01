import { describe, expect, it } from 'bun:test';
import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type { TemplateResult } from 'lit';
import { ConfirmationDialogView } from '../../../src/components/confirmation-dialog/confirmation-dialog-view.js';

const render = Reflect.get(ConfirmationDialogView.prototype, 'render') as (
    this: ConfirmationDialogView
) => TemplateResult;
const handleConfirmationInputted = Reflect.get(
    ConfirmationDialogView.prototype,
    'handleConfirmationInputted'
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

function createInputEvent(value: string): Event {
    return { currentTarget: { value } as WaInput } as unknown as Event;
}

function collectTemplateStrings(result: TemplateResult): string {
    let strings = result.strings.join('');
    for (const value of result.values) {
        if (typeof value === 'object' && value !== null && 'strings' in value) {
            strings += collectTemplateStrings(value as TemplateResult);
        }
    }
    return strings;
}

describe('Confirmation dialog', () => {
    it('renders and opens a standard confirmation without requiring typed input', () => {
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
        expect(markup).not.toContain('<wa-input');
        expect(result.values).toContain('brand');
        expect(result.values).toContain(false);
    });

    it('requires the exact trimmed phrase and uses a danger action', () => {
        const view = new ConfirmationDialogView();
        attachDialog(view);
        view.show({
            headerLabel: 'Confirm Full Reset',
            message: 'This operation cannot be undone.',
            actionLabel: 'Full Reset',
            confirmationPhrase: 'FULL RESET',
        });

        const initialResult = render.call(view);
        expect(collectTemplateStrings(initialResult)).toContain('<wa-input');
        expect(initialResult.values).toContain('danger');
        expect(initialResult.values).toContain(true);

        handleConfirmationInputted.call(view, createInputEvent(' full reset '));
        expect(render.call(view).values).toContain(true);

        handleConfirmationInputted.call(view, createInputEvent(' FULL RESET '));
        expect(render.call(view).values).toContain(false);
    });

    it('dispatches confirmed and hides only after its guard passes', () => {
        const view = new ConfirmationDialogView();
        const dialog = attachDialog(view);
        view.show({
            headerLabel: 'Confirm Full Reset',
            message: 'This operation cannot be undone.',
            actionLabel: 'Full Reset',
            confirmationPhrase: 'FULL RESET',
        });
        let confirmations = 0;
        view.addEventListener('confirmed', () => confirmations++);

        handleActionClicked.call(view);
        expect(confirmations).toBe(0);
        expect(dialog.open).toBe(true);

        handleConfirmationInputted.call(view, createInputEvent('FULL RESET'));
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

    it('reconfigures and clears typed confirmation between openings', () => {
        const view = new ConfirmationDialogView();
        const dialog = attachDialog(view);
        view.show({
            headerLabel: 'Confirm Full Reset',
            message: 'This operation cannot be undone.',
            actionLabel: 'Full Reset',
            confirmationPhrase: 'FULL RESET',
        });
        handleConfirmationInputted.call(view, createInputEvent('FULL RESET'));

        view.hide();
        expect(dialog.open).toBe(false);

        handleDialogAfterHide.call(view);
        view.show({
            headerLabel: 'Confirm Forward Date',
            message: 'Set the Forward Date?',
            actionLabel: 'Forward',
        });

        expect(dialog.open).toBe(true);
        expect(collectTemplateStrings(render.call(view))).not.toContain('<wa-input');
        expect(render.call(view).values).toContain(false);
    });
});
