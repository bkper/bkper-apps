/**
 * The period of a report request, read as small judgments: how long the period is, and which
 * year, month and quarter the request says for it and for the period it compares with. The model
 * only chooses among options that never hold a date of their own (the years it may choose are the
 * ones the request writes, found by code), so the questions never go stale; this code turns the
 * answers into the parts of `period-query.ts`, whose builder writes the Bkper query.
 *
 * Every question, criterion and threshold of the period lives here, so they can be reviewed and
 * tuned together. Each question stands alone: none refers to another, since code combines the
 * answers. Question ids are not sent to the model, so each instruction refers to the state
 * fields in backticks.
 */
import type { ChoiceQuestion, SystemOneRequest } from '@typesafe-ai/sdk';
import { UNSPECIFIED, buildIntentRequest, type IntentQuestions } from './intent-questions.js';
import {
    PERIOD_SPANS,
    type ComparedParts,
    type MonthPart,
    type PeriodParts,
    type PeriodRequest,
    type PeriodSpan,
    type QuarterPart,
    type RelativeYear,
    type YearPart,
} from './period-query.js';
import type { Snapshot } from './snapshot.js';

/** How sure the model must be before a part is used; below it, the part is unspecified. */
export const PERIOD_THRESHOLDS = {
    span: 0.5,
    year: 0.5,
    month: 0.5,
    quarter: 0.5,
    /**
     * A second period needs more: a wrong one compares with the wrong months, while none
     * compares with the previous period or the same one a year earlier.
     */
    compared_year: 0.6,
    compared_month: 0.6,
    compared_quarter: 0.6,
    /** The probability of yes from which the period is compared with the same one a year earlier. */
    year_earlier: 0.5,
} as const;

/** The years a request may write: older or later numbers are amounts, not years. */
export const WRITTEN_YEARS = { min: 1900, max: 2199 } as const;
/** The most years written in a request offered as options. */
const MAX_WRITTEN_YEARS = 12;

/** The zero of each digit system a request may write years in. */
const DIGIT_ZEROS = [
    0x30, // ASCII
    0x660, // Arabic-Indic
    0x6f0, // Extended Arabic-Indic
    0x966, // Devanagari
    0xff10, // Full-width
] as const;

/** A request with its digits, in any of {@link DIGIT_ZEROS}, written in ASCII; the same length. */
function asciiDigits(text: string): string {
    return text.replace(/[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\uff10-\uff19]/g, digit => {
        const code = digit.charCodeAt(0);
        const zero = DIGIT_ZEROS.find(start => code >= start && code <= start + 9) ?? 0x30;
        return String(code - zero);
    });
}

/**
 * The years a request writes, in order, each once: runs of exactly four digits, in any digit
 * system of {@link DIGIT_ZEROS}, from {@link WRITTEN_YEARS}.
 */
export function findWrittenYears(prompt: string): number[] {
    const years: number[] = [];
    for (const match of asciiDigits(prompt).matchAll(/(?<!\d)\d{4}(?!\d)/g)) {
        const year = Number(match[0]);
        if (year >= WRITTEN_YEARS.min && year <= WRITTEN_YEARS.max && !years.includes(year)) {
            years.push(year);
        }
    }
    return years.slice(0, MAX_WRITTEN_YEARS);
}

const SPAN_CRITERIA = {
    month: 'One calendar month, such as March, last month, this month or month over month.',
    quarter: 'One quarter of a year, such as Q3, the third quarter, last quarter or this quarter.',
    year: 'One calendar year, such as a year written in digits, last year, this year, a fiscal year or year over year.',
    year_to_date: 'From the start of this year until now: year to date, YTD, so far this year.',
    last_12_months:
        'A rolling 12 months up to now: the last 12 months, the past twelve months, LTM, TTM.',
    all_time: 'Everything ever recorded: all time, since the beginning, ever.',
    now: 'This very moment: now, today, currently, at present, the current balance.',
    [UNSPECIFIED]:
        '`request` names no time at all; words such as monthly, by month or over time say how to show the amounts, not which period.',
} as const satisfies Record<PeriodSpan | typeof UNSPECIFIED, string>;

/** The years relative to today's a request may say, by label. */
const YEAR_LABELS: Record<string, RelativeYear> = {
    this_year: 'current',
    last_year: 'previous',
    year_before_last: 'before_previous',
};

/** The months a request may say, by label. */
const MONTH_LABELS: Record<string, MonthPart> = {
    January: 1,
    February: 2,
    March: 3,
    April: 4,
    May: 5,
    June: 6,
    July: 7,
    August: 8,
    September: 9,
    October: 10,
    November: 11,
    December: 12,
    this_month: 'current',
    last_month: 'previous',
};

/** The quarters a request may say, by label. */
const QUARTER_LABELS: Record<string, QuarterPart> = {
    Q1: 1,
    Q2: 2,
    Q3: 3,
    Q4: 4,
    this_quarter: 'current',
    last_quarter: 'previous',
};

const SPAN_INSTRUCTIONS =
    'How long is the period of time `request` asks about? `today` is the current date. When `request` compares two periods, answer for the first one it names.';

const YEAR_INSTRUCTIONS =
    'Which year does `request` say for the period it asks about, in words or in digits of any script? When `request` compares two periods, answer for the first one it names.';

const MONTH_INSTRUCTIONS =
    'Which month does `request` say for the period it asks about? When `request` compares two periods, answer for the first one it names.';

const QUARTER_INSTRUCTIONS =
    'Which quarter of a year does `request` say for the period it asks about? When `request` compares two periods, answer for the first one it names.';

const COMPARED_YEAR_INSTRUCTIONS =
    'Does `request` compare with a second period, such as after vs, compared with, against or than? Which year does `request` say for that second period, in words or in digits of any script?';

const COMPARED_MONTH_INSTRUCTIONS =
    'Does `request` compare with a second period, such as after vs, compared with, against or than? Which month does `request` say for that second period?';

const COMPARED_QUARTER_INSTRUCTIONS =
    'Does `request` compare with a second period, such as after vs, compared with, against or than? Which quarter of a year does `request` say for that second period?';

const NO_YEAR = '`request` says no year for it, such as last month, March or Q3 alone.';
const NO_MONTH = '`request` says no month for it.';
const NO_QUARTER = '`request` says no quarter for it.';
const NO_COMPARED =
    '`request` compares with no second period, or says no year for it, such as the previous year, the same month or the same quarter alone.';
const NO_COMPARED_MONTH = '`request` compares with no second period, or says no month for it.';
const NO_COMPARED_QUARTER = '`request` compares with no second period, or says no quarter for it.';

type Criteria = Record<string, string>;

function yearCriteria(years: readonly number[], none: string): Criteria {
    return {
        this_year: 'This year, the current year of `today`.',
        last_year: 'Last year, the year before the current one.',
        year_before_last: 'The year before last, two years before the current one.',
        ...Object.fromEntries(years.map(year => [String(year), `The year ${year}.`])),
        [UNSPECIFIED]: none,
    };
}

function monthCriteria(none: string): Criteria {
    return {
        ...Object.fromEntries(
            Object.entries(MONTH_LABELS)
                .filter(([, month]) => typeof month === 'number')
                .map(([name]) => [name, `${name}, a month of the year.`])
        ),
        this_month: 'This month, the current month of `today`.',
        last_month: 'Last month, the month before the current one.',
        [UNSPECIFIED]: none,
    };
}

function quarterCriteria(none: string): Criteria {
    return {
        Q1: 'The first quarter: January to March.',
        Q2: 'The second quarter: April to June.',
        Q3: 'The third quarter: July to September.',
        Q4: 'The fourth quarter: October to December.',
        this_quarter: 'This quarter, the current quarter of `today`.',
        last_quarter: 'Last quarter, the quarter before the current one.',
        [UNSPECIFIED]: none,
    };
}

export type PeriodQuestions = {
    span: ChoiceQuestion<typeof SPAN_CRITERIA>;
    year: ChoiceQuestion<Criteria>;
    month: ChoiceQuestion<Criteria>;
    quarter: ChoiceQuestion<Criteria>;
    compared_year: ChoiceQuestion<Criteria>;
    compared_month: ChoiceQuestion<Criteria>;
    compared_quarter: ChoiceQuestion<Criteria>;
};

export type PeriodQuestionId = keyof PeriodQuestions;

export const PERIOD_QUESTION_IDS = [
    'span',
    'year',
    'month',
    'quarter',
    'compared_year',
    'compared_month',
    'compared_quarter',
] as const satisfies readonly PeriodQuestionId[];

/**
 * The period questions of a request, asked about the state `{ request, today }`. The years it
 * may choose are this year, last year, the year before last and the years the request writes.
 */
export function buildPeriodQuestions(prompt: string): PeriodQuestions {
    const years = findWrittenYears(prompt);
    return {
        span: { type: 'choice', instructions: SPAN_INSTRUCTIONS, criteria: SPAN_CRITERIA },
        year: {
            type: 'choice',
            instructions: YEAR_INSTRUCTIONS,
            criteria: yearCriteria(years, NO_YEAR),
        },
        month: {
            type: 'choice',
            instructions: MONTH_INSTRUCTIONS,
            criteria: monthCriteria(NO_MONTH),
        },
        quarter: {
            type: 'choice',
            instructions: QUARTER_INSTRUCTIONS,
            criteria: quarterCriteria(NO_QUARTER),
        },
        compared_year: {
            type: 'choice',
            instructions: COMPARED_YEAR_INSTRUCTIONS,
            criteria: yearCriteria(years, NO_COMPARED),
        },
        compared_month: {
            type: 'choice',
            instructions: COMPARED_MONTH_INSTRUCTIONS,
            criteria: monthCriteria(NO_COMPARED_MONTH),
        },
        compared_quarter: {
            type: 'choice',
            instructions: COMPARED_QUARTER_INSTRUCTIONS,
            criteria: quarterCriteria(NO_COMPARED_QUARTER),
        },
    };
}

interface ChoiceAnswer {
    choice: string;
    confidence: number;
}

/** The answers {@link readPeriod} needs, as the decision model returns them. */
export type PeriodAnswers = Record<PeriodQuestionId, ChoiceAnswer> & {
    year_earlier: { noul: number };
};

/** One part's judgment: the model's answer, its score, and the part read from it, if any. */
export interface PeriodPartTrace {
    answer: string;
    score: number;
    /** The value used, after its threshold; left out when the part is unspecified. */
    read?: string | number;
}

export type PeriodTrace = Record<PeriodQuestionId, PeriodPartTrace> & {
    year_earlier: { answer: boolean; score: number };
    /** The rules of {@link PERIOD_RULES} that changed the parts. */
    rules: PeriodRule[];
};

export interface PeriodReading {
    /** The parts of the period, or `undefined` when the request names none. */
    request?: PeriodRequest;
    trace: PeriodTrace;
}

function sure(answer: ChoiceAnswer, question: PeriodQuestionId): string | undefined {
    return answer.choice !== UNSPECIFIED && answer.confidence >= PERIOD_THRESHOLDS[question]
        ? answer.choice
        : undefined;
}

function spanOf(label: string | undefined): PeriodSpan | undefined {
    return PERIOD_SPANS.find(span => span === label);
}

function yearOf(label: string | undefined): YearPart | undefined {
    if (label === undefined) {
        return undefined;
    }
    if (Object.hasOwn(YEAR_LABELS, label)) {
        return YEAR_LABELS[label];
    }
    const year = Number(label);
    return /^\d{4}$/.test(label) && year >= WRITTEN_YEARS.min && year <= WRITTEN_YEARS.max
        ? year
        : undefined;
}

function monthOf(label: string | undefined): MonthPart | undefined {
    return label !== undefined && Object.hasOwn(MONTH_LABELS, label)
        ? MONTH_LABELS[label]
        : undefined;
}

function quarterOf(label: string | undefined): QuarterPart | undefined {
    return label !== undefined && Object.hasOwn(QUARTER_LABELS, label)
        ? QUARTER_LABELS[label]
        : undefined;
}

/** The rules {@link readPeriod} applies to the parts, by name, in order. */
export const PERIOD_RULES = [
    /** A month, quarter or year with nothing saying which (monthly, quarterly, annual) is no period. */
    'span_alone',
    /**
     * The last 12 months run to now: last year or this year said with them is the comparison
     * ("vs the 12 months before"), not their year.
     */
    'rolling_period',
    /** A second period said as both a month and a quarter is of the period's kind. */
    'kind_of_period',
    /** A compared part equal to the period's own says no other period. */
    'same_as_period',
    /**
     * The previous month or quarter of a second period, with no year, is the one before the
     * period; last year, or the year before last, counts back from the period's written year.
     */
    'previous_of_period',
] as const;

export type PeriodRule = (typeof PERIOD_RULES)[number];

/**
 * The parts of the period from the model's answers: each part it is sure of, else unspecified,
 * then the rules of {@link PERIOD_RULES}. The request names no period when none of its own parts
 * is sure. Without compared parts, the period is compared with the same one a year earlier when
 * the model says so, else with the previous one (the builder's default).
 */
export function readPeriod(answers: PeriodAnswers): PeriodReading {
    const rules: PeriodRule[] = [];
    let span = spanOf(sure(answers.span, 'span'));
    let year = yearOf(sure(answers.year, 'year'));
    const month = monthOf(sure(answers.month, 'month'));
    const quarter = quarterOf(sure(answers.quarter, 'quarter'));
    let comparedYear = yearOf(sure(answers.compared_year, 'compared_year'));
    let comparedMonth = monthOf(sure(answers.compared_month, 'compared_month'));
    let comparedQuarter = quarterOf(sure(answers.compared_quarter, 'compared_quarter'));
    const placed = year !== undefined || month !== undefined || quarter !== undefined;
    if (!placed && (span === 'month' || span === 'quarter' || span === 'year')) {
        span = undefined;
        rules.push('span_alone');
    }
    if (span === 'last_12_months' && typeof year === 'string') {
        year = undefined;
        rules.push('rolling_period');
    }
    if (comparedMonth !== undefined && comparedQuarter !== undefined) {
        const kind =
            span ?? (month !== undefined ? 'month' : quarter !== undefined ? 'quarter' : 'year');
        if (kind === 'quarter') {
            comparedMonth = undefined;
            rules.push('kind_of_period');
        } else if (kind === 'month' || kind === 'now') {
            comparedQuarter = undefined;
            rules.push('kind_of_period');
        }
    }
    if (
        (comparedYear !== undefined && comparedYear === year) ||
        (comparedMonth !== undefined && comparedMonth === month) ||
        (comparedQuarter !== undefined && comparedQuarter === quarter)
    ) {
        comparedYear = comparedYear === year ? undefined : comparedYear;
        comparedMonth = comparedMonth === month ? undefined : comparedMonth;
        comparedQuarter = comparedQuarter === quarter ? undefined : comparedQuarter;
        rules.push('same_as_period');
    }
    if (
        comparedYear === undefined &&
        (comparedMonth === 'previous' || comparedQuarter === 'previous')
    ) {
        comparedMonth = comparedMonth === 'previous' ? undefined : comparedMonth;
        comparedQuarter = comparedQuarter === 'previous' ? undefined : comparedQuarter;
        rules.push('previous_of_period');
    } else if (
        typeof year === 'number' &&
        (comparedYear === 'previous' || comparedYear === 'before_previous')
    ) {
        // "2016 versus last year": the year before 2016.
        comparedYear = year - (comparedYear === 'previous' ? 1 : 2);
        rules.push('previous_of_period');
    }
    const yearEarlier = answers.year_earlier.noul >= PERIOD_THRESHOLDS.year_earlier;
    const trace: PeriodTrace = {
        span: traced(answers.span, span),
        year: traced(answers.year, year),
        month: traced(answers.month, month),
        quarter: traced(answers.quarter, quarter),
        compared_year: traced(answers.compared_year, comparedYear),
        compared_month: traced(answers.compared_month, comparedMonth),
        compared_quarter: traced(answers.compared_quarter, comparedQuarter),
        year_earlier: { answer: yearEarlier, score: answers.year_earlier.noul },
        rules,
    };
    const period: PeriodParts = defined({ span, year, month, quarter });
    if (Object.keys(period).length === 0) {
        return { trace };
    }
    const compared: ComparedParts = defined({
        year: comparedYear,
        month: comparedMonth,
        quarter: comparedQuarter,
    });
    const request: PeriodRequest =
        Object.keys(compared).length > 0
            ? { period, compared }
            : yearEarlier
              ? { period, compareWith: 'year_earlier' }
              : { period };
    return { request, trace };
}

function traced(answer: ChoiceAnswer, read: string | number | undefined): PeriodPartTrace {
    return {
        answer: answer.choice,
        score: answer.confidence,
        ...(read === undefined ? {} : { read }),
    };
}

/** An object without its `undefined` values. */
function defined<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, part]) => part !== undefined)) as T;
}

/** The app's intent questions with the period choice replaced by the period questions. */
export type AtomicIntentQuestions = Omit<IntentQuestions, 'period'> & PeriodQuestions;

export interface AtomicIntentRequest {
    request: SystemOneRequest<AtomicIntentQuestions>;
    /** What each root option stands for, as in `buildIntentRequest`. */
    roots: Record<string, string>;
}

/**
 * The app's decision request of a report request, in one call, with its period choice replaced
 * by the period questions; every other question (and `year_earlier`) is unchanged.
 */
export function buildAtomicIntentRequest(prompt: string, snapshot: Snapshot): AtomicIntentRequest {
    const { request, roots } = buildIntentRequest(prompt, snapshot);
    const { period: _period, ...questions } = request.questions;
    return {
        request: { ...request, questions: { ...questions, ...buildPeriodQuestions(prompt) } },
        roots,
    };
}
