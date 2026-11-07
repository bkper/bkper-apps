import { z } from 'zod';
import {
    HASHTAG_PATTERN,
    MAX_HASHTAGS,
    MAX_HASHTAG_LENGTH,
    MAX_ROOT_LENGTH,
    NET_RESULT_ROOT,
    PERIOD_ID_PATTERN,
    REPORT_CHARTS,
    REPORT_VIEWS,
    type ChartPreference,
    type ReportView,
} from 'report-shared/report-intent';

export { NET_RESULT_ROOT, REPORT_CHARTS, REPORT_VIEWS, type ChartPreference, type ReportView };

/** What to report, fully resolved: the report is computed from this alone. */
export const ReportIntentSchema = z.object({
    /** Root group id, the id of an account in no group, or {@link NET_RESULT_ROOT}. */
    root: z.string().min(1).max(MAX_ROOT_LENGTH),
    /** A group or account under the root group, by id, to report instead of the whole root. */
    target: z.string().min(1).max(MAX_ROOT_LENGTH).optional(),
    /** A period id; see `periods.ts`. */
    period: z.string().regex(PERIOD_ID_PATTERN),
    /** Whether to show the period by month. */
    monthly: z.boolean(),
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
