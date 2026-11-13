/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { EventHandlerFileCreated } from '../../src/events/EventHandlerFileCreated.js';
import { Book, File, Account, Transaction, TransactionList } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';
import { createNoMatchBookbotDiscoveryClient } from '../helpers/bookbot-discovery.js';

function createTransactionsWithNativeIds(transactions: Transaction[]): Transaction[] {
    return transactions.map((transaction, index) => ({
        getId: () => `tx-${transaction.getDescription() || index}`,
    } as unknown as Transaction));
}

describe('EventHandlerFileCreated - file properties', () => {
    let mockBook: Book;
    let mockFile: File;
    let mockAccount: Account;
    let mockContext: AppContext;
    let eventHandler: EventHandlerFileCreated;

    // Controlled stub for what extraction returns in each test
    let extractorResult: { transactions: ExtractedTransaction[] };
    let filePropertiesResult: Record<string, string> | undefined;

    // Tracks calls to file.setProperty and file.update for assertion
    let fileSetPropertyCalls: Array<[string, string]>;
    let fileUpdateCallCount: number;

    beforeEach(() => {
        fileSetPropertyCalls = [];
        fileUpdateCallCount = 0;

        extractorResult = {
            transactions: [{ date: '2024-01-02', description: 'TREASURY BILL', amount: 179000.0, properties: {} }],
        };
        filePropertiesResult = undefined;

        mockFile = {
            getId: () => 'file_1',
            getName: () => 'statement.csv',
            getContentType: () => 'text/csv',
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
            batchCreateTransactions: mock(async (txs: Transaction[]) => createTransactionsWithNativeIds(txs)),
        } as unknown as Book;

        mockContext = {
            env: {},
            bkper: {
                getBook: mock(async () => mockBook),
            },
            createBookbotDiscoveryClient: () => createNoMatchBookbotDiscoveryClient(),
            createExtractorStatementCSV: () => ({ extract: async () => extractorResult }),
            createExtractorFileProperties: () => ({ extract: async () => filePropertiesResult ? { properties: filePropertiesResult } : undefined }),
            promptLookupService: {
                lookupPrompts: mock(async () => ({
                    account: mockAccount,
                    getPrompt: (purpose: string) => purpose === 'file'
                        ? { prompt: 'Extract statement details', account: mockAccount, promptEntity: mockAccount, sourceProperty: 'extractor_prompt_file', targetProperty: 'extractor_prompt_file' }
                        : { account: mockAccount, promptEntity: mockAccount, targetProperty: 'extractor_prompt_transactions' },
                })),
                lookupParserUrl: mock(async () => null),
            },
        } as unknown as AppContext;

        eventHandler = new EventHandlerFileCreated(mockContext);
    });

    function makeEvent(fileId: string): bkper.Event {
        return {
            bookId: 'book_1',
            data: { object: { id: fileId } as bkper.File },
        } as bkper.Event;
    }

    // Verifies every key-value pair from the purpose-specific file parser is applied to the file
    // via file.setProperty(key, value) so the file object is fully enriched.
    it('sets each file property returned by the configured file parser on the file object', async () => {
        filePropertiesResult = {
            statement_period: '2024-01',
            bank_name: 'Safra',
            account_number: '3384',
        };

        await eventHandler.handleEvent(mockBook, makeEvent('file_1'));

        expect(fileSetPropertyCalls).toContainEqual(['statement_period', '2024-01']);
        expect(fileSetPropertyCalls).toContainEqual(['bank_name', 'Safra']);
        expect(fileSetPropertyCalls).toContainEqual(['account_number', '3384']);
    });

    // Verifies the handler result includes the written file properties when no transactions are returned.
    it('includes file properties when the parser returns properties and no transactions', async () => {
        extractorResult = { transactions: [] };
        filePropertiesResult = {
            statement_period: '2024-01',
            bank_name: 'Safra',
            account_number: '3384',
        };

        const result = await eventHandler.handleEvent(mockBook, makeEvent('file_1'));

        expect(result).toEqual({
            result: {
                prompt: undefined,
                transactions: [],
                fileProperties: {
                    account_number: '3384',
                    bank_name: 'Safra',
                    statement_period: '2024-01',
                },
            },
        });
        expect(mockBook.batchCreateTransactions).not.toHaveBeenCalled();
        expect(fileUpdateCallCount).toBe(1);
    });

    // Verifies a file-property parser failure prevents both transaction creation and file updates.
    it('does not record transactions when configured file parser fails before writes', async () => {
        Object.assign(mockContext, {
            createExtractorFileProperties: () => ({
                extract: async () => {
                    throw new Error('file parser failed');
                },
            }),
        });

        const result = await eventHandler.handleEvent(mockBook, makeEvent('file_1'));

        expect(result.error).toContain('file parser failed');
        expect(mockBook.batchCreateTransactions).not.toHaveBeenCalled();
        expect(fileUpdateCallCount).toBe(0);
    });

});
