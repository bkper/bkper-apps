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
    .array(z.string().trim().min(1))
    .openapi('PendingCalculationAccounts');

const AccountChangesSchema = z.object({
    created: z.array(z.string().trim().min(1)),
    updated: z.array(z.string().trim().min(1)),
});

const TransactionChangesSchema = z.object({
    created: z.array(z.string().trim().min(1)),
    updated: z.array(z.string().trim().min(1)),
    trashed: z.array(z.string().trim().min(1)),
});

const BookChangesSchema = z.object({
    bookId: z.string().trim().min(1),
    accounts: AccountChangesSchema,
    transactions: TransactionChangesSchema,
    bookUpdated: z.boolean(),
});

export const CalculateResultSchema = z
    .object({
        books: z.array(BookChangesSchema),
    })
    .openapi('CalculateResult');

export type CalculateResult = z.infer<typeof CalculateResultSchema>;

export const ResetResultSchema = z
    .object({
        books: z.array(BookChangesSchema),
    })
    .openapi('ResetResult');

export type ResetResult = z.infer<typeof ResetResultSchema>;

export const FullResetResultSchema = z
    .object({
        books: z.array(BookChangesSchema),
    })
    .openapi('FullResetResult');

export type FullResetResult = z.infer<typeof FullResetResultSchema>;

export const ForwardResultSchema = z
    .object({
        books: z.array(BookChangesSchema),
    })
    .openapi('ForwardResult');

export type ForwardResult = z.infer<typeof ForwardResultSchema>;

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
