import { describe, expect, it } from 'bun:test';
import type WaDropdownItem from '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import type { WaSelectEvent } from '@awesome.me/webawesome/dist/events/events.js';
import type { TemplateResult } from 'lit';
import { ServiceSwitcherView } from '../../../src/components/service-switcher/service-switcher-view.js';
import { PortfolioService, type ServiceChangeEvent } from '../../../src/types.js';

const render = Reflect.get(ServiceSwitcherView.prototype, 'render') as (
    this: ServiceSwitcherView
) => TemplateResult;
const handleSelect = Reflect.get(ServiceSwitcherView.prototype, 'handleSelect') as (
    this: ServiceSwitcherView,
    event: WaSelectEvent
) => void;

function createSelectEvent(value: string): WaSelectEvent {
    const item = { value } as WaDropdownItem;
    return new CustomEvent('wa-select', { detail: { item } }) as WaSelectEvent;
}

function isTemplateResult(value: unknown): value is TemplateResult {
    return (
        typeof value === 'object' &&
        value !== null &&
        Array.isArray(Reflect.get(value, 'strings')) &&
        Array.isArray(Reflect.get(value, 'values'))
    );
}

function collectTemplateStrings(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map(item => collectTemplateStrings(item)).join('');
    }
    if (!isTemplateResult(value)) {
        return '';
    }
    return value.strings.join('') + value.values.map(item => collectTemplateStrings(item)).join('');
}

function findTemplateResultArray(value: unknown): TemplateResult[] | undefined {
    if (Array.isArray(value)) {
        if (value.length > 0 && value.every(isTemplateResult)) {
            return value;
        }
        for (const item of value) {
            const result = findTemplateResultArray(item);
            if (result) {
                return result;
            }
        }
    } else if (isTemplateResult(value)) {
        return findTemplateResultArray(value.values);
    }
    return undefined;
}

describe('Service switcher view', () => {
    it('renders an icon dropdown with both service options', () => {
        const result = render.call(new ServiceSwitcherView());
        const markup = collectTemplateStrings(result);

        expect(markup).toContain('<h2>');
        expect(markup).toContain('<wa-dropdown');
        expect(markup).toContain('<wa-button');
        expect(markup).toContain('<wa-icon');
        expect(markup).toMatch(/<wa-icon[^>]*label=/);
        expect(markup.match(/<wa-dropdown-item/g)).toHaveLength(2);
    });

    it('renders only the service heading when switching is unavailable', () => {
        const view = new ServiceSwitcherView();
        view.showMenu = false;

        const markup = collectTemplateStrings(render.call(view));

        expect(markup).toContain('<h2>');
        expect(markup).not.toContain('<wa-dropdown');
        expect(markup).not.toContain('<wa-button');
        expect(markup).not.toContain('<wa-icon');
    });

    it('updates the heading for the active service and retains its instructions', () => {
        const realizedResults = new ServiceSwitcherView();
        const realizedResultsRender = render.call(realizedResults);
        const forwardDate = new ServiceSwitcherView();
        forwardDate.service = PortfolioService.FORWARD_DATE;
        forwardDate.instructions = 'Forward instructions';
        const forwardDateRender = render.call(forwardDate);

        expect(realizedResultsRender.values[0]).not.toBe(forwardDateRender.values[0]);
        expect(forwardDateRender.values).toContain(forwardDate.instructions);
    });

    it('marks only the active service item for the default cursor', () => {
        const realizedResultsRender = render.call(new ServiceSwitcherView());
        const forwardDate = new ServiceSwitcherView();
        forwardDate.service = PortfolioService.FORWARD_DATE;
        const forwardDateRender = render.call(forwardDate);
        const realizedResultsOptions = findTemplateResultArray(realizedResultsRender);
        const forwardDateOptions = findTemplateResultArray(forwardDateRender);

        expect(realizedResultsOptions?.map(option => option.values[0])).toEqual(['selected', '']);
        expect(forwardDateOptions?.map(option => option.values[0])).toEqual(['', 'selected']);
    });

    it('dispatches the selected service across component boundaries', () => {
        const view = new ServiceSwitcherView();
        let receivedEvent: ServiceChangeEvent | undefined;
        view.addEventListener('service-change', event => {
            receivedEvent = event as ServiceChangeEvent;
        });

        handleSelect.call(view, createSelectEvent(PortfolioService.FORWARD_DATE));

        expect(receivedEvent?.detail).toEqual({ service: PortfolioService.FORWARD_DATE });
        expect(receivedEvent?.bubbles).toBe(true);
        expect(receivedEvent?.composed).toBe(true);
    });

    it('disables switching while an operation is executing', () => {
        const view = new ServiceSwitcherView();
        view.disabled = true;
        let dispatchCount = 0;
        view.addEventListener('service-change', () => dispatchCount++);

        const result = render.call(view);
        handleSelect.call(view, createSelectEvent(PortfolioService.FORWARD_DATE));

        const dropdown = result.values.find(isTemplateResult);
        expect(dropdown?.values).toContain(true);
        expect(dispatchCount).toBe(0);
    });

    it('does nothing when the active service is selected', () => {
        const view = new ServiceSwitcherView();
        let dispatchCount = 0;
        view.addEventListener('service-change', () => dispatchCount++);

        handleSelect.call(view, createSelectEvent(PortfolioService.REALIZED_RESULTS));

        expect(dispatchCount).toBe(0);
    });
});
