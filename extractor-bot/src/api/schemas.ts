import { z } from 'zod';
import type { ExtractedTransaction } from '../genai/ExtractedTransaction.js';

export const AccountSchema: z.ZodType<bkper.Account> = z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    properties: z.record(z.string(), z.string()).optional(),
}).passthrough().meta({ 'x-typescript-type': 'bkper.Account' });

export const FileSchema: z.ZodType<bkper.File> = z.object({
    id: z.string().min(1).optional(),
    name: z.string().optional(),
    contentType: z.string().optional(),
    content: z.string().min(1).base64().optional(),
    properties: z.record(z.string(), z.string()).optional(),
}).passthrough().refine(file => !!file.id || !!file.content, { message: 'A File ID or base64 content is required.' }).meta({ 'x-typescript-type': 'bkper.File', anyOf: [{ required: ['id'] }, { required: ['content'] }] });

export const TransactionSchema: z.ZodType<bkper.Transaction> = z.object({
    id: z.string().min(1).optional(),
    description: z.string().optional(),
    amount: z.string().regex(/^-?\d+(\.\d+)?$/).optional(),
    date: z.iso.date().optional(),
    creditAccount: AccountSchema.optional(),
    debitAccount: AccountSchema.optional(),
    properties: z.record(z.string(), z.string()).optional(),
    files: z.array(FileSchema).optional(),
    tags: z.array(z.string()).optional(),
}).passthrough().meta({ 'x-typescript-type': 'bkper.Transaction' });

export const ParseRequestSchema = z.object({
    bookId: z.string().min(1),
    file: FileSchema.optional(),
    transaction: TransactionSchema.optional(),
}).refine(request => !!request.file || !!request.transaction, { message: 'A File or Transaction is required.' }).meta({ anyOf: [{ required: ['file'] }, { required: ['transaction'] }] });

export const ErrorSchema = z.object({ code: z.string(), message: z.string() });
export const ParseResultSchema = z.object({
    transactions: z.array(z.object({ bookId: z.string(), transaction: TransactionSchema })),
    fileProperties: z.record(z.string(), z.string()).optional(),
    outcome: z.enum(['parsed', 'empty', 'error']),
    error: ErrorSchema.optional(),
});
export const ErrorResponseSchema = z.object({ error: ErrorSchema });

// External parsers are untrusted; validate extracted fields before making canonical suggestions.
export const ExtractedTransactionSchema: z.ZodType<ExtractedTransaction> = z.object({
    date: z.iso.date().nullable(),
    description: z.string(),
    amount: z.number().finite(),
    properties: z.record(z.string(), z.union([z.string(), z.number().finite()])),
    book_id: z.string().min(1).optional(),
    account_name: z.string().min(1).optional(),
});

export type ParseRequest = z.infer<typeof ParseRequestSchema>;
export type ParseResult = z.infer<typeof ParseResultSchema>;
