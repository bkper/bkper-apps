import { Account, BkperError, Book, File, Permission, Transaction } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import { AppContext } from '../AppContext.js';
import { AGENT_EXTRACTED_PROPERTY, AGENT_FILE_ID_PROPERTY, AUTO_FILLED_DATE_PROPERTY } from '../constants.js';
import { FileParserRouter } from '../file-parsers/FileParserRouter.js';
import { BkperAIClientError } from '../genai/BkperAIClientError.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { AttachmentExtractionService } from '../services/AttachmentExtractionService.js';
import { setAccountBasedOnAmount } from '../utils/transaction-utils.js';
import { ExtractedTransactionSchema, ParseResultSchema, type ParseRequest, type ParseResult } from './schemas.js';

const READ_PERMISSIONS: readonly Permission[] = [Permission.VIEWER, Permission.POSTER, Permission.EDITOR, Permission.OWNER];

async function requireBook(context: AppContext, bookId: string): Promise<Book> {
    const book = await context.bkper.getBook(bookId);
    if (book.getId() !== bookId || !READ_PERMISSIONS.includes(book.getPermission())) {
        throw new HTTPException(403, { message: 'Read access to the target Book is required.' });
    }
    return book;
}

async function requireAccount(book: Book, id: string): Promise<Account> {
    const account = await book.getAccount(id);
    if (!account || account.getId() !== id) {
        throw new HTTPException(400, { message: 'Account does not belong to the target Book.' });
    }
    return account;
}

async function resolveFile(book: Book, payload: bkper.File): Promise<File> {
    let stored: File | undefined;
    if (payload.id) {
        stored = await book.getFile(payload.id);
        if (!stored || stored.getId() !== payload.id) {
            throw new HTTPException(400, { message: 'File does not belong to the target Book.' });
        }
    }
    const storedPayload = stored?.json();
    const file = new File(book, { ...storedPayload, ...structuredClone(payload), properties: { ...storedPayload?.properties, ...payload.properties } });
    if (!await file.getContent()) throw new HTTPException(400, { message: 'File content is required.' });
    const accountId = file.getProperty('account_id', 'account_id_');
    if (accountId) await requireAccount(book, accountId);
    const groupId = file.getProperty('group_id', 'group_id_');
    if (groupId) {
        const group = await book.getGroup(groupId);
        if (!group || group.getId() !== groupId) throw new HTTPException(400, { message: 'Group does not belong to the target Book.' });
    }
    return file;
}

function apiError(error: unknown): NonNullable<ParseResult['error']> {
    if (error instanceof HTTPException) return { code: error.status === 403 ? 'FORBIDDEN' : 'INVALID_CONTEXT', message: error.message };
    if (error instanceof BkperError && [401, 403, 404].includes(error.code)) return { code: 'FORBIDDEN', message: 'Target Book access is required.' };
    if (error instanceof BkperAIClientError) return { code: error.code, message: error.code === 'usage_limit_exceeded' ? 'Bkper AI allowance is exhausted.' : 'Bkper AI parsing failed.' };
    return { code: 'DEPENDENCY_ERROR', message: 'A parsing dependency failed.' };
}

function applyExtraction(transaction: Transaction, extracted: ExtractedTransaction): void {
    if (!transaction.payload.description?.trim()) transaction.payload.description = extracted.description;
    if (transaction.payload.amount === undefined) transaction.payload.amount = String(extracted.amount);
    if (!transaction.payload.date || transaction.getProperty(AUTO_FILLED_DATE_PROPERTY)) {
        if (extracted.date) transaction.payload.date = extracted.date;
    }
    transaction.payload.properties = {
        ...Object.fromEntries(Object.entries(extracted.properties).map(([key, value]) => [key, String(value)])),
        ...transaction.payload.properties,
    };
}

function asDraft(transaction: Transaction, account?: Account): bkper.Transaction {
    const suppliedCredit = transaction.payload.creditAccount;
    const suppliedDebit = transaction.payload.debitAccount;
    if (account?.getId() !== suppliedCredit?.id && account?.getId() !== suppliedDebit?.id) setAccountBasedOnAmount(transaction, account, transaction.getAmount());
    if (suppliedCredit) transaction.payload.creditAccount = suppliedCredit;
    if (suppliedDebit) transaction.payload.debitAccount = suppliedDebit;
    const payload = transaction.json();
    delete payload.id;
    payload.draft = true;
    payload.posted = false;
    payload.checked = false;
    payload.trashed = false;
    return payload;
}

/** Raw parsing only. Target authorization, inference and local suggestions never record drafts. */
export async function parse(request: ParseRequest, context: AppContext, signal?: AbortSignal): Promise<ParseResult> {
    try {
        signal?.throwIfAborted();
        if (!context.readOnly) throw new HTTPException(400, { message: 'A read-only parsing context is required.' });
        const book = await requireBook(context, request.bookId);
        for (const account of [request.transaction?.creditAccount, request.transaction?.debitAccount]) {
            if (account?.id) await requireAccount(book, account.id);
        }
        const filePayload = request.file ?? request.transaction?.files?.[0];
        const file = filePayload ? await resolveFile(book, filePayload) : undefined;
        signal?.throwIfAborted();
        const transactions: ParseResult['transactions'] = [];
        let fileProperties: ParseResult['fileProperties'];

        if (file && !request.transaction) {
            const extraction = await new FileParserRouter(context).parse(book, file);
            fileProperties = extraction.fileProperties;
            const books = new Map<string, Book>([[request.bookId, book]]);
            for (const value of extraction.transactions) {
                signal?.throwIfAborted();
                const extracted = ExtractedTransactionSchema.parse(value);
                const bookId = extracted.book_id || request.bookId;
                let targetBook = books.get(bookId);
                if (!targetBook) {
                    targetBook = await requireBook(context, bookId);
                    books.set(bookId, targetBook);
                }
                const account = extracted.account_name ? await targetBook.getAccount(extracted.account_name) : bookId === request.bookId ? extraction.account : undefined;
                if (account?.getId()) await requireAccount(targetBook, account.getId()!);
                const transaction = new Transaction(targetBook, {});
                applyExtraction(transaction, extracted);
                transaction.setProperty(AGENT_EXTRACTED_PROPERTY, JSON.stringify(extracted));
                if (file.getId()) transaction.setProperty(AGENT_FILE_ID_PROPERTY, file.getId()!);
                transactions.push({ bookId, transaction: asDraft(transaction, account) });
            }
        } else if (request.transaction) {
            const transaction = new Transaction(book, structuredClone(request.transaction));
            const before = JSON.stringify(transaction.json());
            let account: Account | undefined;
            let extracted: ExtractedTransaction | undefined;
            if (file) {
                const prompts = await context.promptLookupService.lookupPrompts({ book, file, transaction });
                const transactionPrompt = prompts?.getPrompt('transaction');
                account = transactionPrompt?.account ?? prompts?.account;
                const group = transactionPrompt?.group ?? prompts?.group;
                const service = new AttachmentExtractionService(context);
                [extracted, fileProperties] = await Promise.all([
                    !transaction.getAmount() || !transaction.getDescription().trim() ? service.extractAttachedTransaction(book, transaction, file, account, group, transactionPrompt) : Promise.resolve(undefined),
                    service.extractFilePropertiesIfConfigured(book, transaction, file, account, group, prompts?.getPrompt('file')),
                ]);
                if (extracted) applyExtraction(transaction, ExtractedTransactionSchema.parse(extracted));
            }
            if (transaction.payload.amount === undefined) {
                const amount = await context.createExtractorAmount().extract(transaction.getDescription() || '');
                if (amount && amount.gt(0)) transaction.payload.amount = amount.toString();
            }
            if ((!transaction.payload.date || transaction.getProperty(AUTO_FILLED_DATE_PROPERTY)) && !extracted?.date) {
                const date = await context.createExtractorDate().extract(transaction.getDescription() || '');
                if (date) transaction.payload.date = date;
            }
            if (JSON.stringify(transaction.json()) !== before) {
                if (extracted && !transaction.getProperty(AGENT_EXTRACTED_PROPERTY)) transaction.setProperty(AGENT_EXTRACTED_PROPERTY, JSON.stringify(extracted));
                transactions.push({ bookId: request.bookId, transaction: asDraft(transaction, account) });
            }
        }
        signal?.throwIfAborted();
        return ParseResultSchema.parse({
            transactions,
            ...(fileProperties && Object.keys(fileProperties).length ? { fileProperties } : {}),
            outcome: transactions.length || (fileProperties && Object.keys(fileProperties).length) ? 'parsed' : 'empty',
        });
    } catch (error) {
        return {
            transactions: [],
            outcome: 'error',
            error: signal?.aborted ? { code: 'REQUEST_ABORTED', message: 'Parsing request was cancelled.' } : apiError(error),
        };
    }
}
