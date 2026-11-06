import { describe, expect, it } from 'vitest';
import { NET_RESULT_ROOT, ReportIntentSchema } from '../../src/services/report-intent';

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
