import { describe, expect, it } from 'vitest';
import { buildPeriodQuery } from '../../src/services/period-query';
import {
    PERIOD_QUESTION_IDS,
    PERIOD_THRESHOLDS,
    buildPeriodQuestions,
    findWrittenYears,
    readPeriod,
    type PeriodAnswers,
    type PeriodQuestionId,
} from '../../src/services/period-questions';

type Choices = Partial<Record<PeriodQuestionId, string | [string, number]>>;

/** Answers that leave every part unspecified but those given, each sure unless scored. */
function answers(choices: Choices, yearEarlier = 0): PeriodAnswers {
    const entries = PERIOD_QUESTION_IDS.map(id => {
        const given = choices[id] ?? 'unspecified';
        const [choice, confidence] = typeof given === 'string' ? [given, 0.95] : given;
        return [id, { choice, confidence }];
    });
    return {
        ...(Object.fromEntries(entries) as Record<
            PeriodQuestionId,
            { choice: string; confidence: number }
        >),
        year_earlier: { noul: yearEarlier },
    };
}

describe('findWrittenYears', () => {
    it('finds years written in every digit system, each once, in order', () => {
        expect(findWrittenYears('revenue 2024 vs 2022, again 2024')).toEqual([2024, 2022]);
        expect(findWrittenYears('مصروفات ٢٠١٦ مقابل ٢٠١٤')).toEqual([2016, 2014]);
        expect(findWrittenYears('هزینه‌های ۲۰۲۳')).toEqual([2023]);
        expect(findWrittenYears('२०१५ में खर्च')).toEqual([2015]);
        expect(findWrittenYears('２０１５年の費用')).toEqual([2015]);
        expect(findWrittenYears('expenses FY2024 and 2019年')).toEqual([2024, 2019]);
    });

    it('keeps only plausible years, never parts of longer numbers', () => {
        expect(findWrittenYears('paid 1500 for 12345 items, 2300 left, 20155')).toEqual([]);
        expect(findWrittenYears('expenses 1899 and 1900, 2199 and 2200')).toEqual([1900, 2199]);
        expect(findWrittenYears('expenses last year')).toEqual([]);
    });
});

/** Every label and description the questions offer. */
function texts(questions: ReturnType<typeof buildPeriodQuestions>): string[] {
    return Object.values(questions).flatMap(question => [
        String(question.instructions),
        ...Object.entries(question.criteria).flat(),
    ]);
}

describe('buildPeriodQuestions', () => {
    it('offers relative years and the years written in the request, for both periods', () => {
        const questions = buildPeriodQuestions('expenses ٢٠٢٣ vs 2021');
        for (const id of ['year', 'compared_year'] as const) {
            expect(Object.keys(questions[id].criteria).sort()).toEqual([
                '2021',
                '2023',
                'last_year',
                'next_year',
                'this_year',
                'unspecified',
                'year_before_last',
            ]);
        }
    });

    it('offers every month and quarter, relative ones, and unspecified', () => {
        const questions = buildPeriodQuestions('expenses');
        expect(Object.keys(questions.month.criteria)).toHaveLength(16);
        expect(Object.keys(questions.month.criteria)).toContain('next_month');
        expect(Object.keys(questions.compared_month.criteria)).toContain('last_month');
        expect(Object.keys(questions.quarter.criteria)).toEqual([
            'Q1',
            'Q2',
            'Q3',
            'Q4',
            'this_quarter',
            'last_quarter',
            'next_quarter',
            'unspecified',
        ]);
        expect(Object.keys(questions.span.criteria)).toContain('unspecified');
    });

    it('holds no date but the years written in the request', () => {
        const years = (text: string) => text.match(/\d{3,}/g) ?? [];
        expect(texts(buildPeriodQuestions('expenses last month')).flatMap(years)).toEqual([]);
        expect(
            new Set(texts(buildPeriodQuestions('expenses in 2015 vs 2014')).flatMap(years))
        ).toEqual(new Set(['2015', '2014']));
    });
});

describe('readPeriod', () => {
    it('reads the parts the model is sure of', () => {
        expect(
            readPeriod(answers({ span: 'year', year: 'last_year', compared_year: '2023' }))
        ).toMatchObject({
            request: { period: { span: 'year', year: 'previous' }, compared: { year: 2023 } },
        });
        expect(
            readPeriod(answers({ span: 'quarter', quarter: 'Q3', compared_quarter: 'Q1' })).request
        ).toEqual({ period: { span: 'quarter', quarter: 3 }, compared: { quarter: 1 } });
        expect(readPeriod(answers({ month: 'January', compared_year: '2019' })).request).toEqual({
            period: { month: 1 },
            compared: { year: 2019 },
        });
    });

    it('reads no period when the request names none, or the model is unsure of it', () => {
        expect(readPeriod(answers({})).request).toBeUndefined();
        expect(readPeriod(answers({ compared_year: 'last_year' })).request).toBeUndefined();
        const unsure = PERIOD_THRESHOLDS.span - 0.01;
        expect(readPeriod(answers({ span: ['year', unsure] })).request).toBeUndefined();
    });

    it('leaves a part it is unsure of unspecified, and traces each judgment', () => {
        const reading = readPeriod(
            answers({ span: 'month', month: 'March', year: ['2025', PERIOD_THRESHOLDS.year - 0.1] })
        );
        expect(reading.request).toEqual({ period: { span: 'month', month: 3 } });
        expect(reading.trace.year).toEqual({ answer: '2025', score: PERIOD_THRESHOLDS.year - 0.1 });
        expect(reading.trace.month).toEqual({ answer: 'March', score: 0.95, read: 3 });
    });

    it('reads a month, quarter or year with nothing saying which as no period', () => {
        for (const span of ['month', 'quarter', 'year']) {
            const reading = readPeriod(answers({ span }));
            expect(reading.request, span).toBeUndefined();
            expect(reading.trace.rules).toEqual(['span_alone']);
        }
        expect(readPeriod(answers({ span: 'year_to_date' })).request).toEqual({
            period: { span: 'year_to_date' },
        });
        expect(readPeriod(answers({ span: 'now' })).request).toEqual({ period: { span: 'now' } });
    });

    it('reads the next year, month or quarter as a period that has not started', () => {
        for (const choices of [
            { span: 'year', year: 'next_year' },
            { span: 'month', month: 'next_month' },
            { span: 'quarter', quarter: 'next_quarter' },
            { month: 'January', year: 'next_year' },
            // Compared with the next year, the two swap, and the next year has not started.
            { span: 'year', year: 'this_year', compared_year: 'next_year' },
        ] satisfies Choices[]) {
            const reading = readPeriod(answers(choices));
            expect(reading.request, JSON.stringify(choices)).toBeUndefined();
            expect(reading.reason, JSON.stringify(choices)).toBe('future_period');
        }
        const reading = readPeriod(answers({ span: 'month', month: 'next_month' }));
        expect(reading.trace.month).toEqual({ answer: 'next_month', score: 0.95, read: 'next' });
        // Unsure of it, the part is unspecified, as any other.
        const unsure = readPeriod(
            answers({ span: 'year', year: ['next_year', PERIOD_THRESHOLDS.year - 0.1] })
        );
        expect(unsure.request).toBeUndefined();
        expect(unsure.reason).toBeUndefined();
    });

    it('reads the last 12 months to now, whatever relative year is said with them', () => {
        const reading = readPeriod(answers({ span: 'last_12_months', year: 'last_year' }));
        expect(reading.request).toEqual({ period: { span: 'last_12_months' } });
        expect(reading.trace.rules).toEqual(['rolling_period']);
        expect(readPeriod(answers({ span: 'last_12_months', year: '2024' })).request).toEqual({
            period: { span: 'last_12_months', year: 2024 },
        });
    });

    it('reads compared parts equal to the period’s as no other period', () => {
        const reading = readPeriod(
            answers(
                { span: 'month', year: '2016', month: 'January', compared_month: 'January' },
                0.9
            )
        );
        expect(reading.request).toEqual({
            period: { span: 'month', year: 2016, month: 1 },
            compareWith: 'year_earlier',
        });
        expect(reading.trace.rules).toEqual(['same_as_period']);
        expect(
            readPeriod(
                answers({
                    span: 'year',
                    year: '2023',
                    month: 'December',
                    quarter: 'Q4',
                    compared_year: '2022',
                    compared_month: 'December',
                    compared_quarter: 'Q4',
                })
            ).request
        ).toEqual({
            period: { span: 'year', year: 2023, month: 12, quarter: 4 },
            compared: { year: 2022 },
        });
    });

    it('compares with the same period a year earlier only without a second period', () => {
        expect(readPeriod(answers({ month: 'this_month' }, 0.9)).request).toEqual({
            period: { month: 'current' },
            compareWith: 'year_earlier',
        });
        expect(readPeriod(answers({ year: '2016', compared_year: '2014' }, 0.9)).request).toEqual({
            period: { year: 2016 },
            compared: { year: 2014 },
        });
    });

    it('reads the previous month or quarter of a second period as the default comparison', () => {
        expect(
            readPeriod(answers({ month: 'January', year: '2016', compared_month: 'last_month' }))
                .request
        ).toEqual({ period: { month: 1, year: 2016 } });
        expect(
            readPeriod(
                answers({ quarter: 'Q3', compared_quarter: 'last_quarter', compared_year: '2016' })
            ).request
        ).toEqual({ period: { quarter: 3 }, compared: { quarter: 'previous', year: 2016 } });
    });

    it('counts last year in a second period back from the period’s written year', () => {
        expect(readPeriod(answers({ year: '2016', compared_year: 'last_year' })).request).toEqual({
            period: { year: 2016 },
            compared: { year: 2015 },
        });
        expect(
            readPeriod(answers({ year: '2016', compared_year: 'year_before_last' })).request
        ).toEqual({ period: { year: 2016 }, compared: { year: 2014 } });
        expect(
            readPeriod(answers({ month: 'this_month', compared_year: 'last_year' })).request
        ).toEqual({ period: { month: 'current' }, compared: { year: 'previous' } });
        expect(readPeriod(answers({ year: '2016', compared_year: 'this_year' })).request).toEqual({
            period: { year: 2016 },
            compared: { year: 'current' },
        });
    });

    it('reads a second period said as a quarter and a month as of the period’s kind', () => {
        expect(
            readPeriod(
                answers({
                    span: 'quarter',
                    quarter: 'Q4',
                    year: '2025',
                    compared_quarter: 'Q2',
                    compared_month: 'June',
                })
            ).request
        ).toEqual({
            period: { span: 'quarter', quarter: 4, year: 2025 },
            compared: { quarter: 2 },
        });
        expect(
            readPeriod(
                answers({
                    span: 'month',
                    month: 'this_month',
                    compared_quarter: 'Q2',
                    compared_month: 'June',
                })
            ).request
        ).toEqual({ period: { span: 'month', month: 'current' }, compared: { month: 6 } });
    });

    it('turns every combination of answers into parts the builder accepts', () => {
        const questions = buildPeriodQuestions('expenses 2015 vs 1998');
        const labels = (id: PeriodQuestionId) => Object.keys(questions[id].criteria);
        const failures: string[] = [];
        const check = (choices: Choices, yearEarlier: number) => {
            const reading = readPeriod(answers(choices, yearEarlier));
            const placed = ['year', 'month', 'quarter'].some(
                id => choices[id as PeriodQuestionId] !== 'unspecified'
            );
            const next = Object.values(choices).some(
                choice => typeof choice === 'string' && choice.startsWith('next_')
            );
            if (next) {
                if (reading.request !== undefined || reading.reason !== 'future_period') {
                    failures.push(`${JSON.stringify(choices)}: not started`);
                }
                return;
            }
            const named =
                placed || !['unspecified', 'month', 'quarter', 'year'].includes(choices.span ?? '');
            if ((reading.request !== undefined) !== named) {
                failures.push(`${JSON.stringify(choices)}: named ${named}`);
            }
            if (!reading.request) {
                return;
            }
            for (const nature of ['activity', 'position'] as const) {
                try {
                    buildPeriodQuery(reading.request, { today: '2026-11-09', nature });
                } catch (error) {
                    failures.push(`${JSON.stringify(choices)}: ${String(error)}`);
                }
            }
        };
        let count = 0;
        for (const span of labels('span')) {
            for (const year of labels('year')) {
                for (const month of labels('month')) {
                    for (const quarter of labels('quarter')) {
                        for (const yearEarlier of [0, 1]) {
                            check({ span, year, month, quarter }, yearEarlier);
                            count++;
                        }
                    }
                }
            }
        }
        for (const span of labels('span')) {
            for (const compared_year of labels('compared_year')) {
                for (const compared_month of labels('compared_month')) {
                    for (const compared_quarter of labels('compared_quarter')) {
                        check(
                            { span, year: '2015', compared_year, compared_month, compared_quarter },
                            0
                        );
                        count++;
                    }
                }
            }
        }
        expect(count).toBe(8 * 7 * 16 * 8 * 2 + 8 * 7 * 16 * 8);
        expect(failures.slice(0, 10)).toEqual([]);
    });
});
