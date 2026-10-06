/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { EventHandlerFileCreated } from '../../src/events/EventHandlerFileCreated.js';
import { Book, File, Account, Transaction, TransactionList } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { ExternalExtractorResult } from '../../src/external-extractor/ExternalExtractorTypes.js';

const SUMMARY_PROPERTY_KEY = 'transactions_summary';

type SummaryEntry = {
    bookId: string;
    accountId: string;
    total_transactions: number;
    transactionIds: string[];
};

function sortedIds(ids: string[]): string[] {
    return [...ids].sort();
}

function expectSameIds(actual: string[], expected: string[]): void {
    expect(sortedIds(actual)).toEqual(sortedIds(expected));
}

function expectNoRemoteIds(transactions: Transaction[]): void {
    expect(transactions.every(transaction => transaction.getRemoteIds().length === 0)).toBe(true);
}

function createTransactionsWithNativeIds(transactions: Transaction[]): Transaction[] {
    return transactions.map(transaction => ({
        getId: () => `tx-${transaction.getDescription()}`,
    } as unknown as Transaction));
}

describe('EventHandlerFileCreated - transactions_summary', () => {
    let mockBook: Book;
    let mockFile: File;
    let mockAccount: Account;
    let mockContext: AppContext;
    let eventHandler: EventHandlerFileCreated;
    let originalExtract: (...args: any[]) => any;
    let originalExtractFileProperties: (...args: any[]) => any;
    let originalTransactionCreate: typeof Transaction.prototype.create;

    // Spy surfaces for assertions
    let fileSetPropertyCalls: Array<[string, string]>;
    let fileUpdateCallCount: number;

    // Controlled extractor result — overridden per test
    let extractorResult: ExternalExtractorResult;
    let filePropertiesResult: Record<string, string> | undefined;
    let genAITransactions: ExternalExtractorResult['transactions'];
    let useExternalTransactionsParser: boolean;

    beforeEach(() => {
        fileSetPropertyCalls = [];
        fileUpdateCallCount = 0;
        originalTransactionCreate = Transaction.prototype.create;

        mockFile = {
            getId: () => 'file_1',
            getName: () => 'statement.pdf',
            getContentType: () => 'application/pdf',
            getContent: async () => 'base64content==',
            getProperty: (_key: string) => undefined,
            setProperty: mock((key: string, value: string) => {
                fileSetPropertyCalls.push([key, value]);
                return mockFile;
            }),
            update: mock(async () => {
                fileUpdateCallCount++;
                return mockFile;
            }),
            getBook: () => mockBook,
            json: () => ({ id: 'file_1' }),
        } as unknown as File;

        mockAccount = {
            getId: () => 'acc_1',
            getName: () => 'Bank',
            getNormalizedName: () => 'bank',
            getType: () => 'ASSET',
            isCredit: () => false,
            isPermanent: () => true,
            isArchived: () => false,
            hasTransactionPosted: () => false,
            getGroups: async () => [],
            getVisibleProperties: () => ({}),
        } as unknown as Account;

        mockBook = {
            getId: () => 'book_1',
            getName: () => 'My Book',
            getAccount: mock(async (name: string) => {
                if (name === 'Bank') return mockAccount;
                return undefined;
            }),
            getFile: mock(async (_id: string) => mockFile),
            listTransactions: mock(async () => ({
                getItems: () => [],
                getCursor: () => undefined,
                getFirst: () => undefined,
                size: () => 0,
            } as unknown as TransactionList)),
            batchCreateTransactions: mock(async (txs: Transaction[]) => createTransactionsWithNativeIds(txs)),
        } as unknown as Book;

        extractorResult = {
            transactions: [{ date: '2024-01-01', description: 'Tx 1', amount: 100, properties: {} }],
        };
        filePropertiesResult = undefined;
        genAITransactions = [];
        useExternalTransactionsParser = true;

        mockContext = {
            env: {},
            bkper: {
                getBook: mock(async (_bookId: string) => mockBook),
            },
            createDiscovery: () => ({
                discover: mock(async (_tx: Transaction) => ({ dataSet: undefined })),
                discoverProperties: mock(async () => {}),
            }),
            createExtractorFileClassification: () => ({
                extract: mock(async () => ({ kind: 'statement' as const })),
            }),
            createExtractorStatementIMG: () => ({
                extract: mock(async () => ({ transactions: genAITransactions })),
            }),
            promptLookupService: {
                lookupPrompts: mock(async () => ({
                    account: mockAccount,
                    getPrompt: () => ({ account: mockAccount, promptEntity: mockAccount, targetProperty: 'agent_parser_transactions' }),
                })),
                lookupParserUrl: mock(async ({ purpose }: { purpose: string }) => {
                    if (purpose === 'transactions' && useExternalTransactionsParser) {
                        return {
                            url: 'https://extractor.example.com/extract',
                            source: 'account' as const,
                            account: mockAccount,
                        };
                    }
                    if (purpose === 'file' && filePropertiesResult) {
                        return {
                            url: 'https://extractor.example.com/extract-file',
                            source: 'account' as const,
                            account: mockAccount,
                        };
                    }
                    return null;
                }),
                lookupTransactionsParserUrl: mock(async () => ({
                    url: 'https://extractor.example.com/extract',
                    source: 'account' as const,
                    account: mockAccount,
                })),
            },
        } as unknown as AppContext;

        const { ExternalExtractorClient } = require('../../src/external-extractor/ExternalExtractorClient.js');
        originalExtract = ExternalExtractorClient.prototype.extract;
        originalExtractFileProperties = ExternalExtractorClient.prototype.extractFileProperties;
        ExternalExtractorClient.prototype.extract = mock(async () => extractorResult);
        ExternalExtractorClient.prototype.extractFileProperties = mock(async () => filePropertiesResult);

        eventHandler = new EventHandlerFileCreated(mockContext);
    });

    afterEach(() => {
        const { ExternalExtractorClient } = require('../../src/external-extractor/ExternalExtractorClient.js');
        ExternalExtractorClient.prototype.extract = originalExtract;
        ExternalExtractorClient.prototype.extractFileProperties = originalExtractFileProperties;
        Transaction.prototype.create = originalTransactionCreate;
    });

    function makeEvent(fileId = 'file_1'): bkper.Event {
        return {
            bookId: 'book_1',
            data: { object: { id: fileId } as bkper.File },
        } as bkper.Event;
    }

    // Parses the transactions_summary property value set on the file
    function getSummary(): SummaryEntry[] {
        const call = fileSetPropertyCalls.find(([key]) => key === SUMMARY_PROPERTY_KEY);
        if (!call) return [];
        return JSON.parse(call[1]);
    }

    function configureSingleTransactionParser(amount: number): void {
        useExternalTransactionsParser = false;
        Object.assign(mockContext, {
            createExtractorFileClassification: () => ({
                extract: async () => ({ kind: 'single_transaction' as const }),
            }),
            createExtractorInvoice: () => ({
                extract: async () => ({
                    date: '2024-01-01',
                    description: 'Invoice Tx',
                    amount,
                    properties: {},
                }),
            }),
        });
        Transaction.prototype.create = async function (this: Transaction): Promise<Transaction> {
            (this as unknown as { payload: { id?: string } }).payload.id = 'tx-Invoice Tx';
            return this;
        };
    }

    it('skips parsing when the freshly fetched file already has a transactions_summary property', async () => {
        mockFile.getProperty = mock((key: string) => key === SUMMARY_PROPERTY_KEY ? '[]' : undefined);

        const result = await eventHandler.handleEvent(mockBook, makeEvent());

        expect(result.result).toBe(false);
        expect(mockContext.promptLookupService.lookupPrompts).not.toHaveBeenCalled();
        expect(mockBook.batchCreateTransactions).not.toHaveBeenCalled();
        expect(fileUpdateCallCount).toBe(0);
    });

    // Verifies the summary is written to the file under the correct property key
    it('sets the transactions_summary property on the file', async () => {
        await eventHandler.handleEvent(mockBook, makeEvent());

        const keys = fileSetPropertyCalls.map(([key]) => key);
        expect(keys).toContain(SUMMARY_PROPERTY_KEY);
    });

    // Verifies the property value is a valid JSON-serialised array so consumers can parse it reliably
    it('stores the summary as a JSON array string', async () => {
        await eventHandler.handleEvent(mockBook, makeEvent());

        const call = fileSetPropertyCalls.find(([key]) => key === SUMMARY_PROPERTY_KEY);
        expect(call).toBeDefined();
        const parsed = JSON.parse(call![1]);
        expect(Array.isArray(parsed)).toBe(true);
    });

    // All transactions belong to the same book and use the default account → exactly one summary entry
    it('produces one summary entry when all transactions share the same book and default account', async () => {
        extractorResult = {
            transactions: [
                { date: '2024-01-03', description: 'Tx 1', amount: 100, properties: {} },
                { date: '2024-01-01', description: 'Tx 2', amount: 200, properties: {} },
                { date: '2024-01-02', description: 'Tx 3', amount: 300, properties: {} },
            ],
        };

        await eventHandler.handleEvent(mockBook, makeEvent());
        const summary = getSummary();

        expect(summary.length).toBe(1);
        expect(summary[0].bookId).toBe('book_1');
        expect(summary[0].accountId).toBe('acc_1');
        expect(summary[0].total_transactions).toBe(3);
        expectSameIds(summary[0].transactionIds, [
            'tx-Tx 1',
            'tx-Tx 2',
            'tx-Tx 3',
        ]);

        const createdTransactions = (mockBook.batchCreateTransactions as any).mock.calls[0][0] as Transaction[];
        expectNoRemoteIds(createdTransactions);
    });

    // Zero-amount transactions are still recorded, but they must not increase the summary count.
    it('excludes zero amount transactions from the summary totals', async () => {
        extractorResult = {
            transactions: [
                { date: '2024-01-01', description: 'Tx 1', amount: 100, properties: {} },
                { date: '2024-01-02', description: 'Zero Tx', amount: 0, properties: {} },
                { date: '2024-01-03', description: 'String Zero Tx', amount: '0.00' as unknown as number, properties: {} },
                { date: '2024-01-04', description: 'Tx 2', amount: -25, properties: {} },
            ],
        };

        await eventHandler.handleEvent(mockBook, makeEvent());
        const summary = getSummary();
        const batchCreateMock = mockBook.batchCreateTransactions as any;
        const createdTransactions = batchCreateMock.mock.calls[0][0];

        expect(createdTransactions.length).toBe(4);
        expectNoRemoteIds(createdTransactions);
        expect(summary).toHaveLength(1);
        expect(summary[0]).toMatchObject({
            bookId: 'book_1',
            accountId: 'acc_1',
            total_transactions: 2,
        });
        expectSameIds(summary[0].transactionIds, ['tx-Tx 1', 'tx-Tx 2']);
    });

    // When every extracted transaction has zero amount, no summary property needs to be persisted.
    it('does not set summary property when all extracted transactions are zero amount', async () => {
        extractorResult = {
            transactions: [
                { date: '2024-01-01', description: 'Zero Tx 1', amount: 0, properties: {} },
                { date: '2024-01-02', description: 'Zero Tx 2', amount: '0' as unknown as number, properties: {} },
            ],
        };

        await eventHandler.handleEvent(mockBook, makeEvent());

        const hasSummary = fileSetPropertyCalls.some(([key]) => key === SUMMARY_PROPERTY_KEY);
        expect(hasSummary).toBe(false);
        expect(fileUpdateCallCount).toBe(0);
        expect(mockBook.batchCreateTransactions).toHaveBeenCalled();
        const createdTransactions = (mockBook.batchCreateTransactions as any).mock.calls[0][0] as Transaction[];
        expectNoRemoteIds(createdTransactions);
    });

    // Transactions targeting two different accounts in the same book produce two entries (one per pair)
    it('produces one entry per (bookId, accountId) pair when transactions use different accounts', async () => {
        const altAccount = {
            getId: () => 'acc_2',
            getName: () => 'Credit Card',
            getType: () => 'LIABILITY',
        } as unknown as Account;

        // Override getAccount to resolve both account names
        (mockBook.getAccount as any) = mock(async (name: string) => {
            if (name === 'Bank') return mockAccount;
            if (name === 'Credit Card') return altAccount;
            return undefined;
        });

        extractorResult = {
            transactions: [
                { date: '2024-01-01', description: 'Bank Tx 1', amount: 100, properties: {}, account_name: 'Bank' },
                { date: '2024-01-02', description: 'Bank Tx 2', amount: 200, properties: {}, account_name: 'Bank' },
                { date: '2024-01-03', description: 'CC Tx',     amount: 50,  properties: {}, account_name: 'Credit Card' },
            ],
        };

        await eventHandler.handleEvent(mockBook, makeEvent());
        const summary = getSummary();

        expect(summary.length).toBe(2);

        const bankEntry = summary.find(e => e.accountId === 'acc_1');
        expect(bankEntry).toBeDefined();
        expect(bankEntry!.bookId).toBe('book_1');
        expect(bankEntry!.total_transactions).toBe(2);
        expectSameIds(bankEntry!.transactionIds, ['tx-Bank Tx 1', 'tx-Bank Tx 2']);

        const ccEntry = summary.find(e => e.accountId === 'acc_2');
        expect(ccEntry).toBeDefined();
        expect(ccEntry!.bookId).toBe('book_1');
        expect(ccEntry!.total_transactions).toBe(1);
        expectSameIds(ccEntry!.transactionIds, ['tx-CC Tx']);
    });

    // Transactions with book_id pointing to a different book produce separate entries with the correct bookId
    it('produces separate summary entries for transactions targeting different books', async () => {
        const book2Account = {
            getId: () => 'acc_book2',
            getName: () => 'Savings',
            getType: () => 'ASSET',
        } as unknown as Account;

        const mockBook2 = {
            getId: () => 'book_2',
            getName: () => 'Book 2',
            getAccount: mock(async (name: string) => (name === 'Savings' ? book2Account : undefined)),
            batchCreateTransactions: mock(async (txs: Transaction[]) => createTransactionsWithNativeIds(txs)),
        } as unknown as Book;

        // Return the correct book when fetched by ID
        (mockContext.bkper.getBook as any) = mock(async (bookId: string) => (bookId === 'book_2' ? mockBook2 : mockBook));

        extractorResult = {
            transactions: [
                { date: '2024-01-01', description: 'Book1 Tx', amount: 100, properties: {} },
                { date: '2024-01-02', description: 'Book2 Tx', amount: 200, properties: {}, book_id: 'book_2', account_name: 'Savings' },
            ],
        };

        await eventHandler.handleEvent(mockBook, makeEvent());
        const summary = getSummary();

        expect(summary.length).toBe(2);

        const book1Entry = summary.find(e => e.bookId === 'book_1');
        expect(book1Entry).toBeDefined();
        expect(book1Entry!.accountId).toBe('acc_1');
        expect(book1Entry!.total_transactions).toBe(1);
        expectSameIds(book1Entry!.transactionIds, ['tx-Book1 Tx']);

        const book2Entry = summary.find(e => e.bookId === 'book_2');
        expect(book2Entry).toBeDefined();
        expect(book2Entry!.accountId).toBe('acc_book2');
        expect(book2Entry!.total_transactions).toBe(1);
        expectSameIds(book2Entry!.transactionIds, ['tx-Book2 Tx']);
    });

    // A cross-book transaction with no account_name cannot be resolved to an account;
    // the entry must use an empty string for accountId rather than failing or omitting the entry
    it('uses empty string for accountId when a cross-book transaction has no account_name', async () => {
        const mockBook2 = {
            getId: () => 'book_2',
            getName: () => 'Book 2',
            getAccount: mock(async () => undefined),
            batchCreateTransactions: mock(async (txs: Transaction[]) => createTransactionsWithNativeIds(txs)),
        } as unknown as Book;

        (mockContext.bkper.getBook as any) = mock(async (bookId: string) => (bookId === 'book_2' ? mockBook2 : mockBook));

        extractorResult = {
            transactions: [
                { date: '2024-01-01', description: 'Book2 Tx no account', amount: 200, properties: {}, book_id: 'book_2' },
            ],
        };

        await eventHandler.handleEvent(mockBook, makeEvent());
        const summary = getSummary();

        const book2Entry = summary.find(e => e.bookId === 'book_2');
        expect(book2Entry).toBeDefined();
        expect(book2Entry!.accountId).toBe('');
        expectSameIds(book2Entry!.transactionIds, ['tx-Book2 Tx no account']);
    });

    // Resolves accountId by looking up the account_name in the target book — not the default account passed in
    it('resolves accountId from the target book when account_name is specified on a cross-book transaction', async () => {
        const book2Account = {
            getId: () => 'acc_resolved_from_book2',
            getName: () => 'Investments',
            getType: () => 'ASSET',
        } as unknown as Account;

        const mockBook2 = {
            getId: () => 'book_2',
            getAccount: mock(async (name: string) => (name === 'Investments' ? book2Account : undefined)),
            batchCreateTransactions: mock(async (txs: Transaction[]) => createTransactionsWithNativeIds(txs)),
        } as unknown as Book;

        (mockContext.bkper.getBook as any) = mock(async (bookId: string) => (bookId === 'book_2' ? mockBook2 : mockBook));

        extractorResult = {
            transactions: [
                { date: '2024-01-01', description: 'Investment Tx', amount: 500, properties: {}, book_id: 'book_2', account_name: 'Investments' },
            ],
        };

        await eventHandler.handleEvent(mockBook, makeEvent());
        const summary = getSummary();

        const book2Entry = summary.find(e => e.bookId === 'book_2');
        expect(book2Entry).toBeDefined();
        // accountId must come from the resolved account in book_2, NOT from the default mockAccount
        expect(book2Entry!.accountId).toBe('acc_resolved_from_book2');
        expect(book2Entry!.accountId).not.toBe('acc_1');
        expectSameIds(book2Entry!.transactionIds, ['tx-Investment Tx']);
    });

    // Verifies GenAI multi-transaction parser results use the same native-ID summary path.
    it('sets the summary property for GenAI multi-transaction parser results', async () => {
        useExternalTransactionsParser = false;
        genAITransactions = [
            { date: '2024-01-01', description: 'AI Tx 1', amount: 100, properties: {} },
            { date: '2024-01-02', description: 'AI Tx 2', amount: 200, properties: {} },
        ];

        await eventHandler.handleEvent(mockBook, makeEvent());
        const summary = getSummary();

        expect(summary).toHaveLength(1);
        expect(summary[0]).toMatchObject({
            bookId: 'book_1',
            accountId: 'acc_1',
            total_transactions: 2,
        });
        expectSameIds(summary[0].transactionIds, ['tx-AI Tx 1', 'tx-AI Tx 2']);
        const createdTransactions = (mockBook.batchCreateTransactions as any).mock.calls[0][0] as Transaction[];
        expectNoRemoteIds(createdTransactions);
        expect(fileUpdateCallCount).toBe(1);
    });

    it('creates a one-entry transactions_summary for a non-zero single-transaction extraction', async () => {
        configureSingleTransactionParser(125);

        await eventHandler.handleEvent(mockBook, makeEvent());

        expect(getSummary()).toEqual([{
            bookId: 'book_1',
            accountId: 'acc_1',
            total_transactions: 1,
            transactionIds: ['tx-Invoice Tx'],
        }]);
        expect(mockBook.batchCreateTransactions).not.toHaveBeenCalled();
        expect(fileUpdateCallCount).toBe(1);
    });

    it('preserves the zero-amount rule for single-transaction summaries', async () => {
        configureSingleTransactionParser(0);

        await eventHandler.handleEvent(mockBook, makeEvent());

        expect(getSummary()).toEqual([]);
        expect(fileUpdateCallCount).toBe(0);
    });

    // When transactions are recorded but file metadata is absent, file.update() must still be called
    // to persist the summary property.
    it('calls file.update() when transactions are recorded even if file metadata is absent', async () => {
        extractorResult = {
            transactions: [{ date: '2024-01-01', description: 'Tx', amount: 100, properties: {} }],
        };

        await eventHandler.handleEvent(mockBook, makeEvent());

        expect(fileUpdateCallCount).toBe(1);
    });

    // When both transactions and purpose-specific file properties are present, file.update() must be called exactly once —
    // the summary property and file properties must be saved in the same API call, not separately
    it('calls file.update() exactly once when both transactions and file properties are present', async () => {
        extractorResult = {
            transactions: [{ date: '2024-01-01', description: 'Tx', amount: 100, properties: {} }],
        };
        filePropertiesResult = { statement_period: '2024-01' };

        await eventHandler.handleEvent(mockBook, makeEvent());

        expect(fileUpdateCallCount).toBe(1);
    });

    // When both summary and purpose-specific file properties are set, a single file.update() must persist both together
    it('saves summary and file properties in a single file.update() call', async () => {
        extractorResult = {
            transactions: [{ date: '2024-01-01', description: 'Tx', amount: 100, properties: {} }],
        };
        filePropertiesResult = { statement_period: '2024-01', bank_name: 'Safra' };

        await eventHandler.handleEvent(mockBook, makeEvent());

        const hasSummary = fileSetPropertyCalls.some(([key]) => key === SUMMARY_PROPERTY_KEY);
        const hasStatementPeriod = fileSetPropertyCalls.some(([key]) => key === 'statement_period');
        expect(hasSummary).toBe(true);
        expect(hasStatementPeriod).toBe(true);
        expect(fileUpdateCallCount).toBe(1);
    });

    // When the extractor returns no transactions, neither the summary nor file.update() should be triggered
    it('does not set summary property or call file.update() when no transactions are extracted', async () => {
        extractorResult = {
            transactions: [],
        };

        await eventHandler.handleEvent(mockBook, makeEvent());

        const hasSummary = fileSetPropertyCalls.some(([key]) => key === SUMMARY_PROPERTY_KEY);
        expect(hasSummary).toBe(false);
        expect(fileUpdateCallCount).toBe(0);
    });
});
