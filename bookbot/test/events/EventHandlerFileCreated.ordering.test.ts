/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { EventHandlerFileCreated } from '../../src/events/EventHandlerFileCreated.js';
import { Book, File, Account, Transaction, TransactionList } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { ExternalExtractorResult } from '../../src/external-extractor/ExternalExtractorTypes.js';

function createTransactionsWithNativeIds(transactions: Transaction[]): Transaction[] {
    return transactions.map((transaction, index) => ({
        getId: () => `tx-${transaction.getDescription() || index}`,
        getDescription: () => transaction.getDescription(),
    } as unknown as Transaction));
}

// Verifies that transactions are recorded before file.update() is called in the external extractor path.
// file.update() fires a FILE_UPDATED event in Bkper, so transactions must already be persisted when it propagates.
describe('EventHandlerFileCreated - operation ordering', () => {
    let mockBook: Book;
    let mockFile: File;
    let mockAccount: Account;
    let mockContext: AppContext;
    let eventHandler: EventHandlerFileCreated;
    let originalExtract: (...args: any[]) => any;

    // Tracks the sequence in which side-effecting operations are executed
    let callOrder: string[];

    beforeEach(() => {
        callOrder = [];

        mockFile = {
            getId: () => 'file_1',
            getName: () => 'statement.csv',
            getContentType: () => 'text/csv',
            getContent: async () => 'base64content==',
            getProperty: (_key: string) => undefined,
            setProperty: mock((_key: string, _value: string) => mockFile),
            update: mock(async () => {
                callOrder.push('file.update');
                return mockFile;
            }),
            getBook: () => mockBook,
            json: () => ({ id: 'file_1' }),
        } as unknown as File;

        mockAccount = {
            getId: () => 'acc_1',
            getName: () => 'Bank Safra',
            getNormalizedName: () => 'bank safra',
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
            getAccount: mock(async () => mockAccount),
            getFile: mock(async (_id: string) => mockFile),
            listTransactions: mock(async () => ({
                getItems: () => [],
                getCursor: () => undefined,
                getFirst: () => undefined,
                size: () => 0,
            } as unknown as TransactionList)),
            batchCreateTransactions: mock(async (txs: Transaction[]) => {
                callOrder.push('batchCreateTransactions');
                return createTransactionsWithNativeIds(txs);
            }),
        } as unknown as Book;

        mockContext = {
            env: {},
            bkper: {
                getBook: mock(async () => mockBook),
            },
            createDiscovery: () => ({
                discover: mock(async (_tx: Transaction) => ({ dataSet: undefined })),
                discoverProperties: mock(async () => {}),
            }),
            promptLookupService: {
                lookupPrompts: mock(async () => ({
                    account: mockAccount,
                    getPrompt: () => ({ account: mockAccount, promptEntity: mockAccount, targetProperty: 'agent_parser_transactions' }),
                })),
                lookupParserUrl: mock(async ({ purpose }: { purpose: string }) => purpose === 'transactions' ? ({
                    url: 'https://extractor.example.com/extract',
                    source: 'account' as const,
                    account: mockAccount,
                }) : null),
                lookupTransactionsParserUrl: mock(async () => ({
                    url: 'https://extractor.example.com/extract',
                    source: 'account' as const,
                    account: mockAccount,
                })),
            },
        } as unknown as AppContext;

        const { ExternalExtractorClient } = require('../../src/external-extractor/ExternalExtractorClient.js');
        originalExtract = ExternalExtractorClient.prototype.extract;

        eventHandler = new EventHandlerFileCreated(mockContext);
    });

    afterEach(() => {
        const { ExternalExtractorClient } = require('../../src/external-extractor/ExternalExtractorClient.js');
        ExternalExtractorClient.prototype.extract = originalExtract;
    });

    function makeEvent(fileId: string): bkper.Event {
        return {
            bookId: 'book_1',
            data: { object: { id: fileId } as bkper.File },
        } as bkper.Event;
    }

    // Confirms the batch-created transaction results are returned to the orchestration caller.
    it('returns created transaction batches', async () => {
        const extractorResult: ExternalExtractorResult = {
            transactions: [{ date: '2024-01-02', description: 'TREASURY BILL', amount: 179000.0, properties: {} }],
        };

        const createdBatches = await eventHandler.recordTransactions(
            extractorResult.transactions,
            mockBook,
            mockFile,
            mockAccount
        );

        expect(createdBatches).toHaveLength(1);
        expect(createdBatches[0].recordings).toHaveLength(1);
        expect(createdBatches[0].transactions).toHaveLength(1);
        expect(createdBatches[0].transactions[0].getDescription()).toBe('TREASURY BILL');
    });

    // Confirms that transaction creation still completes before the FILE_UPDATED-triggering file update.
    it('records transactions before updating the file summary', async () => {
        const extractorResult: ExternalExtractorResult = {
            transactions: [{ date: '2024-01-02', description: 'TREASURY BILL', amount: 179000.0, properties: {} }],
        };

        const { ExternalExtractorClient } = require('../../src/external-extractor/ExternalExtractorClient.js');
        ExternalExtractorClient.prototype.extract = mock(async () => extractorResult);

        await eventHandler.handleEvent(mockBook, makeEvent('file_1'));

        expect(callOrder).toEqual(['batchCreateTransactions', 'file.update']);
    });
});
