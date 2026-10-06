import { Account, BkperError, Book, Permission, Transaction } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import { AppContext } from '../AppContext.js';
import { BkperAIClientError } from '../genai/BkperAIClientError.js';
import { Discovery, MAX_EXTERNAL_REQUESTS } from '../services/DiscoveryService.js';
import type { DiscoveryItem, DiscoveryResult } from './schemas.js';

const READ_PERMISSIONS: readonly Permission[] = [Permission.VIEWER, Permission.POSTER, Permission.EDITOR, Permission.OWNER];

async function requireAccount(book: Book, id: string): Promise<Account> {
    const account = await book.getAccount(id);
    if (!account || account.getId() !== id) {
        throw new HTTPException(400, { message: 'Account does not belong to the target Book.' });
    }
    return account;
}

function apiError(error: unknown): NonNullable<DiscoveryResult['error']> {
    if (error instanceof HTTPException) {
        return { code: error.status === 403 ? 'FORBIDDEN' : 'INVALID_ACCOUNT', message: error.message };
    }
    if (error instanceof BkperError && [401, 403, 404].includes(error.code)) {
        return { code: 'FORBIDDEN', message: 'Target Book access is required.' };
    }
    if (error instanceof BkperAIClientError) {
        return { code: error.code, message: error.code === 'usage_limit_exceeded' ? 'Bkper AI allowance is exhausted.' : 'Bkper AI discovery failed.' };
    }
    return { code: 'DEPENDENCY_ERROR', message: 'A discovery dependency failed.' };
}

/** Read-only adapter. Each Book retains its existing discovery caches and request limit. */
export async function discoverItems(items: DiscoveryItem[], context: AppContext, signal?: AbortSignal): Promise<DiscoveryResult[]> {
    const books = new Map<string, { book: Book; discovery: Discovery }>();
    const results: DiscoveryResult[] = [];
    let username: Promise<string | undefined> | undefined;

    for (const item of items) {
        const result: DiscoveryResult = {
            itemId: item.itemId,
            bookId: item.bookId,
            transaction: structuredClone(item.transaction),
            outcome: 'error',
        };
        try {
            signal?.throwIfAborted();
            let state = books.get(item.bookId);
            if (!state) {
                const book = await context.bkper.getBook(item.bookId);
                if (book.getId() !== item.bookId || !READ_PERMISSIONS.includes(book.getPermission())) {
                    throw new HTTPException(403, { message: 'Read access to the target Book is required.' });
                }
                // Rethrow swallowed failures only for the API; legacy callers keep their existing behavior.
                state = { book, discovery: new Discovery(context, error => { throw error; }) };
                books.set(item.bookId, state);
            }
            const { book, discovery } = state;
            for (const account of [item.transaction.creditAccount, item.transaction.debitAccount]) {
                if (account?.id) await requireAccount(book, account.id);
            }
            const sourceAccount = item.sourceAccount?.id ? await requireAccount(book, item.sourceAccount.id) : undefined;
            const draft = new Transaction(book, structuredClone(item.transaction));

            // Creator is a search hint only, never an execution or billing identity.
            if (draft.payload.createdBy) {
                username ??= context.bkper.getUser().then(user => user.getUsername());
                if (draft.payload.createdBy !== await username) {
                    const stored = draft.getId() ? await book.getTransaction(draft.getId()!) : undefined;
                    if (stored?.getCreatedBy() !== draft.payload.createdBy) delete draft.payload.createdBy;
                }
            }
            signal?.throwIfAborted();
            if (discovery.getExternalRequestCount() > MAX_EXTERNAL_REQUESTS) {
                result.error = { code: 'DISCOVERY_LIMIT', message: 'The existing discovery request limit was reached for this Book.' };
            } else {
                const discoveryResult = await discovery.discover(draft);
                if (sourceAccount && discoveryResult.dataSet) {
                    await discovery.discoverProperties(sourceAccount, draft, discoveryResult.dataSet);
                }
                signal?.throwIfAborted();
                for (const account of [draft.payload.creditAccount, draft.payload.debitAccount]) {
                    if (account?.id) await requireAccount(book, account.id);
                }
                signal?.throwIfAborted();
                const transaction = draft.json();
                // Restore only the creator hint excluded from lookup, not discovery's metadata changes.
                transaction.createdBy = item.transaction.createdBy;
                if (item.transaction.createdBy === undefined) delete transaction.createdBy;
                result.transaction = transaction;
                result.outcome = discoveryResult.discovered ? 'changed' :
                    (item.transaction.creditAccount?.id && item.transaction.debitAccount?.id) || !item.transaction.description?.trim() ? 'no_change' : 'no_match';
            }
        } catch (error) {
            result.error = signal?.aborted ? { code: 'REQUEST_ABORTED', message: 'Discovery request was cancelled.' } : apiError(error);
        }
        results.push(result);
    }
    return results;
}
