/// <reference types="@bkper/bkper-api-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Book, File, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerTransactionCreated } from '../../src/events/EventHandlerTransactionCreated.js';
import { AUTO_FILLED_DATE_PROPERTY } from '../../src/constants.js';
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
            createExtractorAmount: () => ({ extract: mock(async () => undefined) }),
            createExtractorDate: () => ({ extract: mock(async () => undefined) }),
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
            createBookbotDiscoveryClient: () => createNoMatchBookbotDiscoveryClient(),
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
