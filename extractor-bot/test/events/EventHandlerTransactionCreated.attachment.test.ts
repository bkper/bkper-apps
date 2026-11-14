/// <reference types="@bkper/bkper-api-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Book, File, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerTransactionCreated } from '../../src/events/EventHandlerTransactionCreated.js';
import { AUTO_FILLED_DATE_PROPERTY } from '../../src/constants.js';
import type { DiscoveryBatchOutcome, DiscoveryItem } from '../../src/services/BookbotDiscoveryClient.js';
import { createNoMatchBookbotDiscoveryClient } from '../helpers/bookbot-discovery.js';

const UPLOAD_METHOD_PROPERTY = 'upload_method';

describe('EventHandlerTransactionCreated - attachments', () => {
    let originalTransactionUpdate: typeof Transaction.prototype.update;

    beforeEach(() => {
        originalTransactionUpdate = Transaction.prototype.update;
    });

    afterEach(() => {
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

    it('logs the attachment file property names, never their values', async () => {
        const logged: string[] = [];
        const log = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
        });
        const mockFile = createAttachmentFile();
        (mockFile as unknown as { getProperties: () => Record<string, string> }).getProperties = () => ({
            upload_method: 'attachment',
            check_saldos: 'SECRET-7781',
        });
        const mockBook = {
            getId: () => 'book_1',
            getConfig: () => ({}),
            getFile: mock(async () => mockFile),
            getFractionDigits: () => 2,
            getTimeZone: () => 'UTC',
            getMostRecentLockDate_: () => undefined,
            getDecimalSeparator: () => 'DOT',
        } as unknown as Book;
        const mockContext = {
            promptLookupService: {
                lookupPrompts: mock(async () => null),
                lookupParserUrl: mock(async () => null),
            },
            createBookbotDiscoveryClient: () => createNoMatchBookbotDiscoveryClient(),
            createExtractorInvoice: () => ({ extract: mock(async () => undefined) }),
        } as unknown as AppContext;
        Transaction.prototype.update = mock(async function (this: Transaction) {
            return this;
        }) as typeof Transaction.prototype.update;
        const event = {
            bookId: 'book_1',
            data: { object: { transaction: { id: 'tx_1', date: '2024-01-01', description: 'Existing', amount: '100', files: [{ id: 'file_1' }] } } },
        } as bkper.Event;

        try {
            await new EventHandlerTransactionCreated(mockContext).handleEvent(mockBook, event);
        } finally {
            log.mockRestore();
        }

        expect(logged.join('\n')).toContain('check_saldos');
        expect(logged.join('\n')).not.toContain('SECRET-7781');
    });

    function createBook(file: File): Book {
        return {
            getId: () => 'book_1',
            getConfig: () => ({}),
            getFile: mock(async () => file),
            getFractionDigits: () => 2,
            getTimeZone: () => 'UTC',
            getMostRecentLockDate_: () => undefined,
            getDecimalSeparator: () => 'DOT',
        } as unknown as Book;
    }

    function attachmentEvent(transaction: bkper.Transaction): bkper.Event {
        return {
            bookId: 'book_1',
            data: { object: { transaction: { id: 'tx_1', date: '2024-01-01', files: [{ id: 'file_1' }], ...transaction } } },
        } as bkper.Event;
    }

    it('leaves a missing amount and an automatically filled date to Bookbot, then updates once', async () => {
        const invoiceExtract = mock(async () => undefined);
        const sent: bkper.Transaction[] = [];
        const discover = mock(async (_bookId: string, items: DiscoveryItem[]): Promise<DiscoveryBatchOutcome> => {
            sent.push(structuredClone(items[0].transaction.payload));
            items[0].transaction.payload.date = '2024-01-02';
            return { outcomes: ['changed'] };
        });
        const mockContext = {
            promptLookupService: {
                lookupPrompts: mock(async () => null),
                lookupParserUrl: mock(async () => null),
            },
            createBookbotDiscoveryClient: () => ({ discover }),
            createExtractorInvoice: () => ({ extract: invoiceExtract }),
        } as unknown as AppContext;
        Transaction.prototype.update = mock(async function (this: Transaction) {
            return this;
        }) as typeof Transaction.prototype.update;

        const result = await new EventHandlerTransactionCreated(mockContext).handleEvent(createBook(createAttachmentFile()), attachmentEvent({
            description: 'Existing description',
            amount: '100',
            properties: { [AUTO_FILLED_DATE_PROPERTY]: 'true' },
        }));

        // Amount and description were supplied, so the document is not read.
        expect(invoiceExtract).not.toHaveBeenCalled();
        expect(sent[0].properties?.[AUTO_FILLED_DATE_PROPERTY]).toBe('true');
        expect(Transaction.prototype.update).toHaveBeenCalledTimes(1);
        expect(result.result).toBeTruthy();
    });

    it('keeps the date the document gives, marking it no longer automatic before Bookbot completes the draft', async () => {
        const sent: bkper.Transaction[] = [];
        const discover = mock(async (_bookId: string, items: DiscoveryItem[]): Promise<DiscoveryBatchOutcome> => {
            sent.push(structuredClone(items[0].transaction.payload));
            return { outcomes: ['no_match'] };
        });
        const mockContext = {
            promptLookupService: {
                lookupPrompts: mock(async () => null),
                lookupParserUrl: mock(async () => null),
            },
            createBookbotDiscoveryClient: () => ({ discover }),
            createExtractorInvoice: () => ({ extract: mock(async () => ({ date: '2023-12-24', description: 'Invoice', amount: 0, properties: {} })) }),
        } as unknown as AppContext;
        let updated: bkper.Transaction | undefined;
        Transaction.prototype.update = mock(async function (this: Transaction) {
            updated = structuredClone(this.payload);
            return this;
        }) as typeof Transaction.prototype.update;

        await new EventHandlerTransactionCreated(mockContext).handleEvent(createBook(createAttachmentFile()), attachmentEvent({
            properties: { [AUTO_FILLED_DATE_PROPERTY]: 'true' },
        }));

        // The document had no amount: Bookbot receives the draft without one, to read it from the description.
        expect(sent[0].amount).toBeUndefined();
        expect(sent[0].date).toBe('2023-12-24');
        // The SDK encodes property removal as an empty value.
        expect(sent[0].properties?.[AUTO_FILLED_DATE_PROPERTY]).toBe('');
        expect(updated?.date).toBe('2023-12-24');
        expect(updated?.description).toBe('Invoice');
    });
});
