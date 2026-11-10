import { MAX_PROMPT_LENGTH } from 'report-shared/url-state';
import { z } from 'zod';

/** The same boundary for a report request and a saved request: no inferred or resolved data. */
export const ReportPromptSchema = z.string().trim().min(1).max(MAX_PROMPT_LENGTH);

/** The longest Bkper query a report is read from. */
export const MAX_QUERY_LENGTH = 2000;

/** A Bkper query a report is read from. */
export const ReportQuerySchema = z.string().trim().min(1).max(MAX_QUERY_LENGTH);
