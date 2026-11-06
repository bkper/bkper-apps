import { z } from 'zod';

/** The same boundary for a report request and a saved request: no inferred or resolved data. */
export const ReportPromptSchema = z.string().trim().min(1).max(1000);
