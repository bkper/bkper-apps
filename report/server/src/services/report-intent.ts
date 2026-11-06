import { z } from 'zod';
import { PERIOD_ID_PATTERN } from './periods';

/** The `root` of a net result report: every Incoming root versus every Outgoing root. */
export const NET_RESULT_ROOT = 'net-result';

export const REPORT_VIEWS = ['trend', 'breakdown', 'total'] as const;

export type ReportView = (typeof REPORT_VIEWS)[number];

/**
 * A hashtag name without `#`. It goes into a Bkper query verbatim, so it excludes whitespace,
 * quotes and the separators Bkper splits hashtags on.
 */
const HASHTAG_PATTERN = /^[^\s#,.'"]+$/;

/** What to report, fully resolved: the report is computed from this alone. */
export const ReportIntentSchema = z.object({
    /** Root group id, or {@link NET_RESULT_ROOT}. */
    root: z.string().min(1).max(200),
    /** A period id; see `periods.ts`. */
    period: z.string().regex(PERIOD_ID_PATTERN),
    /** Whether to show the period by month. */
    monthly: z.boolean(),
    /** The layout the request named, if any. */
    view: z.enum(REPORT_VIEWS).optional(),
    /** Limit to transactions with all these hashtags. */
    hashtags: z.array(z.string().max(100).regex(HASHTAG_PATTERN)).max(10).optional(),
});

export type ReportIntent = z.infer<typeof ReportIntentSchema>;
