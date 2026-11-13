/// <reference types="@bkper/bkper-api-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Account, Book, File, Transaction, TransactionList } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerFileCreated } from '../../src/events/EventHandlerFileCreated.js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';
import type { DiscoveryBatchOutcome, DiscoveryItem } from '../../src/services/BookbotDiscoveryClient.js';

// Verifies that file imports ask Bookbot for discovery once per target Book and still record drafts when discovery fails.
describe('EventHandlerFileCreated - Bookbot discovery', () => {
    let mockFile: File;
    let mockAccount: Account;
    let mockBook: Book;
    let otherBook: Book;
    let created: Map<string, Transaction[]>;
    let discover: ReturnType<typeof mock<(bookId: string, items: DiscoveryItem[]) => Promise<DiscoveryBatchOutcome>>>;
    let eventHandler: EventHandlerFileCreated;
    let statementRows: ExtractedTransaction[];
    let originalCreate: typeof Transaction.prototype.create;

    function createBook(id: string): Book {
        return {
            getId: () => id,
            getName: () => id,
            getAccount: mock(async () => mockAccount),
            getFile: mock(async () => mockFile),
            listTransactions: mock(async () => ({ getItems: () => [], size: () => 0 } as unknown as TransactionList)),
            batchCreateTransactions: mock(async (transactions: Transaction[]) => {
                created.set(id, transactions);
                return transactions.map((transaction, index) => ({ getId: () => `${id}-tx-${index}`, getDescription: () => transaction.getDescription() } as unknown as Transaction));
            }),
        } as unknown as Book;
    }

    beforeEach(() => {
        created = new Map();
        mockFile = {
            getId: () => 'file_1',
            getName: () => 'statement.csv',
            getContentType: () => 'text/csv',
            getProperty: () => undefined,
            setProperty: mock(() => mockFile),
            update: mock(async () => mockFile),
            getBook: () => mockBook,
            json: () => ({ id: 'file_1' }),
        } as unknown as File;
        mockAccount = {
            getId: () => 'bank',
            getName: () => 'Bank Account',
            getType: () => 'ASSET',
            isCredit: () => false,
            json: () => ({ id: 'bank', name: 'Bank Account', type: 'ASSET' }),
        } as unknown as Account;
        mockBook = createBook('book_1');
        otherBook = createBook('book_2');
        discover = mock(async (_bookId: string, items: DiscoveryItem[]) => ({ outcomes: items.map(() => 'no_match' as const) }));
        statementRows = [];

        const context = {
            env: {},
            bkper: { getBook: mock(async () => otherBook) },
            createBookbotDiscoveryClient: () => ({ discover }),
            createExtractorStatementCSV: () => ({ extract: async () => ({ transactions: statementRows }) }),
            promptLookupService: {
                lookupPrompts: mock(async () => ({
                    account: mockAccount,
                    getPrompt: () => ({ account: mockAccount, promptEntity: mockAccount, targetProperty: 'extractor_prompt_transactions' }),
                })),
                lookupParserUrl: mock(async () => null),
            },
        } as unknown as AppContext;

        originalCreate = Transaction.prototype.create;
        eventHandler = new EventHandlerFileCreated(context);
    });

    afterEach(() => {
        Transaction.prototype.create = originalCreate;
    });

    it('asks Bookbot once per target Book, in recording order, with the source Account', async () => {
        await eventHandler.recordTransactions([
            { date: '2026-10-28', description: 'Monthly rent', amount: -1500, properties: {} },
            { date: '2026-10-05', description: 'Adobe subscription', amount: -60, properties: {} },
            { date: '2026-10-12', description: 'Payment for purchase', amount: -200, properties: {}, book_id: 'book_2' },
        ], mockBook, mockFile, mockAccount);

        expect(discover).toHaveBeenCalledTimes(2);
        const [firstBookId, firstItems] = discover.mock.calls[0];
        expect(firstBookId).toBe('book_1');
        expect(firstItems.map(item => item.transaction.getDescription())).toEqual(['Adobe subscription', 'Monthly rent']);
        expect(firstItems.every(item => item.sourceAccount === mockAccount)).toBe(true);
        expect(firstItems[0].transaction.getProperty('extractor_file_id_')).toBe('file_1');

        const [secondBookId, secondItems] = discover.mock.calls[1];
        expect(secondBookId).toBe('book_2');
        expect(secondItems).toHaveLength(1);
        expect(secondItems[0].sourceAccount).toBeUndefined();

        // The same drafts Bookbot saw are the ones recorded.
        expect(created.get('book_1')).toEqual(firstItems.map(item => item.transaction));
    });

    it('records the drafts and warns when Bookbot discovery fails', async () => {
        discover.mockImplementation(async (_bookId: string, items: DiscoveryItem[]) => ({
            outcomes: items.map(() => 'error' as const),
            error: { code: 'UNAVAILABLE', message: 'Bookbot discovery is unavailable.' },
        }));
        statementRows = [
            { date: '2026-10-28', description: 'Monthly rent', amount: -1500, properties: {} },
            { date: '2026-10-05', description: 'Adobe subscription', amount: -60, properties: {} },
        ];

        const result = await eventHandler.handleEvent(mockBook, { bookId: 'book_1', data: { object: { id: 'file_1' } } } as bkper.Event);

        const drafts = created.get('book_1') ?? [];
        expect(drafts).toHaveLength(2);
        expect(drafts.every(draft => draft.payload.draft === true)).toBe(true);
        expect(drafts.every(draft => !draft.payload.debitAccount)).toBe(true);
        expect(result.result).toBeTruthy();
        expect(result.error).toBeUndefined();
        expect(result.warning).toBe('Account discovery failed for 2 transactions (UNAVAILABLE); recorded as drafts without discovered Accounts or properties.');
    });

    it('does not warn when Bookbot finds no match', async () => {
        statementRows = [{ date: '2026-10-28', description: 'Monthly rent', amount: -1500, properties: {} }];

        const result = await eventHandler.handleEvent(mockBook, { bookId: 'book_1', data: { object: { id: 'file_1' } } } as bkper.Event);

        expect(result.result).toBeTruthy();
        expect(result.warning).toBeUndefined();
    });

    it('asks Bookbot before recording a single invoice draft', async () => {
        const calls: string[] = [];
        discover.mockImplementation(async (_bookId: string, items: DiscoveryItem[]) => {
            calls.push('discover');
            items[0].transaction.payload.debitAccount = { id: 'office' };
            return { outcomes: ['changed' as const] };
        });
        Transaction.prototype.create = mock(async function (this: Transaction) {
            calls.push('create');
            this.payload.id = 'tx_1';
            return this;
        }) as typeof Transaction.prototype.create;

        const recording = await eventHandler.recordTransaction({ date: '2026-10-15', description: 'Office Depot purchase', amount: -45.9, properties: {} }, mockBook, mockFile, mockAccount);

        expect(calls).toEqual(['discover', 'create']);
        const [bookId, items] = discover.mock.calls[0];
        expect(bookId).toBe('book_1');
        expect(items).toHaveLength(1);
        expect(items[0].sourceAccount).toBe(mockAccount);
        expect(items[0].transaction.payload.debitAccount).toEqual({ id: 'office' });
        expect(recording.transactionId).toBe('tx_1');
    });
});
