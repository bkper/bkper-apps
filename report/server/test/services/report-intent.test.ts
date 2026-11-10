import { describe, expect, it } from 'vitest';
import { periodRequestOf, type PeriodParts } from 'report-shared/report-intent';
import { decodeReportState, encodeReportState } from 'report-shared/report-state';
import { RELATIVE_PERIODS } from 'report-shared/report-intent';
import {
    NET_RESULT_ROOT,
    REPORT_CHARTS,
    REPORT_VIEWS,
    ReportIntentSchema,
    reportIntentOf,
    type ReportIntent,
} from '../../src/services/report-intent';

/** The parts of a period id, as intents now hold them. */
function p(id: string): PeriodParts {
    const request = periodRequestOf(id);
    if (!request) throw new Error(`Not a period id: ${id}`);
    return request.period;
}

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
            hashtags: ['ação'],
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
        for (const chart of [
            'auto',
            'pie',
            'stacked',
            'area',
            'compare',
            'waterfall',
            'table',
            'bar',
            'line',
            'ranked-bar',
            'donut',
        ]) {
            const intent = { root: 'a', period: 'ytd', monthly: false, chart };
            expect(ReportIntentSchema.parse(intent), chart).toEqual(intent);
        }
        for (const chart of ['none', 'bars', '', 'PIE']) {
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

    it('rejects more than one hashtag, which Bkper would ignore in balances', () => {
        const result = ReportIntentSchema.safeParse({
            root: 'a',
            period: 'ytd',
            monthly: false,
            hashtags: ['travel', 'viagem_2026'],
        });
        expect(result.success).toBe(false);
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

describe('ReportIntentSchema periods as parts', () => {
    it('accepts a period and the period compared with as parts', () => {
        for (const intent of [
            // Revenue last year vs 2023.
            {
                root: 'a',
                period: { span: 'year', year: 'previous' },
                compared: { year: 2023 },
                monthly: false,
            },
            // Q3 vs Q1.
            { root: 'a', period: { quarter: 3 }, compared: { quarter: 1 }, monthly: false },
            { root: 'a', period: { span: 'month', month: 'previous', year: 2024 }, monthly: true },
            { root: 'a', period: { span: 'now' }, compareWith: 'year_earlier', monthly: false },
            { root: 'a', period: { span: 'all_time' }, monthly: false },
        ]) {
            expect(ReportIntentSchema.parse(intent), JSON.stringify(intent)).toEqual(intent);
        }
    });

    it('rejects parts that name no period, or no valid one', () => {
        for (const period of [
            {},
            { span: 'week' },
            { year: 999 },
            { year: 3000 },
            { year: 2023.5 },
            { year: 'next' },
            { month: 0 },
            { month: 13 },
            { month: '3' },
            { quarter: 5 },
            { quarter: 'next' },
        ]) {
            expect(
                ReportIntentSchema.safeParse({ root: 'a', period, monthly: false }).success,
                JSON.stringify(period)
            ).toBe(false);
        }
        expect(
            ReportIntentSchema.safeParse({
                root: 'a',
                period: { year: 2023 },
                compared: {},
                monthly: false,
            }).success
        ).toBe(false);
    });

    it('still accepts the period ids of older intents, and reads them as parts', () => {
        const old = {
            root: 'a',
            period: 'last_quarter',
            compareWith: 'year_earlier',
            monthly: false,
        };
        expect(reportIntentOf(ReportIntentSchema.parse(old))).toEqual({
            root: 'a',
            period: { span: 'quarter', quarter: 'previous' },
            compareWith: 'year_earlier',
            monthly: false,
        });
        expect(
            reportIntentOf(ReportIntentSchema.parse({ ...old, period: '2017-Q2' })).period
        ).toEqual({ span: 'quarter', year: 2017, quarter: 2 });
    });
});

describe('report state', () => {
    it('opens every intent it can write as one the API accepts, unchanged', () => {
        const intents: ReportIntent[] = [
            ...REPORT_VIEWS.map(view => ({ root: 'a', period: p('ytd'), monthly: true, view })),
            ...REPORT_CHARTS.filter(chart => chart !== 'auto').map(chart => ({
                root: NET_RESULT_ROOT,
                period: p('2017-Q2'),
                monthly: false,
                chart,
            })),
            ...RELATIVE_PERIODS.map(period => ({
                root: '191002',
                period: p(period),
                monthly: false,
            })),
            { root: 'a', period: p('2019-03'), monthly: false, hashtags: ['ação'] },
            {
                root: 'a',
                period: { span: 'year', year: 'previous' },
                compared: { year: 2023 },
                monthly: false,
            },
            { root: 'a', period: { quarter: 3 }, compared: { quarter: 1 }, monthly: true },
        ];
        for (const intent of intents) {
            const state = encodeReportState({ intent, language: 'ja' });
            const opened = decodeReportState(state ?? '');
            expect(opened?.intent, JSON.stringify(intent)).toEqual(intent);
            expect(ReportIntentSchema.parse(opened?.intent)).toEqual(intent);
        }
    });
});
