import { z } from 'zod';
import {
    COMPARE_WITH,
    HASHTAG_PATTERN,
    MAX_ALONGSIDE,
    MAX_HASHTAGS,
    MAX_HASHTAG_LENGTH,
    MAX_ROOT_LENGTH,
    MAX_YEAR,
    MIN_YEAR,
    MONTHS_OF_YEAR,
    NET_RESULT_ROOT,
    PERIOD_ID_PATTERN,
    PERIOD_SPANS,
    QUARTERS_OF_YEAR,
    RELATIVE_UNITS,
    RELATIVE_YEARS,
    REPORT_CHARTS,
    REPORT_VIEWS,
    intentWithParts,
    type ChartPreference,
    type CompareWith,
    type PeriodParts,
    type ReportView,
} from 'report-shared/report-intent';

export {
    COMPARE_WITH,
    NET_RESULT_ROOT,
    REPORT_CHARTS,
    REPORT_VIEWS,
    type ChartPreference,
    type CompareWith,
    type ReportView,
};

const Id = z.string().min(1).max(MAX_ROOT_LENGTH);

/** A root group or an account in no group, or a group or account under a root group. */
export const ReportSubjectSchema = z.object({
    root: Id,
    target: Id.optional(),
});

const YearSchema = z.union([z.enum(RELATIVE_YEARS), z.int().min(MIN_YEAR).max(MAX_YEAR)]).meta({
    description:
        'A year relative to today’s (`current`, `previous`, or `before_previous`: the year before last) or a year as written, such as `2023`.',
});
// The OpenAPI generator writes only the first value of a literal of several: name them all.
const MonthOfYearSchema = z
    .literal(MONTHS_OF_YEAR)
    .meta({ type: 'integer', enum: [...MONTHS_OF_YEAR] });
const QuarterOfYearSchema = z
    .literal(QUARTERS_OF_YEAR)
    .meta({ type: 'integer', enum: [...QUARTERS_OF_YEAR] });
const MonthSchema = z.union([z.enum(RELATIVE_UNITS), MonthOfYearSchema]).meta({
    description:
        'A month: `1` (January) to `12`, or the `current` or `previous` one. A named month without a year is the latest one that has started.',
});
const QuarterSchema = z.union([z.enum(RELATIVE_UNITS), QuarterOfYearSchema]).meta({
    description:
        'A calendar quarter: `1` to `4`, or the `current` or `previous` one. A named quarter without a year is the latest one that has started.',
});
const SpanSchema = z.enum(PERIOD_SPANS).meta({
    description:
        'The kind of period: `month`, `quarter`, `year`, `year_to_date`, `last_12_months`, `all_time`, or `now` (a balance today; activity reads this month).',
});

const comparedShape = {
    year: YearSchema.optional(),
    month: MonthSchema.optional(),
    quarter: QuarterSchema.optional(),
};

const namesAPart = (parts: Record<string, unknown>) =>
    Object.values(parts).some(part => part !== undefined);

/** The parts of the period compared with; those left out are the period's own. */
export const ComparedPartsSchema = z
    .object(comparedShape)
    .refine(namesAPart, { message: 'Name at least one part of the period compared with' });

/** The parts of a period, as a request says them. */
export const PeriodPartsSchema = z
    .object({ span: SpanSchema.optional(), ...comparedShape })
    .refine(namesAPart, { message: 'Name at least one part of the period' });

/** A period id of older intents, translated into parts. */
export const PeriodIdSchema = z.string().regex(PERIOD_ID_PATTERN);

/**
 * What to report, fully resolved: the report is computed from this alone. Its period is parts;
 * a period id of older intents is still accepted ({@link intentWithParts}).
 */
export const ReportIntentSchema = z.object({
    /** Root group id, the id of an account in no group, or {@link NET_RESULT_ROOT}. */
    root: Id,
    /** A group or account under the root group, by id, to report instead of the whole root. */
    target: Id.optional(),
    /** More groups or accounts, each under its root, shown side by side with the first. */
    alongside: z.array(ReportSubjectSchema).min(1).max(MAX_ALONGSIDE).optional(),
    /** The period, as parts; or a period id of older intents. */
    period: z.union([PeriodPartsSchema, PeriodIdSchema]),
    /** The period compared with, as parts; left out, `compareWith` says. */
    compared: ComparedPartsSchema.optional(),
    /** Whether to show the period by month. */
    monthly: z.boolean(),
    /** Without `compared`, what the period is compared with; left out, the period before. */
    compareWith: z.enum(COMPARE_WITH).optional(),
    /** The layout the request named, if any. */
    view: z.enum(REPORT_VIEWS).optional(),
    /** The chart the person prefers; left out, `auto`. */
    chart: z.enum(REPORT_CHARTS).optional(),
    /** Limit to transactions with this hashtag: at most one, as Bkper's balances filter by one. */
    hashtags: z
        .array(z.string().max(MAX_HASHTAG_LENGTH).regex(HASHTAG_PATTERN))
        .max(MAX_HASHTAGS)
        .optional(),
});

/** An intent as callers send it: its period as parts, or as a period id of older intents. */
export type ReportIntentInput = z.infer<typeof ReportIntentSchema>;

/** An intent with its period as parts, as reports read it and answers give it. */
export type ReportIntent = Omit<ReportIntentInput, 'period'> & { period: PeriodParts };

/** An intent with its period as parts; a valid intent always has them. */
export function reportIntentOf(input: ReportIntentInput): ReportIntent {
    const intent = intentWithParts(input);
    if (!intent) {
        throw new Error(`Invalid period id: ${String(input.period)}`);
    }
    return intent;
}
export type ReportSubjectData = z.infer<typeof ReportSubjectSchema>;
