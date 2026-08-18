import { describe, expect, it, mock } from 'bun:test';
import type { TemplateResult } from 'lit';
import { ExchangeUpdateResultView } from '../../../../src/components/exchange-update/result/exchange-update-result-view.js';

type SummaryRenderer = (this: ExchangeUpdateResultView) => TemplateResult;
type ResultOpener = (this: ExchangeUpdateResultView) => void;
type TriggerClickHandler = (this: ExchangeUpdateResultView, event: Event) => void;

const openResult = Reflect.get(ExchangeUpdateResultView.prototype, 'openResult') as ResultOpener;
const handleTriggerClicked = Reflect.get(
    ExchangeUpdateResultView.prototype,
    'handleTriggerClicked'
) as TriggerClickHandler;
const renderSummary = Reflect.get(
    ExchangeUpdateResultView.prototype,
    'renderSummary'
) as SummaryRenderer;

describe('Exchange update result view', () => {
    it('opens the result from hover or direct activation, but not keyboard focus', () => {
        const view = new ExchangeUpdateResultView();
        const show = mock(async () => undefined);
        const stopImmediatePropagation = mock(() => undefined);
        Object.defineProperty(view, 'resultPopover', { value: { show } });

        const result = view.render();
        expect(result.values.filter(value => value === openResult)).toHaveLength(1);

        openResult.call(view);
        handleTriggerClicked.call(view, {
            stopImmediatePropagation,
        } as unknown as Event);

        expect(show).toHaveBeenCalledTimes(2);
        expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
    });

    it('renders each summary entry as a key-value row', () => {
        const view = new ExchangeUpdateResultView();
        view.summary = {
            'Cash Exchange': '47,73',
            'International Cash Account': '1.245,90',
        };

        const result = renderSummary.call(view);
        const rows = result.values[0] as TemplateResult[];

        expect(rows.map(row => [row.values[1], row.values[3]])).toEqual([
            ['Cash Exchange', '47,73'],
            ['International Cash Account', '1.245,90'],
        ]);
    });

    it('renders an empty state when the summary has no entries', () => {
        const view = new ExchangeUpdateResultView();

        const result = renderSummary.call(view);

        expect(result.strings.join('')).not.toContain('<dl');
    });
});
