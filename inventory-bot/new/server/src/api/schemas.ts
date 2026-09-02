import { z } from '@hono/zod-openapi';

export const ApiErrorSchema = z
    .object({
        error: z.object({
            message: z.string(),
        }),
    })
    .openapi('ApiError');

export type ApiError = z.infer<typeof ApiErrorSchema>;
