import { z } from 'zod';
import {
    COMPARE_WITH,
    HASHTAG_PATTERN,
    MAX_ALONGSIDE,
    MAX_HASHTAGS,
    MAX_HASHTAG_LENGTH,
    MAX_ROOT_LENGTH,
    NET_RESULT_ROOT,
    PERIOD_ID_PATTERN,
    REPORT_CHARTS,
    REPORT_VIEWS,
    type ChartPreference,
    type CompareWith,
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

/** What to report, fully resolved: the report is computed from this alone. */
export const ReportIntentSchema = z.object({
    /** Root group id, the id of an account in no group, or {@link NET_RESULT_ROOT}. */
    root: Id,
    /** A group or account under the root group, by id, to report instead of the whole root. */
    target: Id.optional(),
    /** More groups or accounts, each under its root, shown side by side with the first. */
    alongside: z.array(ReportSubjectSchema).min(1).max(MAX_ALONGSIDE).optional(),
    /** A period id; see `periods.ts`. */
    period: z.string().regex(PERIOD_ID_PATTERN),
    /** Whether to show the period by month. */
    monthly: z.boolean(),
    /** What the period is compared with; left out, the period before. */
    compareWith: z.enum(COMPARE_WITH).optional(),
    /** The layout the request named, if any. */
    view: z.enum(REPORT_VIEWS).optional(),
    /** The chart the person prefers; left out, `auto`. */
    chart: z.enum(REPORT_CHARTS).optional(),
    /** Limit to transactions with all these hashtags. */
    hashtags: z
        .array(z.string().max(MAX_HASHTAG_LENGTH).regex(HASHTAG_PATTERN))
        .max(MAX_HASHTAGS)
        .optional(),
});

export type ReportIntent = z.infer<typeof ReportIntentSchema>;
export type ReportSubjectData = z.infer<typeof ReportSubjectSchema>;
