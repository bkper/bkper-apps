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

function collectTemplateStrings(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map(item => collectTemplateStrings(item)).join('');
    }
    if (typeof value !== 'object' || value === null) {
        return '';
    }
    const strings = Reflect.get(value, 'strings');
    const values = Reflect.get(value, 'values');
    if (!Array.isArray(strings) || !Array.isArray(values)) {
        return '';
    }
    return strings.join('') + values.map(item => collectTemplateStrings(item)).join('');
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
        const realizedResultsOptions = realizedResultsRender.values.find(Array.isArray) as
            TemplateResult[] | undefined;
        const forwardDateOptions = forwardDateRender.values.find(Array.isArray) as
            TemplateResult[] | undefined;

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

    it('does nothing when the active service is selected', () => {
        const view = new ServiceSwitcherView();
        let dispatchCount = 0;
        view.addEventListener('service-change', () => dispatchCount++);

        handleSelect.call(view, createSelectEvent(PortfolioService.REALIZED_RESULTS));

        expect(dispatchCount).toBe(0);
    });
});
