import { z } from '@hono/zod-openapi';
import type { ZodType } from 'zod';

const JSON_CONTENT_TYPE = 'application/json';

export function jsonResponse<TSchema extends ZodType>(description: string, schema: TSchema) {
    return {
        description,
        content: {
            [JSON_CONTENT_TYPE]: { schema },
        },
    };
}

export const ErrorResponseSchema = z
    .object({
        success: z.literal(false),
        error: z.object({
            code: z.string().min(1).openapi({ example: 'INTERNAL_ERROR' }),
            message: z.string().openapi({ example: 'An unexpected error occurred' }),
        }),
    })
    .openapi('ErrorResponse');

export const PingResponseSchema = z
    .object({
        ok: z.boolean().openapi({ example: true }),
        source: z.string().openapi({ example: 'report' }),
    })
    .openapi('PingResponse');

export const apiErrorResponses = {
    default: jsonResponse('API error', ErrorResponseSchema),
};
