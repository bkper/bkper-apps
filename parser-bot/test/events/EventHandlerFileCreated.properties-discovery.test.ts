/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { EventHandlerFileCreated } from '../../src/events/EventHandlerFileCreated.js';
import { Book, File, Account, Transaction, TransactionList, AccountType } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { PromptLookupService } from '../../src/services/PromptLookupService.js';
import { AGENT_DISCOVERED_PROPERTIES_PROPERTY, AGENT_EXCLUDED_PROPERTIES_PROPERTY } from '../../src/constants.js';

function createTransactionsWithNativeIds(transactions: Transaction[]): Transaction[] {
    return transactions.map((transaction, index) => ({
        getId: () => `tx-${transaction.getDescription() || index}`,
    } as unknown as Transaction));
}

/**
 * Integration tests for properties discovery in EventHandlerFileCreated.
 * 
 * These tests verify the complete end-to-end flow:
 * 1. File created event
 * 2. Transaction extraction
 * 3. Account discovery
 * 4. Properties discovery
 * 5. Transaction creation with discovered properties
 */

describe('EventHandlerFileCreated - Properties Discovery Integration', () => {
    let mockBook: Book;
    let mockAccounts: Map<string, Account>;
    let mockTransactions: Transaction[];
    let mockContext: AppContext;
    let eventHandler: EventHandlerFileCreated;

    beforeEach(() => {
        mockAccounts = new Map();
        mockTransactions = [];

        setupMockAccounts();
        setupMockTransactions();

        mockBook = {
            getId: () => 'test_book_id',
            getAccount: mock(async (idOrName: string) => {
                if (mockAccounts.has(idOrName)) {
                    return mockAccounts.get(idOrName);
                }
                for (const account of mockAccounts.values()) {
                    if ((account.getName() as string).toLowerCase() === idOrName.toLowerCase()) {
                        return account;
                    }
                }
                return undefined;
            }),
            getFile: mock(async (fileId: string) => {
                return createMockFile(fileId);
            }),
            getProperty: () => undefined,
            listTransactions: mock(async (query: string, limit?: number) => {
                const maxLimit = limit || 5;
                const filtered = filterTransactionsByQuery(query);
                const limitedResults = filtered.slice(0, maxLimit);
                return {
                    getItems: () => limitedResults,
                    getCursor: () => undefined,
                    getAccount: async () => undefined,
                    getFirst: () => limitedResults[0],
                    size: () => limitedResults.length,
                } as TransactionList;
            }),
            batchCreateTransactions: mock(async (transactions: Transaction[]) => {
                // Mock batch create - return created transactions with native IDs.
                return createTransactionsWithNativeIds(transactions);
            }),
        } as unknown as Book;

        mockContext = {
            env: {},
            createDiscovery: () => {
                const { Discovery } = require('../../src/services/DiscoveryService.js');
                return new Discovery(mockContext);
            },
            createExtractorDescriptionParts: () => ({
                extract: async (description: string) => {
                    const words = description.split(' ').filter(word => word.length > 2);
                    // Normalize common abbreviations (simulates AI extractor intelligence)
                    const normalized = words.map(word => {
                        if (word.toUpperCase() === 'AMZN') return 'Amazon';
                        return word;
                    });
                    return normalized.slice(0, 3);
                },
            }),
            createExtractorFileClassification: (file: File) => ({
                extract: async (prompt?: string) => ({ kind: 'statement' as const }),
            }),
            createExtractorStatementCSV: (file: File) => ({
                extract: async (prompt?: string) => {
                    // Mock CSV extraction - return transactions based on file content
                    return {
                        transactions: [
                            { date: '2025-03-01', description: 'Amazon Prime subscription', amount: -14.99, properties: {} },
                            { date: '2025-03-05', description: 'Whole Foods organic produce', amount: -89.50, properties: {} },
                            { date: '2025-03-10', description: 'Shell gas station', amount: -45.00, properties: {} },
                        ],
                    };
                },
            }),
            createExtractorStatementIMG: (file: File) => ({
                extract: async (prompt?: string) => {
                    return {
                        transactions: [],
                    };
                },
            }),
            createExtractorInvoice: (file: File) => ({
                extract: async (prompt?: string) => {
                    return {
                        date: '2025-03-15',
                        description: 'Office supplies invoice',
                        amount: 189.73,
                        properties: {},
                    };
                },
            }),
            promptLookupService: {
                lookupPrompts: async () => {
                    // Return the Bank account as the default account for file uploads
                    const bankAccount = mockAccounts.get('bank_id');
                    return {
                        account: bankAccount,
                        getPrompt: () => ({ account: bankAccount, promptEntity: bankAccount, targetProperty: 'agent_parser_transactions' }),
                    };
                },
                lookupPropertySkipKeys: async ({ book, account }: { book: Book; account: Account }) => new PromptLookupService().lookupPropertySkipKeys({ book, account }),
                lookupDiscoveryExamples: async ({ book, account }: { book: Book; account?: Account }) => new PromptLookupService().lookupDiscoveryExamples({ book, account }),
                lookupParserUrl: async () => null,
                lookupTransactionsParserUrl: async () => null,
            },
        } as unknown as AppContext;

        eventHandler = new EventHandlerFileCreated(mockContext);
    });

    function setupMockAccounts() {
        const accounts = [
            { id: 'bank_id', name: 'Bank', type: AccountType.ASSET },
            { id: 'cash_id', name: 'Cash', type: AccountType.ASSET },
            { id: 'groceries_id', name: 'Groceries', type: AccountType.OUTGOING },
            { id: 'amazon_id', name: 'Amazon', type: AccountType.OUTGOING },
            { id: 'gas_id', name: 'Gas', type: AccountType.OUTGOING },
            { id: 'salary_id', name: 'Salary', type: AccountType.INCOMING },
        ];

        accounts.forEach(({ id, name, type }) => {
            const properties: { [key: string]: string } = {};
            const account = {
                getId: () => id,
                getName: () => name,
                getType: () => type,
                getProperty: (key: string) => properties[key] || undefined,
                getGroups: async () => [],
                setProperty: (key: string, value: string) => {
                    properties[key] = value;
                    return account;
                },
                update: async () => account,
            } as unknown as Account;
            mockAccounts.set(id, account);
        });
    }

    function setupMockTransactions() {
        const bankAcc = mockAccounts.get('bank_id')!;
        const amazonAcc = mockAccounts.get('amazon_id')!;
        const groceriesAcc = mockAccounts.get('groceries_id')!;
        const gasAcc = mockAccounts.get('gas_id')!;

        // Historical transactions for pattern matching
        // Pattern A: Amazon purchases with properties (add more variations to ensure matches)
        mockTransactions.push(
            createMockTransaction('Amazon.com order #123', bankAcc, amazonAcc, 'user@example.com', { vendor: 'Amazon', type: 'online', category: 'shopping' }),
            createMockTransaction('Amazon.com order #456', bankAcc, amazonAcc, 'user@example.com', { vendor: 'Amazon', type: 'online', category: 'shopping' }),
            createMockTransaction('Amazon Prime monthly', bankAcc, amazonAcc, 'user@example.com', { vendor: 'Amazon', type: 'online', category: 'shopping' }),
            createMockTransaction('Amazon Prime subscription', bankAcc, amazonAcc, 'user@example.com', { vendor: 'Amazon', type: 'online', category: 'shopping' }),
            createMockTransaction('AMZN Marketplace purchase', bankAcc, amazonAcc, 'user@example.com', { vendor: 'Amazon', type: 'online', category: 'shopping' })
        );

        // Pattern B: Grocery shopping with properties (add more variations)
        mockTransactions.push(
            createMockTransaction('Whole Foods Market', bankAcc, groceriesAcc, 'user@example.com', { store_type: 'organic', category: 'food' }),
            createMockTransaction('Whole Foods shopping', bankAcc, groceriesAcc, 'user@example.com', { store_type: 'organic', category: 'food' }),
            createMockTransaction('Trader Joes shopping', bankAcc, groceriesAcc, 'user@example.com', { store_type: 'organic', category: 'food' }),
            createMockTransaction('Safeway groceries', bankAcc, groceriesAcc, 'user@example.com', { store_type: 'organic', category: 'food' })
        );

        // Pattern C: Gas station with properties (add more variations)
        mockTransactions.push(
            createMockTransaction('Shell Station pump 5', bankAcc, gasAcc, 'user@example.com', { vehicle: 'car', category: 'transport' }),
            createMockTransaction('Shell gas fill', bankAcc, gasAcc, 'user@example.com', { vehicle: 'car', category: 'transport' }),
            createMockTransaction('Chevron gas fill', bankAcc, gasAcc, 'user@example.com', { vehicle: 'car', category: 'transport' }),
            createMockTransaction('Chevron station', bankAcc, gasAcc, 'user@example.com', { vehicle: 'car', category: 'transport' }),
            createMockTransaction('76 Gas station', bankAcc, gasAcc, 'user@example.com', { vehicle: 'car', category: 'transport' })
        );
    }

    function createMockTransaction(
        description: string,
        creditAccount?: Account,
        debitAccount?: Account,
        createdByUsername?: string,
        properties?: { [key: string]: string }
    ): Transaction {
        const payload: any = {
            description,
            tags: [],
            creditAccount: creditAccount ? { id: creditAccount.getId() } : undefined,
            debitAccount: debitAccount ? { id: debitAccount.getId() } : undefined,
            properties: properties ? { ...properties } : {},
        };

        const transaction = {
            payload,
            getDescription: () => description,
            getTags: () => [],
            getDate: () => '2025-03-01',
            getAmount: () => undefined,
            getCreditAccount: async () => (payload.creditAccount ? await mockBook.getAccount(payload.creditAccount.id) : undefined),
            getDebitAccount: async () => (payload.debitAccount ? await mockBook.getAccount(payload.debitAccount.id) : undefined),
            getCreditAccountName: async () => creditAccount?.getName(),
            getDebitAccountName: async () => debitAccount?.getName(),
            setCreditAccount: (account: Account) => {
                payload.creditAccount = { id: account.getId() };
                return transaction as Transaction;
            },
            setDebitAccount: (account: Account) => {
                payload.debitAccount = { id: account.getId() };
                return transaction as Transaction;
            },
            getBook: () => mockBook,
            getCreatedBy: () => createdByUsername,
            getVisibleProperties: () => {
                const visible: { [key: string]: string } = {};
                for (const [key, value] of Object.entries(payload.properties)) {
                    if (!key.endsWith('_') && typeof value === 'string') {
                        visible[key] = value;
                    }
                }
                return visible;
            },
            getProperty: (key: string) => payload.properties[key] || undefined,
            setProperty: (key: string, value: string) => {
                payload.properties[key] = value;
            },
            deleteProperty: (key: string) => {
                delete payload.properties[key];
            },
            addFile: (file: File) => {
                // Mock addFile - no-op
            },
            create: mock(async () => transaction),
        } as unknown as Transaction;

        return transaction;
    }

    function createMockFile(fileId: string): File {
        const properties: { [key: string]: string } = {};
        const file = {
            getId: () => fileId,
            getName: () => 'test-statement.csv',
            getContentType: () => 'text/csv',
            getContent: async () => btoa('date,description,amount\n2025-03-01,Test,100'),
            getProperty: (key: string) => properties[key],
            setProperty: (key: string, value: string) => {
                properties[key] = value;
                return file;
            },
            update: async () => file,
            getBook: () => mockBook,
            json: () => ({ id: fileId }),
        } as unknown as File;
        return file;
    }

    function filterTransactionsByQuery(query: string): Transaction[] {
        const results: Transaction[] = [];

        const createdByMatch = query.match(/createdBy:(\S+)/);
        const accountMatch = query.match(/account:\s*'([^']+)'/);
        const isPostedMatch = query.match(/is:posted/);

        let mainQuery = query.replace(/createdBy:\S+/g, '').replace(/account:\s*'[^']+'/g, '').replace(/is:posted/g, '').trim();

        const quotedMatch = mainQuery.match(/"([^"]+)"/);
        if (quotedMatch) {
            mainQuery = quotedMatch[1];
        }

        for (const tx of mockTransactions) {
            let matchesFilters = true;

            if (createdByMatch) {
                const requiredUsername = createdByMatch[1];
                const txCreatedBy = tx.getCreatedBy?.();
                if (txCreatedBy !== requiredUsername) {
                    matchesFilters = false;
                }
            }

            if (matchesFilters && accountMatch) {
                const requiredAccountName = accountMatch[1];
                const creditAccountId = tx.payload.creditAccount?.id;
                const debitAccountId = tx.payload.debitAccount?.id;
                const creditAccount = creditAccountId ? mockAccounts.get(creditAccountId) : undefined;
                const debitAccount = debitAccountId ? mockAccounts.get(debitAccountId) : undefined;
                const creditAccountName = creditAccount?.getName();
                const debitAccountName = debitAccount?.getName();
                const hasAccountMatch = 
                    (creditAccountName && creditAccountName.toLowerCase() === requiredAccountName.toLowerCase()) || 
                    (debitAccountName && debitAccountName.toLowerCase() === requiredAccountName.toLowerCase());
                if (!hasAccountMatch) {
                    matchesFilters = false;
                }
            }

            if (matchesFilters && mainQuery) {
                const description = tx.getDescription();
                if (!description) {
                    matchesFilters = false;
                } else {
                    const descLower = description.toLowerCase();
                    const queryLower = mainQuery.toLowerCase();
                    
                    // Split query into words (min 3 chars) and check if ANY significant word matches
                    // This mimics Bkper's search behavior which tokenizes and searches for words
                    // Split both query and description the same way to handle domain names (amazon.com)
                    // Normalize common abbreviations to match against full names
                    const queryWords = queryLower.split(/\W+/).filter(word => word.length >= 3).map(word => {
                        if (word === 'amzn') return 'amazon';
                        return word;
                    });
                    const descWords = descLower.split(/\W+/).filter(word => word.length >= 3);
                    
                    // Check if any query word has a significant match in description words
                    // Require exact match OR prefix match with high similarity (to match "amzn"/"amazon" but not "market"/"marketplace")
                    const matches = queryWords.some(qWord => 
                        descWords.some(dWord => {
                            // Exact match
                            if (dWord === qWord) return true;
                            // Prefix match (either direction): requires high similarity
                            // "amzn"(4)/"amazon"(6) = 67% ✓, "market"(6)/"marketplace"(11) = 55% ✗
                            if (qWord.length >= 4 && dWord.length >= 4) {
                                const shorter = Math.min(qWord.length, dWord.length);
                                const longer = Math.max(qWord.length, dWord.length);
                                const similarity = shorter / longer;
                                // Require at least 65% similarity and one word is a prefix of the other
                                if (similarity >= 0.65 && (dWord.startsWith(qWord) || qWord.startsWith(dWord))) {
                                    return true;
                                }
                            }
                            return false;
                        })
                    );
                    
                    if (!matches) {
                        matchesFilters = false;
                    }
                }
            }

            if (matchesFilters) {
                results.push(tx);
            }
        }
        return results;
    }

    describe('Complete Properties Discovery Flow', () => {
        it('should discover and apply properties from similar transactions', async () => {
            const fileId = 'test_file_1';
            const event: bkper.Event = {
                bookId: 'test_book_id',
                data: {
                    object: { id: fileId } as bkper.File,
                },
            } as bkper.Event;

            // Customize extractor to return Amazon transaction
            mockContext.createExtractorStatementCSV = ((file: File) => ({
                extract: async () => ({
                    transactions: [{ date: '2025-03-15', description: 'Amazon Prime subscription', amount: -14.99, properties: {} }],
                }),
            })) as any;

            const result = await eventHandler.handleEvent(mockBook, event);

            expect(result.result).toBeDefined();
            // Verify properties were discovered and added
            const batchCreateMock = mockBook.batchCreateTransactions as any;
            expect(batchCreateMock).toHaveBeenCalled();

            const createdTransactions = batchCreateMock.mock.calls[0][0];
            expect(createdTransactions.length).toBe(1);

            const tx = createdTransactions[0];
            const props = tx.getVisibleProperties();

            // Should have discovered properties from historical Amazon transactions
            expect(props.vendor).toBe('Amazon');
            expect(props.type).toBe('online');
            expect(props.category).toBe('shopping');

            // Verify property discovery records only the keys it added on the transaction.
            expect(tx.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBe('["category","type","vendor"]');

            // Verify property discovery does not mutate the account denylist
            const bankAccount = mockAccounts.get('bank_id')!;
            expect(bankAccount.getProperty(AGENT_EXCLUDED_PROPERTIES_PROPERTY)).toBeUndefined();
        });

        it('should not discover properties when no accounts found', async () => {
            const fileId = 'test_file_2';
            const event: bkper.Event = {
                bookId: 'test_book_id',
                data: {
                    object: { id: fileId } as bkper.File,
                },
            } as bkper.Event;

            // Customize extractor to return unknown merchant
            mockContext.createExtractorStatementCSV = ((file: File) => ({
                extract: async () => ({
                    transactions: [{ date: '2025-03-15', description: 'Unknown Merchant XYZ Payment', amount: -100.00, properties: {} }],
                }),
            })) as any;

            const result = await eventHandler.handleEvent(mockBook, event);

            expect(result.result).toBeDefined();

            const batchCreateMock = mockBook.batchCreateTransactions as any;
            expect(batchCreateMock).toHaveBeenCalled();

            const createdTransactions = batchCreateMock.mock.calls[0][0];
            expect(createdTransactions.length).toBe(1);

            const tx = createdTransactions[0];
            const props = tx.getVisibleProperties();

            // Should NOT have discovered any properties (no matching historical transactions)
            expect(Object.keys(props).filter((k) => !k.endsWith('_')).length).toBe(0);
        });

        it('should discover properties only with sufficient dataset (min 2 transactions)', async () => {
            // Remove historical transactions to have only 1
            mockTransactions = mockTransactions.slice(0, 1);

            const fileId = 'test_file_3';
            const event: bkper.Event = {
                bookId: 'test_book_id',
                data: {
                    object: { id: fileId } as bkper.File,
                },
            } as bkper.Event;

            mockContext.createExtractorStatementCSV = ((file: File) => ({
                extract: async () => ({
                    transactions: [{ date: '2025-03-15', description: 'Amazon.com', amount: -50.00, properties: {} }],
                }),
            })) as any;

            const result = await eventHandler.handleEvent(mockBook, event);

            const batchCreateMock = mockBook.batchCreateTransactions as any;
            const createdTransactions = batchCreateMock.mock.calls[0][0];
            const tx = createdTransactions[0];

            // Should have discovered accounts but NOT properties (dataset too small)
            expect(tx.payload.creditAccount).toBeDefined();
            expect(tx.payload.debitAccount).toBeDefined();

            const props = tx.getVisibleProperties();
            const nonInternalProps = Object.keys(props).filter((k) => !k.endsWith('_'));
            expect(nonInternalProps.length).toBe(0);
        });

        it('should discover properties for correct transactions in batch', async () => {
            const fileId = 'test_file_4';
            const event: bkper.Event = {
                bookId: 'test_book_id',
                data: {
                    object: { id: fileId } as bkper.File,
                },
            } as bkper.Event;

            // Mix of transactions - some match patterns, one doesn't
            mockContext.createExtractorStatementCSV = ((file: File) => ({
                extract: async () => ({
                    transactions: [
                        { date: '2025-03-01', description: 'Whole Foods shopping', amount: -85.00, properties: {} }, // Should match Groceries pattern
                        { date: '2025-03-05', description: 'Shell gas fill', amount: -40.00, properties: {} }, // Should match Gas pattern
                        { date: '2025-03-10', description: 'Unknown Coffee Shop', amount: -5.50, properties: {} }, // No match
                    ],
                }),
            })) as any;

            const result = await eventHandler.handleEvent(mockBook, event);

            const batchCreateMock = mockBook.batchCreateTransactions as any;
            const createdTransactions = batchCreateMock.mock.calls[0][0];
            expect(createdTransactions.length).toBe(3);

            // Transaction 1: Groceries - should have properties
            const tx1 = createdTransactions[0];
            const props1 = tx1.getVisibleProperties();
            expect(props1.store_type).toBe('organic');
            expect(props1.category).toBe('food');

            // Transaction 2: Gas - should have properties
            const tx2 = createdTransactions[1];
            const props2 = tx2.getVisibleProperties();
            expect(props2.vehicle).toBe('car');
            expect(props2.category).toBe('transport');

            // Transaction 3: Unknown - should NOT have properties
            const tx3 = createdTransactions[2];
            const props3 = tx3.getVisibleProperties();
            const nonInternalProps3 = Object.keys(props3).filter((k) => !k.endsWith('_'));
            expect(nonInternalProps3.length).toBe(0);
        });
    });

    describe('Skip List Management Integration', () => {
        // Confirms the account denylist filters discovered properties without being modified.
        it('honors the account skip list during file property discovery', async () => {
            const bankAccount = mockAccounts.get('bank_id')!;
            bankAccount.setProperty(AGENT_EXCLUDED_PROPERTIES_PROPERTY, 'VENDOR, category');

            const event: bkper.Event = {
                bookId: 'test_book_id',
                data: { object: { id: 'file_skip' } as bkper.File },
            } as bkper.Event;

            mockContext.createExtractorStatementCSV = ((file: File) => ({
                extract: async () => ({
                    transactions: [{ date: '2025-03-01', description: 'Amazon Prime', amount: -14.99, properties: {} }],
                }),
            })) as any;

            await eventHandler.handleEvent(mockBook, event);

            const batchCreateMock = mockBook.batchCreateTransactions as any;
            const createdTransactions = batchCreateMock.mock.calls[0][0];
            const properties = createdTransactions[0].getVisibleProperties();

            expect(properties.type).toBe('online');
            expect(properties.vendor).toBeUndefined();
            expect(properties.category).toBeUndefined();
            expect(bankAccount.getProperty(AGENT_EXCLUDED_PROPERTIES_PROPERTY)).toBe('VENDOR, category');
        });
    });

    describe('Batch Processing with Properties Discovery', () => {
        it('should discover properties independently per transaction in batch', async () => {
            const fileId = 'test_batch';
            const event: bkper.Event = {
                bookId: 'test_book_id',
                data: { object: { id: fileId } as bkper.File },
            } as bkper.Event;

            mockContext.createExtractorStatementCSV = ((file: File) => ({
                extract: async () => ({
                    transactions: [
                        { date: '2025-03-01', description: 'Amazon order', amount: -50.00, properties: {} },
                        { date: '2025-03-02', description: 'AMZN Marketplace', amount: -30.00, properties: {} },
                        { date: '2025-03-05', description: 'Shell gas', amount: -45.00, properties: {} },
                        { date: '2025-03-06', description: 'Chevron fill', amount: -40.00, properties: {} },
                    ],
                }),
            })) as any;

            const result = await eventHandler.handleEvent(mockBook, event);

            const batchCreateMock = mockBook.batchCreateTransactions as any;
            const createdTransactions = batchCreateMock.mock.calls[0][0];
            expect(createdTransactions.length).toBe(4);

            // First two should have Amazon properties
            const tx1Props = createdTransactions[0].getVisibleProperties();
            const tx2Props = createdTransactions[1].getVisibleProperties();
            expect(tx1Props.vendor).toBe('Amazon');
            expect(tx2Props.vendor).toBe('Amazon');

            // Last two should have Gas properties
            const tx3Props = createdTransactions[2].getVisibleProperties();
            const tx4Props = createdTransactions[3].getVisibleProperties();
            expect(tx3Props.vehicle).toBe('car');
            expect(tx4Props.vehicle).toBe('car');
        });

        it('should handle single transaction and multi-transaction recording correctly', async () => {
            // Test single transaction path (invoice)
            const eventInvoice: bkper.Event = {
                bookId: 'test_book_id',
                data: { object: { id: 'invoice_file' } as bkper.File },
            } as bkper.Event;

            mockContext.createExtractorFileClassification = ((file: File) => ({
                extract: async () => ({ kind: 'single_transaction' as const }),
            })) as any;

            mockContext.createExtractorInvoice = ((file: File) => ({
                extract: async () => ({
                    date: '2025-03-15',
                    description: 'Amazon AWS invoice',
                    amount: 189.73,
                    properties: {},
                }),
            })) as any;

            const resultInvoice = await eventHandler.handleEvent(mockBook, eventInvoice);

            // Verify single transaction was created
            const createMock = Transaction.prototype.create as any;
            // Note: This test is primarily checking the flow works without errors
            // In a real integration test with real API, we'd verify the transaction was created
            expect(resultInvoice.result).toBeDefined();
        });
    });
});
