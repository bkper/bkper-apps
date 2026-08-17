import { z } from '@hono/zod-openapi';
import type { ZodType } from 'zod';

const JSON_CONTENT_TYPE = 'application/json';

export function jsonResponse<TSchema extends ZodType>(description: string, schema: TSchema) {
    return { description, content: { [JSON_CONTENT_TYPE]: { schema } } };
}

export const ErrorResponseSchema = z
    .object({
        success: z.literal(false),
        error: z.object({ code: z.string().min(1), message: z.string() }),
    })
    .openapi('ErrorResponse');

const AccountSnapshotSchema = z
    .object({ id: z.string().trim().min(1).max(256), name: z.string().max(500) })
    .openapi('AccountSnapshot');

export const TransactionFingerprintSchema = z
    .object({
        id: z.string().trim().min(1).max(256),
        date: z.iso.date(),
        amount: z.string().trim().min(1).max(100),
        description: z.string().max(2000),
        fromAccount: AccountSnapshotSchema.nullable(),
        toAccount: AccountSnapshotSchema.nullable(),
        properties: z.record(z.string().max(100), z.string().max(4000)),
        draft: z.boolean(),
    })
    .openapi('TransactionFingerprint');

export const SkippedCountsSchema = z
    .object({
        total: z.number().int().nonnegative(),
        checked: z.number().int().nonnegative(),
        trashed: z.number().int().nonnegative(),
        locked: z.number().int().nonnegative(),
    })
    .openapi('SkippedCounts');

export const SuggestionSchema = z
    .object({
        id: z.string(),
        strength: z.enum(['Strong', 'Possible']),
        explanation: z.string(),
        first: TransactionFingerprintSchema,
        second: TransactionFingerprintSchema,
    })
    .openapi('Suggestion');

export const ScanRequestSchema = z
    .object({
        bookId: z.string().trim().min(1).max(256),
        query: z.string().max(4000),
        cursor: z.string().max(4000).nullish(),
        fingerprints: z.array(TransactionFingerprintSchema).max(20_000),
    })
    .openapi('ScanRequest');

export const ScanResponseSchema = z
    .object({
        permission: z.enum(['OWNER', 'EDITOR', 'POSTER']),
        suggestions: z.array(SuggestionSchema),
        fingerprints: z.array(TransactionFingerprintSchema),
        cursor: z.string().optional(),
        scanned: z.number().int().nonnegative(),
        candidateCount: z.number().int().nonnegative(),
        skipped: SkippedCountsSchema,
        promptVersion: z.string(),
    })
    .openapi('ScanResponse');

export const MergeRequestSchema = z
    .object({
        bookId: z.string().trim().min(1).max(256),
        firstTransactionId: z.string().trim().min(1).max(256),
        secondTransactionId: z.string().trim().min(1).max(256),
    })
    .refine(value => value.firstTransactionId !== value.secondTransactionId, {
        message: 'Transaction IDs must be distinct.',
    })
    .openapi('MergeRequest');

export const MergeResponseSchema = z
    .object({ mergedTransactionId: z.string().min(1) })
    .openapi('MergeResponse');

export const LearnRequestSchema = z
    .object({
        bookId: z.string().trim().min(1).max(256),
        accountId: z.string().trim().min(1).max(256).nullish(),
        groupId: z.string().trim().min(1).max(256).nullish(),
        pair: z.object({
            first: TransactionFingerprintSchema,
            second: TransactionFingerprintSchema,
        }),
    })
    .openapi('LearnRequest');

export const LearnResponseSchema = z
    .object({
        saved: z.boolean(),
        skipped: z.boolean(),
        resourceType: z.enum(['account', 'group', 'book']).nullable(),
        notice: z.string().optional(),
    })
    .openapi('LearnResponse');

export const apiErrorResponses = {
    400: jsonResponse('Invalid request', ErrorResponseSchema),
    401: jsonResponse('Authentication failed', ErrorResponseSchema),
    403: jsonResponse('Permission denied', ErrorResponseSchema),
    500: jsonResponse('Unexpected API error', ErrorResponseSchema),
};
