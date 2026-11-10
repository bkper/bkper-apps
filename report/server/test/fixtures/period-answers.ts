import { periodRequestOf, type PeriodParts } from 'report-shared/report-intent';
import { PERIOD_QUESTION_IDS, type PeriodQuestionId } from '../../src/services/period-questions';

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

const YEARS: Record<string, string> = {
    current: 'this_year',
    previous: 'last_year',
    before_previous: 'year_before_last',
};

/**
 * The labels the period questions answer for a period id of older intents (`2026-10`,
 * `last_month`, …), as the model answers a request for it; every part `unspecified` without one.
 */
export function periodChoices(id?: string): Record<PeriodQuestionId, string> {
    const choices = Object.fromEntries(
        PERIOD_QUESTION_IDS.map(question => [question, 'unspecified'])
    ) as Record<PeriodQuestionId, string>;
    const parts: PeriodParts | undefined =
        id === undefined ? undefined : periodRequestOf(id)?.period;
    if (id !== undefined && parts === undefined) {
        throw new Error(`Not a period id: ${id}`);
    }
    const { span, year, month, quarter } = parts ?? {};
    if (span !== undefined) choices.span = span;
    if (year !== undefined) choices.year = typeof year === 'number' ? String(year) : YEARS[year];
    if (month !== undefined) {
        choices.month =
            typeof month === 'number'
                ? MONTHS[month - 1]
                : month === 'current'
                  ? 'this_month'
                  : 'last_month';
    }
    if (quarter !== undefined) {
        choices.quarter =
            typeof quarter === 'number'
                ? `Q${quarter}`
                : quarter === 'current'
                  ? 'this_quarter'
                  : 'last_quarter';
    }
    return choices;
}
