import { describe, expect, it } from 'bun:test';
import type { TemplateResult } from 'lit';
import { ExchangeUpdateResultView } from '../../../../src/components/exchange-update/result/exchange-update-result-view.js';

type SummaryRenderer = (this: ExchangeUpdateResultView) => TemplateResult;

const renderSummary = Reflect.get(
    ExchangeUpdateResultView.prototype,
    'renderSummary'
) as SummaryRenderer;

describe('Exchange update result view', () => {
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
