import { describe, expect, it } from 'bun:test';
import type { TemplateResult } from 'lit';
import { AppErrorView } from '../../src/components/app-error/app-error-view.js';

const render = Reflect.get(AppErrorView.prototype, 'render') as (
    this: AppErrorView
) => TemplateResult;

function isTemplateResult(value: unknown): value is TemplateResult {
    return (
        typeof value === 'object' &&
        value !== null &&
        Array.isArray(Reflect.get(value, 'strings')) &&
        Array.isArray(Reflect.get(value, 'values'))
    );
}

function collectStrings(result: TemplateResult): string {
    return (
        result.strings.join('') +
        result.values
            .filter(isTemplateResult)
            .map(value => collectStrings(value))
            .join('')
    );
}

function collectValues(result: TemplateResult): unknown[] {
    return result.values.flatMap(value =>
        isTemplateResult(value) ? collectValues(value) : [value]
    );
}

describe('App error view', () => {
    it('renders guidance around a link action', () => {
        const view = new AppErrorView();
        view.error = {
            title: "You don't have access to this Book.",
            message: {
                before: 'To continue,',
                action: {
                    label: 'Request access',
                    url: 'https://bkper.app/books/book-id/transactions',
                },
                after: 'in Bkper to continue.',
            },
        };

        const result = render.call(view);

        const strings = collectStrings(result);
        const values = collectValues(result);
        expect(strings).toContain('target="_blank"');
        expect(strings).toContain('rel="noopener noreferrer"');
        expect(strings).toContain('<h2>');
        expect(values).toContain(view.error.title);
        expect(values).toContain(view.error.message.before);
        expect(values).toContain(view.error.message.action?.label);
        expect(values).toContain(view.error.message.action?.url);
        expect(values).toContain(view.error.message.after);
    });

    it('renders an error without an action', () => {
        const view = new AppErrorView();
        view.error = {
            message: {
                before: 'The selected Book could not be loaded. Please try again.',
            },
        };

        const result = render.call(view);

        const strings = collectStrings(result);
        const values = collectValues(result);
        expect(strings).toContain('role="alert"');
        expect(values).toContain(view.error.message.before);
        expect(strings).not.toContain('<h2>');
        expect(strings).not.toContain('<a');
    });
});
