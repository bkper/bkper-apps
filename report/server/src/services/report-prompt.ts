import { MAX_PROMPT_LENGTH } from 'report-shared/url-state';
import { z } from 'zod';

/** The same boundary for a report request and a saved request: no inferred or resolved data. */
export const ReportPromptSchema = z.string().trim().min(1).max(MAX_PROMPT_LENGTH);
