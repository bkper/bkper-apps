import { describe, expect, it } from 'bun:test';
import type { TemplateResult } from 'lit';
import type { Suggestion } from '../src/api/app-api';
import { MergeDuplicatesApp } from '../src/components/merge-duplicates-app';

const renderHeader = Reflect.get(MergeDuplicatesApp.prototype, 'renderHeader') as (
    this: MergeDuplicatesApp
) => TemplateResult;

function templateText(result: TemplateResult): string {
    return [
        ...result.strings,
        ...result.values.flatMap(value =>
            value && typeof value === 'object' && 'strings' in value
                ? templateText(value as TemplateResult)
                : String(value ?? '')
        ),
    ].join('');
}

function suggestion(): Suggestion {
    const snapshot = (id: string) => ({
        id,
        date: '2026-06-10',
        amount: '10',
        description: id,
        fromAccount: { id: 'bank', name: 'Bank' },
        toAccount: { id, name: id },
        properties: {},
        draft: false,
    });
    return {
        id: 'pair',
        strength: 'Strong',
        explanation: 'Likely duplicate',
        first: snapshot('first'),
        second: snapshot('second'),
    };
}

describe('merge duplicates app', () => {
    it('hides its redundant branding when embedded in the Bkper sidebar', () => {
        const app = new MergeDuplicatesApp() as MergeDuplicatesApp & { embedded: boolean };
        app.embedded = true;
        app.controller.state.context.query = "account:'Client A'";

        const text = templateText(renderHeader.call(app));

        expect(text).not.toContain('Merge Duplicates logo');
        expect(text).toContain("account:'Client A'");
    });

    it('keeps its branding when opened standalone', () => {
        const app = new MergeDuplicatesApp() as MergeDuplicatesApp & { embedded: boolean };
        app.embedded = false;

        expect(templateText(renderHeader.call(app))).toContain('Merge Duplicates logo');
    });

    it('allows confirmation when every suggestion is rejected', () => {
        const app = new MergeDuplicatesApp();

        app.controller.showConfirmation();
        expect(app.controller.state.confirmOpen).toBe(false);

        app.controller.review.suggestions = [suggestion()];
        app.controller.showConfirmation();
        expect(app.controller.state.confirmOpen).toBe(true);
    });
});
