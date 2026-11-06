import { describe, expect, it } from 'vitest';
import { decodeReportState, encodeReportState } from 'report-shared/report-state';
import { RELATIVE_PERIODS } from '../../src/services/periods';
import {
    NET_RESULT_ROOT,
    REPORT_CHARTS,
    REPORT_VIEWS,
    ReportIntentSchema,
    type ReportIntent,
} from '../../src/services/report-intent';

describe('ReportIntentSchema', () => {
    it('accepts a minimal intent for a root group', () => {
        const intent = { root: 'abc123', period: 'last_quarter', monthly: false };
        expect(ReportIntentSchema.parse(intent)).toEqual(intent);
    });

    it('accepts the net result with every optional field', () => {
        const intent = {
            root: NET_RESULT_ROOT,
            period: '2026-03',
            monthly: true,
            view: 'breakdown',
            chart: 'waterfall',
            hashtags: ['travel', 'viagem_2026', 'ação'],
        };
        expect(ReportIntentSchema.parse(intent)).toEqual(intent);
    });

    it('rejects unknown periods and views', () => {
        expect(
            ReportIntentSchema.safeParse({ root: 'a', period: 'next_year', monthly: false }).success
        ).toBe(false);
        expect(
            ReportIntentSchema.safeParse({ root: 'a', period: '2026-13', monthly: false }).success
        ).toBe(false);
        expect(
            ReportIntentSchema.safeParse({ root: 'a', period: 'ytd', monthly: false, view: 'pie' })
                .success
        ).toBe(false);
    });

    it('accepts every chart a person may prefer, and only those', () => {
        for (const chart of ['auto', 'pie', 'stacked', 'area', 'compare', 'waterfall', 'table']) {
            const intent = { root: 'a', period: 'ytd', monthly: false, chart };
            expect(ReportIntentSchema.parse(intent), chart).toEqual(intent);
        }
        for (const chart of ['donut', 'bar', '', 'PIE']) {
            const intent = { root: 'a', period: 'ytd', monthly: false, chart };
            expect(ReportIntentSchema.safeParse(intent).success, chart).toBe(false);
        }
    });

    it('requires a root, a period and monthly', () => {
        expect(
            ReportIntentSchema.safeParse({ root: '', period: 'ytd', monthly: false }).success
        ).toBe(false);
        expect(ReportIntentSchema.safeParse({ root: 'a', monthly: false }).success).toBe(false);
        expect(ReportIntentSchema.safeParse({ root: 'a', period: 'ytd' }).success).toBe(false);
    });

    it('rejects hashtags that could escape the Bkper query', () => {
        for (const hashtag of ['#travel', 'two words', "it's", 'a,b', 'a.b', '']) {
            const result = ReportIntentSchema.safeParse({
                root: 'a',
                period: 'ytd',
                monthly: false,
                hashtags: [hashtag],
            });
            expect(result.success, hashtag).toBe(false);
        }
    });
});

describe('report state', () => {
    it('opens every intent it can write as one the API accepts, unchanged', () => {
        const intents: ReportIntent[] = [
            ...REPORT_VIEWS.map(view => ({ root: 'a', period: 'ytd', monthly: true, view })),
            ...REPORT_CHARTS.filter(chart => chart !== 'auto').map(chart => ({
                root: NET_RESULT_ROOT,
                period: '2017-Q2',
                monthly: false,
                chart,
            })),
            ...RELATIVE_PERIODS.map(period => ({ root: '191002', period, monthly: false })),
            { root: 'a', period: '2019-03', monthly: false, hashtags: ['trip', 'ação'] },
        ];
        for (const intent of intents) {
            const state = encodeReportState({ intent, language: 'ja' });
            const opened = decodeReportState(state ?? '');
            expect(opened?.intent, JSON.stringify(intent)).toEqual(intent);
            expect(ReportIntentSchema.parse(opened?.intent)).toEqual(intent);
        }
    });
});
