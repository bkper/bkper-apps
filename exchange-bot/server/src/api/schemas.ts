import { z } from '@hono/zod-openapi';
import { Amount } from 'bkper-js';
import type { ZodType } from 'zod';

export const BookIdParamSchema = z.object({
    bookId: z.string().trim().min(1),
});

export const ExchangeRatesDateQuerySchema = z.object({
    date: z.iso.date(),
});

const RateSchema = z.union([
    z.number().finite(),
    z.string().refine(isAmount, { message: 'Rate must be numeric' }),
]);

export const ExchangeRatesSchema = z
    .object({
        base: z.string().trim().min(1),
        date: z.iso.date(),
        rates: z.record(z.string(), RateSchema),
    })
    .openapi('ExchangeRates');

export type ExchangeRates = z.infer<typeof ExchangeRatesSchema>;

// Bkper owns and validates its API payload. This only types and documents the transport response.
export const BkperTransactionSchema = z.custom<bkper.Transaction>().openapi('BkperTransaction', {
    type: 'object',
    additionalProperties: true,
    'x-typescript-type': 'bkper.Transaction',
});

export const BkperAccountSchema = z.custom<bkper.Account>().openapi('BkperAccount', {
    type: 'object',
    additionalProperties: true,
    'x-typescript-type': 'bkper.Account',
});

export const ExchangeUpdateResultSchema = z
    .object({
        createdTransactions: z.array(BkperTransactionSchema),
        createdAccounts: z.array(BkperAccountSchema),
    })
    .openapi('ExchangeUpdateResult');

export type ExchangeUpdateResult = z.infer<typeof ExchangeUpdateResultSchema>;

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

function isAmount(value: string): boolean {
    try {
        new Amount(value);
        return true;
    } catch {
        return false;
    }
}
