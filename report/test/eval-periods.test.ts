import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
    CASES,
    CATEGORIES,
    DEC,
    JAN,
    LEAP,
    MAR,
    NOV,
    caseKey,
    expectations,
} from '../scripts/eval-periods/cases';
import { listAnswer } from '../scripts/eval-periods/modes';
import {
    compareRuns,
    meaningOf,
    scoreCase,
    summarize,
    type CaseResult,
    type Meaning,
    type PeriodAnswer,
    type RunFile,
} from '../scripts/eval-periods/score';
import { buildPeriodQuery, resolveQueryDates } from '../server/src/services/period-query';

const TODAY = '2026-11-09';

function activity(answer: PeriodAnswer, today = TODAY): Meaning {
    return meaningOf(answer, today, 'activity');
}

function result(
    overrides: Partial<CaseResult> & Pick<CaseResult, 'key' | 'actual'>,
    expected: Meaning = overrides.actual
): CaseResult {
    const { against, ...score } = scoreCase([expected], overrides.actual);
    return {
        number: 1,
        prompt: overrides.key,
        language: 'en',
        category: 'named',
        today: TODAY,
        expected: against,
        score,
        judgments: {},
        ...overrides,
    };
}

describe('meaningOf', () => {
    it('reads the months a query reads, whatever the parts that wrote it', () => {
        const thisYear = activity({ request: { period: { year: 'current' } } });
        const yearToDate = activity({ request: { period: { span: 'year_to_date' } } });
        const written = activity({ request: { period: { year: 2026 } } });
        expect(thisYear.period).toMatchObject({ first: '2026-01', last: '2026-11' });
        expect(scoreCase([thisYear], yearToDate).whole).toBe(true);
        expect(scoreCase([thisYear], written).whole).toBe(true);
    });

    it('keeps the reasons a reading has no period or no comparison', () => {
        expect(activity({ request: { period: {} } })).toEqual({ reason: 'unspecified_period' });
        expect(activity({ reason: 'unspecified_period' })).toEqual({
            reason: 'unspecified_period',
        });
        expect(activity({ request: { period: { year: 2027 } } })).toEqual({
            reason: 'future_period',
        });
        expect(
            activity({ request: { period: { year: 2016 }, compared: { year: 2018 } } })
                .comparisonError
        ).toBe('comparison_not_earlier');
    });

    it('turns parts the builder rejects into a reason', () => {
        expect(activity({ request: { period: { year: 12 } } })).toEqual({
            reason: 'invalid_parts',
        });
    });
});

describe('scoreCase', () => {
    it('compares the comparison by its months: a year earlier is the previous year for a year', () => {
        const expected = activity({ request: { period: { year: 2016 } } });
        const yearEarlier = activity({
            request: { period: { year: 2016 }, compareWith: 'year_earlier' },
        });
        expect(scoreCase([expected], yearEarlier).whole).toBe(true);
    });

    it('scores a right period with the wrong comparison as a miss of the comparison only', () => {
        const expected = activity({
            request: { period: { quarter: 3 }, compared: { quarter: 1 } },
        });
        const previous = activity({ request: { period: { quarter: 3 } } });
        const score = scoreCase([expected], previous);
        expect(score).toMatchObject({
            period: true,
            whole: false,
            parts: { span: true, year: true, quarter: true, comparison: false },
        });
        expect(score.parts.month).toBeUndefined();
    });

    it('scores the parts of a wrong month', () => {
        const expected = activity({ request: { period: { month: 12 } } });
        const sameYear = activity({ request: { period: { year: 2026, month: 12 } } });
        expect(sameYear).toEqual({ reason: 'future_period' });
        const wrongYear = activity({ request: { period: { year: 2024, month: 12 } } });
        expect(scoreCase([expected], wrongYear)).toMatchObject({
            period: false,
            parts: { span: true, year: false, month: true },
        });
        expect(scoreCase([expected], sameYear)).toMatchObject({
            period: false,
            parts: { span: false, year: false, month: false, comparison: false },
        });
    });

    it('scores the year and month of a position at the end of its period', () => {
        const position = (request: PeriodAnswer) => meaningOf(request, TODAY, 'position');
        const expected = position({ request: { period: { year: 2023, month: 12 } } });
        const year = position({ request: { period: { year: 2023 } } });
        const now = position({ request: { period: { span: 'now' } } });
        expect(scoreCase([expected], year)).toMatchObject({
            period: true,
            whole: false,
            parts: { span: false, year: true, month: true, comparison: false },
        });
        expect(scoreCase([expected], now).parts).toMatchObject({ year: false, month: false });
    });

    it('accepts any of equally right readings, scored against the closest', () => {
        const year = activity({ request: { period: { year: 2023 } } }, TODAY);
        const december = activity({ request: { period: { year: 2023, month: 12 } } });
        const expected = [year, december];
        expect(scoreCase(expected, december)).toMatchObject({ whole: true, against: december });
        const november = activity({ request: { period: { year: 2023, month: 11 } } });
        expect(scoreCase(expected, november).against).toBe(december);
    });

    it('expects the reason when no period is right', () => {
        const none = activity({ reason: 'unspecified_period' });
        expect(scoreCase([none], none)).toEqual({
            period: true,
            whole: true,
            parts: {},
            against: none,
        });
        expect(
            scoreCase([none], activity({ request: { period: { year: 'current' } } })).whole
        ).toBe(false);
    });
});

describe('summarize', () => {
    const lastMonth = activity({ request: { period: { month: 'previous' } } });
    const october = activity({ request: { period: { year: 2026, month: 10 } } });
    const lastYear = activity({ request: { period: { year: 'previous' } } });

    it('counts paraphrase groups whose members all read the same months as consistent', () => {
        const summary = summarize([
            result({ key: 'a', group: 'last-month', actual: lastMonth }),
            result({ key: 'b', group: 'last-month', actual: october }),
            result({ key: 'c', group: 'last-year', actual: lastYear, category: 'relative' }),
            result({
                key: 'd',
                group: 'last-year',
                actual: lastMonth,
                category: 'relative',
                language: 'pt',
            }),
            result({ key: 'e', group: 'alone', actual: lastYear }),
        ]);
        expect(summary.consistency).toMatchObject({ groups: 2, consistent: 1 });
        expect(summary.consistency.disagreeing.map(entry => entry.group)).toEqual(['last-year']);
        expect(summary.byCategory).toMatchObject({ relative: { total: 2 } });
        expect(summary.byLanguage).toEqual({
            en: { hits: 4, total: 4 },
            pt: { hits: 1, total: 1 },
        });
    });

    it('measures accuracy per part, latency and tokens', () => {
        const summary = summarize([
            result({ key: 'a', actual: lastMonth, latencyMs: 100, inputTokens: 10 }),
            result({ key: 'b', actual: lastYear, latencyMs: 300, inputTokens: 30 }, lastMonth),
        ]);
        expect(summary.whole).toEqual({ hits: 1, total: 2 });
        expect(summary.parts.month).toEqual({ hits: 1, total: 2 });
        expect(summary.latencyMs).toEqual({ p50: 100, p95: 300, max: 300 });
        expect(summary.inputTokens?.p50).toBe(10);
    });
});

describe('compareRuns', () => {
    it('lists requests that got better or worse', () => {
        const lastMonth = activity({ request: { period: { month: 'previous' } } });
        const lastYear = activity({ request: { period: { year: 'previous' } } });
        const run = (results: CaseResult[]): RunFile => ({
            mode: 'list',
            models: [],
            startedAt: '',
            results,
            summary: summarize(results),
        });
        const a = run([
            result({ key: 'x', actual: lastYear }, lastMonth),
            result({ key: 'y', actual: lastMonth }),
        ]);
        const b = run([
            result({ key: 'x', actual: lastMonth }),
            result({ key: 'y', actual: lastYear }, lastMonth),
        ]);
        const comparison = compareRuns(a, b);
        expect(comparison.better.map(entry => entry.key)).toEqual(['x']);
        expect(comparison.worse.map(entry => entry.key)).toEqual(['y']);
        expect(comparison.rows[0]).toEqual({
            name: 'whole',
            a: { hits: 1, total: 2 },
            b: { hits: 1, total: 2 },
        });
    });
});

describe('listAnswer', () => {
    it('reads the period id it is sure of, compared a year earlier when so judged', () => {
        expect(listAnswer({ choice: 'last_month', confidence: 0.9 }, { noul: 0.8 })).toEqual({
            request: { period: { span: 'month', month: 'previous' }, compareWith: 'year_earlier' },
        });
        expect(listAnswer({ choice: '2016-Q3', confidence: 0.9 }, { noul: 0.1 })).toEqual({
            request: { period: { span: 'quarter', year: 2016, quarter: 3 } },
        });
    });

    it('reads no period when unsure or unspecified', () => {
        const none = { reason: 'unspecified_period' };
        expect(listAnswer({ choice: '2016', confidence: 0.3 }, { noul: 0 })).toEqual(none);
        expect(listAnswer({ choice: 'unspecified', confidence: 0.9 }, { noul: 0 })).toEqual(none);
    });
});

describe('period evaluation cases', () => {
    it('build the query each category expects', () => {
        for (const test of CASES) {
            for (const request of expectations(test)) {
                const built = buildPeriodQuery(request, { today: test.today, nature: test.nature });
                const label = `${test.today} "${test.prompt}"`;
                if (test.category === 'future') {
                    expect(built, label).toEqual({ ok: false, reason: 'future_period' });
                    continue;
                }
                if (test.category === 'no_period' && !built.ok) {
                    expect(built.reason, label).toBe('unspecified_period');
                    continue;
                }
                expect(built.ok, label).toBe(true);
                if (!built.ok) {
                    continue;
                }
                expect(
                    () => resolveQueryDates(built.period.dates, test.today),
                    label
                ).not.toThrow();
                if (built.comparison) {
                    expect(
                        () => resolveQueryDates(built.comparison?.dates ?? '', test.today),
                        label
                    ).not.toThrow();
                }
                if (test.category === 'invalid_comparison') {
                    expect(built.comparisonError, label).toBeDefined();
                } else {
                    expect(built.comparisonError, label).toBeUndefined();
                }
            }
        }
    });

    it('are each asked once, and paraphrases share their meaning', () => {
        expect(new Set(CASES.map(caseKey)).size).toBe(CASES.length);
        const groups = Map.groupBy(CASES, test => test.group);
        for (const [group, members] of groups) {
            if (group === undefined) {
                continue;
            }
            expect(members.length, group).toBeGreaterThan(1);
            for (const member of members) {
                expect(
                    isDeepStrictEqual(
                        [member.today, member.nature, member.category, member.expected],
                        [
                            members[0].today,
                            members[0].nature,
                            members[0].category,
                            members[0].expected,
                        ]
                    ),
                    `${group}: "${member.prompt}"`
                ).toBe(true);
            }
        }
    });

    it('cover every category, today and language well', () => {
        expect(CASES.length).toBeGreaterThanOrEqual(300);
        const count = (key: (test: (typeof CASES)[number]) => string) =>
            Object.fromEntries(
                [...Map.groupBy(CASES, key)].map(([name, members]) => [name, members.length])
            );
        const categories = count(test => test.category);
        for (const category of CATEGORIES) {
            expect(categories[category] ?? 0, category).toBeGreaterThanOrEqual(10);
        }
        const todays = count(test => test.today);
        for (const today of [JAN, MAR, NOV, DEC]) {
            expect(todays[today] ?? 0, today).toBeGreaterThanOrEqual(10);
        }
        expect(todays[LEAP] ?? 0).toBeGreaterThanOrEqual(3);
        const languages = count(test => test.language);
        for (const language of [
            'en',
            'pt',
            'es',
            'fr',
            'de',
            'it',
            'ja',
            'zh-CN',
            'ar',
            'he',
            'hi',
        ]) {
            expect(languages[language] ?? 0, language).toBeGreaterThanOrEqual(10);
        }
        expect(Object.keys(languages).length).toBeGreaterThanOrEqual(10);
        const groups = new Set(CASES.flatMap(test => (test.group ? [test.group] : [])));
        expect(groups.size).toBeGreaterThanOrEqual(40);
    });
});
