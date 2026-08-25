import { describe, expect, it } from 'bun:test';
import type { TemplateResult } from 'lit';
import { ServiceIntroView } from '../../../src/components/service-intro/service-intro-view.js';

const render = Reflect.get(ServiceIntroView.prototype, 'render') as (
    this: ServiceIntroView
) => TemplateResult;

describe('Service intro view', () => {
    it('renders the supplied heading and instructions', () => {
        const view = new ServiceIntroView();
        view.heading = 'Realized Results';
        view.instructions = 'Review the accounts below before running an operation.';

        const result = render.call(view);

        expect(result.strings.join('')).toContain('<h2>');
        expect(result.strings.join('')).toContain('<p>');
        expect(result.values[0]).toBe(view.heading);
        expect(result.values[1]).toBe(view.instructions);
    });
});
