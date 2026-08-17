import { describe, expect, it } from 'bun:test';
import type { TemplateResult } from 'lit';
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

describe('merge duplicates app', () => {
    it('hides its redundant branding when embedded in the Bkper sidebar', () => {
        const app = new MergeDuplicatesApp() as MergeDuplicatesApp & { embedded: boolean };
        app.embedded = true;

        const text = templateText(renderHeader.call(app));

        expect(text).not.toContain('Merge Duplicates logo');
        expect(text).toContain('Captured transaction query');
    });

    it('keeps its branding when opened standalone', () => {
        const app = new MergeDuplicatesApp() as MergeDuplicatesApp & { embedded: boolean };
        app.embedded = false;

        expect(templateText(renderHeader.call(app))).toContain('Merge Duplicates logo');
    });
});
