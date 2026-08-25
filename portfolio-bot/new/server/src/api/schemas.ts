import { z } from '@hono/zod-openapi';
import type { ZodType } from 'zod';

export const BookIdParamSchema = z.object({
    bookId: z.string().trim().min(1),
});

export const BookAccountIdParamSchema = BookIdParamSchema.extend({
    accountId: z.string().trim().min(1),
});

export const CalculateRequestSchema = z
    .object({
        date: z.iso.date(),
        performMtm: z.boolean(),
    })
    .openapi('CalculateRequest');

export type CalculateRequest = z.infer<typeof CalculateRequestSchema>;

export const ForwardRequestSchema = z
    .object({
        date: z.iso.date(),
    })
    .openapi('ForwardRequest');

export type ForwardRequest = z.infer<typeof ForwardRequestSchema>;

export const PendingCalculationAccountsSchema = z
    .object({
        ids: z.array(z.string().trim().min(1)),
    })
    .openapi('PendingCalculationAccounts');

export type PendingCalculationAccounts = z.infer<typeof PendingCalculationAccountsSchema>;

export const OperationResponseSchema = z
    .object({
        message: z.string(),
    })
    .openapi('OperationResponse');

export type OperationResponse = z.infer<typeof OperationResponseSchema>;

export const ApiErrorSchema = z
    .object({
        error: z.object({
            message: z.string(),
        }),
    })
    .openapi('ApiError');

export type ApiError = z.infer<typeof ApiErrorSchema>;

export function jsonResponse<T extends ZodType>(description: string, schema: T) {
    return {
        description,
        content: { 'application/json': { schema } },
    };
}

export const apiErrorResponses = {
    400: jsonResponse('Invalid request', ApiErrorSchema),
    401: jsonResponse('Authentication failed', ApiErrorSchema),
    403: jsonResponse('Authorization failed', ApiErrorSchema),
    500: jsonResponse('Unexpected API error', ApiErrorSchema),
};
