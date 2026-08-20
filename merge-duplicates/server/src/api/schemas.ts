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

const PropertiesSchema = z.record(z.string(), z.string());
const AccountTypeSchema = z.enum(['ASSET', 'LIABILITY', 'INCOMING', 'OUTGOING']);
const PermissionSchema = z.enum(['OWNER', 'EDITOR', 'POSTER', 'RECORDER', 'VIEWER', 'NONE']);

const GroupPayloadSchema = z
    .object({
        id: z.string().optional(),
        name: z.string().optional(),
        normalizedName: z.string().optional(),
        type: AccountTypeSchema.optional(),
        credit: z.boolean().optional(),
        permanent: z.boolean().optional(),
        mixed: z.boolean().optional(),
        hidden: z.boolean().optional(),
        locked: z.boolean().optional(),
        hasAccounts: z.boolean().optional(),
        hasGroups: z.boolean().optional(),
        properties: PropertiesSchema.optional(),
        agentId: z.string().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
    })
    .passthrough()
    .openapi('Group');

const AccountPayloadSchema = z
    .object({
        id: z.string().optional(),
        name: z.string().optional(),
        normalizedName: z.string().optional(),
        type: AccountTypeSchema.optional(),
        credit: z.boolean().optional(),
        permanent: z.boolean().optional(),
        archived: z.boolean().optional(),
        balance: z.string().optional(),
        balanceVerified: z.boolean().optional(),
        hasTransactionPosted: z.boolean().optional(),
        groups: z.array(GroupPayloadSchema).optional(),
        properties: PropertiesSchema.optional(),
        agentId: z.string().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
    })
    .passthrough()
    .openapi('Account');

const FilePayloadSchema = z
    .object({
        id: z.string().optional(),
        name: z.string().optional(),
        content: z.string().optional(),
        contentType: z.string().optional(),
        size: z.number().optional(),
        url: z.string().optional(),
        properties: PropertiesSchema.optional(),
        agentId: z.string().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
    })
    .passthrough()
    .openapi('File');

export const TransactionPayloadSchema = z
    .object({
        id: z.string().optional(),
        date: z.string().optional(),
        dateFormatted: z.string().optional(),
        dateValue: z.number().int().optional(),
        amount: z.string().optional(),
        description: z.string().optional(),
        posted: z.boolean().optional(),
        draft: z.boolean().optional(),
        checked: z.boolean().optional(),
        trashed: z.boolean().optional(),
        creditAccount: AccountPayloadSchema.optional(),
        debitAccount: AccountPayloadSchema.optional(),
        properties: PropertiesSchema.optional(),
        files: z.array(FilePayloadSchema).optional(),
        remoteIds: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        urls: z.array(z.string()).optional(),
        agentId: z.string().optional(),
        agentName: z.string().optional(),
        agentLogo: z.string().optional(),
        agentLogoDark: z.string().optional(),
        createdBy: z.string().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
    })
    .passthrough()
    .openapi('Transaction');

const BookPayloadSchema = z
    .object({
        id: z.string().optional(),
        name: z.string().optional(),
        accounts: z.array(AccountPayloadSchema).optional(),
        groups: z.array(GroupPayloadSchema).optional(),
        autoPost: z.boolean().optional(),
        closingDate: z.string().optional(),
        lockDate: z.string().optional(),
        datePattern: z.string().optional(),
        decimalSeparator: z.enum(['DOT', 'COMMA']).optional(),
        fractionDigits: z.number().int().optional(),
        pageSize: z.number().int().optional(),
        permission: PermissionSchema.optional(),
        properties: PropertiesSchema.optional(),
        timeZone: z.string().optional(),
        timeZoneOffset: z.number().optional(),
        visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
        agentId: z.string().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
    })
    .passthrough()
    .openapi('Book');

const CanonicalIdSchema = z
    .string()
    .min(1)
    .max(256)
    .refine(value => value === value.trim(), 'Transaction ID must be canonical.');

const TransactionWithIdSchema = TransactionPayloadSchema.extend({ id: CanonicalIdSchema });

export const SkippedCountsSchema = z
    .object({
        total: z.number().int().nonnegative(),
        checked: z.number().int().nonnegative(),
        trashed: z.number().int().nonnegative(),
        locked: z.number().int().nonnegative(),
        invalid: z.number().int().nonnegative(),
    })
    .openapi('SkippedCounts');

export const SuggestionSchema = z
    .object({
        transactions: z.array(TransactionPayloadSchema).min(2).max(2),
        strength: z.enum(['Strong', 'Possible']),
        explanation: z.string(),
    })
    .openapi('Suggestion');

export const AnalyzeRequestSchema = z
    .object({
        bookId: z.string().trim().min(1).max(256),
        transactions: z.array(TransactionPayloadSchema).max(1_000),
    })
    .superRefine((value, context) => {
        const ids = new Set<string>();
        value.transactions.forEach((transaction, index) => {
            const result = CanonicalIdSchema.safeParse(transaction.id);
            if (!result.success) {
                context.addIssue({
                    code: 'custom',
                    path: ['transactions', index, 'id'],
                    message: result.error.issues[0]?.message ?? 'Transaction ID is required.',
                });
                return;
            }
            if (ids.has(result.data)) {
                context.addIssue({
                    code: 'custom',
                    path: ['transactions', index, 'id'],
                    message: 'Transaction IDs must be unique.',
                });
                return;
            }
            ids.add(result.data);
        });
    })
    .openapi('AnalyzeRequest');

export const AnalyzeResponseSchema = z
    .object({
        suggestions: z.array(SuggestionSchema),
        skipped: SkippedCountsSchema,
    })
    .openapi('AnalyzeResponse');

export const MergeRequestSchema = z
    .object({
        bookId: z.string().trim().min(1).max(256),
        primary: TransactionWithIdSchema,
        secondary: TransactionWithIdSchema,
    })
    .refine(value => value.primary.id !== value.secondary.id, {
        message: 'Transaction IDs must be distinct.',
    })
    .openapi('MergeRequest');

export const MergeResponseSchema = TransactionPayloadSchema.openapi('MergeResponse');

const RejectedPairSchema = z.array(TransactionWithIdSchema).min(2).max(2);

export const LearnRequestSchema = z
    .object({
        bookId: z.string().trim().min(1).max(256),
        accountId: z.string().trim().min(1).max(256).optional(),
        groupId: z.string().trim().min(1).max(256).optional(),
        examples: z.array(RejectedPairSchema).min(1).max(50),
    })
    .refine(value => !(value.accountId && value.groupId), {
        message: 'accountId and groupId are mutually exclusive.',
    })
    .openapi('LearnRequest');

export const LearnResponseSchema = z
    .union([
        z.object({ book: BookPayloadSchema }),
        z.object({ group: GroupPayloadSchema }),
        z.object({ account: AccountPayloadSchema }),
    ])
    .openapi('LearnResponse');

export const apiErrorResponses = {
    400: jsonResponse('Invalid request', ErrorResponseSchema),
    401: jsonResponse('Authentication failed', ErrorResponseSchema),
    403: jsonResponse('Permission denied', ErrorResponseSchema),
    500: jsonResponse('Unexpected API error', ErrorResponseSchema),
};

export const aiErrorResponses = {
    402: jsonResponse('Subscription payment required', ErrorResponseSchema),
    429: jsonResponse('AI allowance exhausted or provider throttled', ErrorResponseSchema),
    502: jsonResponse('AI providers unavailable', ErrorResponseSchema),
};
