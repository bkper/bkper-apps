import { z } from 'zod';

// Validate the fields discovery uses; retain other canonical payload fields untouched.
export const AccountSchema: z.ZodType<bkper.Account> = z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    properties: z.record(z.string(), z.string()).optional(),
}).passthrough().meta({ 'x-typescript-type': 'bkper.Account' });

export const TransactionSchema: z.ZodType<bkper.Transaction> = z.object({
    id: z.string().min(1).optional(),
    createdBy: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    creditAccount: AccountSchema.optional(),
    debitAccount: AccountSchema.optional(),
    properties: z.record(z.string(), z.string()).optional(),
}).passthrough().meta({ 'x-typescript-type': 'bkper.Transaction' });

export const DiscoveryItemSchema = z.object({
    itemId: z.string().min(1),
    bookId: z.string().min(1),
    transaction: TransactionSchema,
    sourceAccount: AccountSchema.optional(),
});

export const ErrorSchema = z.object({
    code: z.string(),
    message: z.string(),
});

export const DiscoveryResultSchema = z.object({
    itemId: z.string(),
    bookId: z.string(),
    transaction: TransactionSchema,
    outcome: z.enum(['changed', 'no_change', 'no_match', 'error']),
    error: ErrorSchema.optional(),
});

export const DiscoveryBatchSchema = z.object({
    items: z.array(DiscoveryItemSchema).min(1),
}).refine(batch => new Set(batch.items.map(item => item.itemId)).size === batch.items.length, {
    message: 'Item identifiers must be unique within a batch.',
});

export const DiscoveryBatchResultSchema = z.object({ items: z.array(DiscoveryResultSchema) });
export const ErrorResponseSchema = z.object({ error: ErrorSchema });

export type DiscoveryItem = z.infer<typeof DiscoveryItemSchema>;
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;
