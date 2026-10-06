/// <reference types="@bkper/bkper-api-types" />

import { describe, expect, it, mock } from 'bun:test';
import { Account, Book, File, Transaction, TransactionList } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { AGENT_EXTRACTED_PROPERTY } from '../../src/constants.js';
import { EventHandlerFileCreated } from '../../src/events/EventHandlerFileCreated.js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';

function createTransactionsWithNativeIds(transactions: Transaction[]): Transaction[] {
    return transactions.map((_transaction, index) => ({
        getId: () => `tx-${index}`,
    } as unknown as Transaction));
}

function createBook(createdTransactions: Transaction[]): Book {
    const book = {
        getId: () => 'book_1',
        getName: () => 'Test Book',
        getFile: mock(async (_id: string) => createFile(book as unknown as Book)),
        getAccount: mock(async (_name: string) => undefined),
        listTransactions: mock(async () => ({
            getItems: () => [],
            getCursor: () => undefined,
            getFirst: () => undefined,
            size: () => 0,
        } as unknown as TransactionList)),
        batchCreateTransactions: mock(async (transactions: Transaction[]) => {
            createdTransactions.push(...transactions);
            return createTransactionsWithNativeIds(transactions);
        }),
    };
    return book as unknown as Book;
}

function createFile(book: Book): File {
    return {
        getId: () => 'file_1',
        getName: () => 'message.jpg',
        getContentType: () => 'image/jpeg',
        getContent: async () => 'base64content==',
        getProperty: (_key: string) => undefined,
        getBook: () => book,
        setProperty: mock((_key: string, _value: string) => undefined),
        update: mock(async () => undefined),
        json: () => ({ id: 'file_1', name: 'message.jpg' }),
    } as unknown as File;
}

function createContext(extractedTransaction: ExtractedTransaction, book: Book): AppContext {
    return {
        env: {},
        bkper: {
            getBook: mock(async (_bookId: string) => book),
        },
        promptLookupService: {
            lookupPrompts: mock(async () => ({
                account: undefined,
                group: undefined,
                getPrompt: (_purpose: string) => undefined,
            })),
            lookupParserUrl: mock(async () => null),
        },
        createDiscovery: () => ({
            discover: mock(async (_transaction: Transaction) => ({ dataSet: undefined })),
            discoverProperties: mock(async (_account: Account, _transaction: Transaction, _dataSet: unknown) => undefined),
        }),
        createExtractorFileClassification: () => ({
            extract: mock(async (_prompt?: string) => ({ kind: 'statement' as const })),
        }),
        createExtractorStatementIMG: () => ({
            extract: mock(async (_prompt?: string) => ({
                transactions: [extractedTransaction],
            })),
        }),
    } as unknown as AppContext;
}

describe('EventHandlerFileCreated null dates', () => {
    // Verifies a null extracted date remains absent from the created transaction and audit payload.
    it('omits the Bkper transaction date when extraction returns null because no clear date exists', async () => {
        const createdTransactions: Transaction[] = [];
        const book = createBook(createdTransactions);
        const extractedTransaction: ExtractedTransaction = {
            date: null,
            description: '$140 paid in full cash',
            amount: 140,
            properties: {},
        };
        const context = createContext(extractedTransaction, book);
        const eventHandler = new EventHandlerFileCreated(context);

        await eventHandler.handleEvent(book, {
            bookId: 'book_1',
            data: { object: { id: 'file_1' } as bkper.File },
        } as bkper.Event);

        expect(createdTransactions).toHaveLength(1);
        expect(createdTransactions[0].getDate()).toBeUndefined();
        expect(createdTransactions[0].json().date).toBeUndefined();

        const extractedJson = createdTransactions[0].getProperty(AGENT_EXTRACTED_PROPERTY);
        expect(extractedJson).toBeDefined();
        const auditedExtraction = JSON.parse(extractedJson ?? '{}') as ExtractedTransaction;
        expect(auditedExtraction.date).toBeNull();
    });
});
