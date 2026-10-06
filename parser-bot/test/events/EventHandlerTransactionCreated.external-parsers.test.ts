/// <reference types="@bkper/bkper-api-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Account, Book, File, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerTransactionCreated } from '../../src/events/EventHandlerTransactionCreated.js';
import { ExternalExtractorClient } from '../../src/external-extractor/ExternalExtractorClient.js';
import { PromptLookupService } from '../../src/services/PromptLookupService.js';
import { AGENT_PARSER_URL_TRANSACTION_PROPERTY, AUTO_FILLED_DATE_PROPERTY } from '../../src/constants.js';

const UPLOAD_METHOD_PROPERTY = 'upload_method';

describe('EventHandlerTransactionCreated - external parsers', () => {
    let originalExtractTransaction: typeof ExternalExtractorClient.prototype.extractTransaction;
    let originalExtractFileProperties: typeof ExternalExtractorClient.prototype.extractFileProperties;
    let originalTransactionUpdate: typeof Transaction.prototype.update;

    beforeEach(() => {
        originalExtractTransaction = ExternalExtractorClient.prototype.extractTransaction;
        originalExtractFileProperties = ExternalExtractorClient.prototype.extractFileProperties;
        originalTransactionUpdate = Transaction.prototype.update;
    });

    afterEach(() => {
        ExternalExtractorClient.prototype.extractTransaction = originalExtractTransaction;
        ExternalExtractorClient.prototype.extractFileProperties = originalExtractFileProperties;
        Transaction.prototype.update = originalTransactionUpdate;
    });

    function createAttachmentFile(): File {
        const file = {
            getId: () => 'file_1',
            getName: () => 'invoice.pdf',
            getContentType: () => 'application/pdf',
            getContent: async () => 'base64content==',
            getProperties: () => ({}),
            getProperty: (key: string, ...fallbacks: string[]) => key === UPLOAD_METHOD_PROPERTY || fallbacks.includes(UPLOAD_METHOD_PROPERTY) ? 'attachment' : undefined,
            setProperty: mock(() => file),
            update: mock(async () => file),
        } as unknown as File;
        return file;
    }

    function createAccount(): Account {
        return {
            getId: () => 'acc_1',
            getName: () => 'Bank',
            getType: () => 'ASSET',
            getProperty: () => undefined,
            getGroups: async () => [],
            getVisibleProperties: () => ({}),
            json: () => ({ id: 'acc_1', name: 'Bank' }) as bkper.Account,
        } as unknown as Account;
    }

    it('uses external transaction and file parsers from transaction-side account before writing', async () => {
        const mockAccount = {
            getId: () => 'acc_1',
            getName: () => 'Bank',
            getType: () => 'ASSET',
            getProperty: () => undefined,
            getGroups: async () => [],
            getVisibleProperties: () => ({}),
            json: () => ({ id: 'acc_1', name: 'Bank' }) as bkper.Account,
        } as unknown as Account;

        const fileSetPropertyCalls: Array<[string, string]> = [];
        const mockFile = {
            getId: () => 'file_1',
            getName: () => 'invoice.pdf',
            getContentType: () => 'application/pdf',
            getContent: async () => 'base64content==',
            getProperties: () => ({}),
            getProperty: (key: string, ...fallbacks: string[]) => key === UPLOAD_METHOD_PROPERTY || fallbacks.includes(UPLOAD_METHOD_PROPERTY) ? 'attachment' : undefined,
            setProperty: mock((key: string, value: string) => {
                fileSetPropertyCalls.push([key, value]);
                return mockFile;
            }),
            update: mock(async () => mockFile),
        } as unknown as File;

        const mockBook = {
            getId: () => 'book_1',
            getConfig: () => ({}),
            getFile: mock(async () => mockFile),
            getFractionDigits: () => 2,
            getTimeZone: () => 'UTC',
            getMostRecentLockDate_: () => undefined,
        } as unknown as Book;

        const promptLookupService = {
            lookupPrompts: mock(async () => null),
            lookupParserUrl: mock(async ({ purpose }: { purpose: string }) => {
                if (purpose === 'transaction') {
                    return { url: 'https://parser.example.com/transaction', source: 'account' as const, account: mockAccount };
                }
                if (purpose === 'file') {
                    return { url: 'https://parser.example.com/file', source: 'account' as const, account: mockAccount };
                }
                return null;
            }),
        };

        const mockContext = {
            promptLookupService,
            createDiscovery: () => ({
                discover: mock(async () => ({ discovered: false })),
            }),
            createExtractorInvoice: () => ({
                extract: mock(async () => {
                    throw new Error('GenAI invoice extractor should not be called');
                }),
            }),
            createExtractorAmount: () => ({ extract: mock(async () => undefined) }),
        } as unknown as AppContext;

        ExternalExtractorClient.prototype.extractTransaction = mock(async () => ({
            date: '2024-01-02',
            description: 'External invoice',
            amount: 123.45,
            properties: { invoice_number: 'INV-001' },
        }));
        ExternalExtractorClient.prototype.extractFileProperties = mock(async () => ({ vendor: 'Acme' }));

        let transactionUpdated = false;
        Transaction.prototype.update = mock(async function (this: Transaction) {
            transactionUpdated = true;
            return this;
        }) as typeof Transaction.prototype.update;

        const event = {
            bookId: 'book_1',
            data: {
                object: {
                    transaction: {
                        id: 'tx_1',
                        date: '2024-01-01',
                        description: '',
                        properties: {},
                        files: [{ id: 'file_1' }],
                    },
                },
            },
        } as bkper.Event;

        const result = await new EventHandlerTransactionCreated(mockContext).handleEvent(mockBook, event);

        expect(result.result).toBeTruthy();
        expect(transactionUpdated).toBe(true);
        expect(mockFile.update).toHaveBeenCalled();
        expect(fileSetPropertyCalls).toContainEqual(['vendor', 'Acme']);
        expect(ExternalExtractorClient.prototype.extractTransaction).toHaveBeenCalled();
        expect(ExternalExtractorClient.prototype.extractFileProperties).toHaveBeenCalled();
    });

    it('uses a transaction-side account with a book-level transaction parser on attachments', async () => {
        const mockAccount = createAccount();
        const mockFile = createAttachmentFile();
        const mockBook = {
            getId: () => 'book_1',
            getConfig: () => ({}),
            getFile: mock(async () => mockFile),
            getAccount: mock(async (id: string) => id === 'acc_1' ? mockAccount : undefined),
            getAccounts: mock(async () => []),
            getGroup: mock(async () => undefined),
            getProperty: (key: string) => key === AGENT_PARSER_URL_TRANSACTION_PROPERTY ? 'https://parser.example.com/book-transaction' : undefined,
            getFractionDigits: () => 2,
            getTimeZone: () => 'UTC',
            getMostRecentLockDate_: () => undefined,
            getDecimalSeparator: () => 'DOT',
        } as unknown as Book;

        let parserAccount: Account | undefined;
        ExternalExtractorClient.prototype.extractTransaction = mock(async (_file: File, _book: Book, account: Account) => {
            parserAccount = account;
            return {
                date: '2024-01-02',
                description: 'External invoice',
                amount: 123.45,
                properties: {},
            };
        });
        ExternalExtractorClient.prototype.extractFileProperties = mock(async () => undefined);

        let transactionUpdated = false;
        Transaction.prototype.update = mock(async function (this: Transaction) {
            transactionUpdated = true;
            return this;
        }) as typeof Transaction.prototype.update;

        const mockContext = {
            promptLookupService: new PromptLookupService(),
            createDiscovery: () => ({ discover: mock(async () => ({ discovered: false })) }),
            createExtractorInvoice: () => ({
                extract: mock(async () => {
                    throw new Error('GenAI invoice extractor should not be called');
                }),
            }),
            createExtractorAmount: () => ({ extract: mock(async () => undefined) }),
        } as unknown as AppContext;

        const event = {
            bookId: 'book_1',
            data: {
                object: {
                    transaction: {
                        id: 'tx_1',
                        date: '2024-01-01',
                        description: '',
                        properties: {},
                        creditAccount: { id: 'acc_1', name: 'Bank' },
                        files: [{ id: 'file_1' }],
                    },
                },
            },
        } as bkper.Event;

        const result = await new EventHandlerTransactionCreated(mockContext).handleEvent(mockBook, event);

        expect(result.result).toBeTruthy();
        expect(transactionUpdated).toBe(true);
        expect(parserAccount).toBe(mockAccount);
        expect(ExternalExtractorClient.prototype.extractTransaction).toHaveBeenCalled();
    });

    it('skips attachment extraction while preserving description date extraction', async () => {
        const mockFile = createAttachmentFile();
        const mockBook = {
            getId: () => 'book_1',
            getConfig: () => ({}),
            getFile: mock(async () => mockFile),
            getFractionDigits: () => 2,
            getTimeZone: () => 'UTC',
            getMostRecentLockDate_: () => undefined,
            getDecimalSeparator: () => 'DOT',
        } as unknown as Book;
        const invoiceExtract = mock(async () => ({
            date: '2024-01-01',
            description: 'Existing description',
            amount: 100,
            properties: {},
        }));
        const dateExtract = mock(async () => '2024-01-02');
        const mockContext = {
            promptLookupService: {
                lookupPrompts: mock(async () => null),
                lookupParserUrl: mock(async () => null),
            },
            createDiscovery: () => ({ discover: mock(async () => ({ discovered: false })) }),
            createExtractorInvoice: () => ({ extract: invoiceExtract }),
            createExtractorAmount: () => ({ extract: mock(async () => undefined) }),
            createExtractorDate: () => ({ extract: dateExtract }),
        } as unknown as AppContext;

        Transaction.prototype.update = mock(async function (this: Transaction) {
            return this;
        }) as typeof Transaction.prototype.update;

        const event = {
            bookId: 'book_1',
            data: {
                object: {
                    transaction: {
                        id: 'tx_1',
                        date: '2024-01-01',
                        description: 'Existing description',
                        amount: '100',
                        properties: { [AUTO_FILLED_DATE_PROPERTY]: 'true' },
                        files: [{ id: 'file_1' }],
                    },
                },
            },
        } as bkper.Event;

        const result = await new EventHandlerTransactionCreated(mockContext).handleEvent(mockBook, event);

        expect(invoiceExtract).not.toHaveBeenCalled();
        expect(dateExtract).toHaveBeenCalledWith('Existing description');
        expect(Transaction.prototype.update).toHaveBeenCalledTimes(1);
        expect(result.result).toBeTruthy();
    });
});
