/// <reference types="@bkper/bkper-api-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Account, Book, File, Group, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerFileCreated } from '../../src/events/EventHandlerFileCreated.js';
import { EventHandlerTransactionCreated } from '../../src/events/EventHandlerTransactionCreated.js';
import type { Result } from '../../src/events/event-handler.js';
import { PromptLookupService } from '../../src/services/PromptLookupService.js';
import { createNoMatchBookbotDiscoveryClient } from '../helpers/bookbot-discovery.js';

// Ownership rule: another app owns every file whose parser URL lookups, as Extractor Bot performs them,
// find a URL. Extractor Bot steps aside for those events; that app processes exactly them.
// O1–O14 and E1–E4 are case IDs shared with the app that owns parser URLs: keep both copies in sync,
// with the same setups and expectations.

const PARSER_URL = 'https://parser.example.com/extract?key=SECRET-7781';

interface Configuration {
    account?: Record<string, string>;
    group?: Record<string, string>;
    /** A Group of no Account in the Book, reachable only through a file's group_id. */
    otherGroup?: Record<string, string>;
    file?: { name?: string; contentType?: string; properties?: Record<string, string> };
}

interface World {
    book: Book;
    file: File;
    context: AppContext;
    ai: ReturnType<typeof mock>;
    discover: ReturnType<typeof createNoMatchBookbotDiscoveryClient>['discover'];
    lookupParserUrl: ReturnType<typeof spyOn>;
}

const originalFetch = globalThis.fetch;
const originalTransactionCreate = Transaction.prototype.create;
const originalTransactionUpdate = Transaction.prototype.update;
const originalFileUpdate = File.prototype.update;
const fetchMock = mock(async () => { throw new Error('No parser URL may be called'); });
const writes = mock(async () => { throw new Error('No write expected'); });
let logged: string[];

beforeEach(() => {
    fetchMock.mockClear();
    writes.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    Transaction.prototype.create = Transaction.prototype.update = writes as unknown as typeof Transaction.prototype.create;
    File.prototype.update = writes as unknown as typeof File.prototype.update;
    logged = [];
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
        spyOn(console, method).mockImplementation((...args: unknown[]) => {
            logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
        });
    }
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    Transaction.prototype.create = originalTransactionCreate;
    Transaction.prototype.update = originalTransactionUpdate;
    File.prototype.update = originalFileUpdate;
    for (const method of ['log', 'info', 'warn', 'error'] as const) spyOn(console, method).mockRestore();
});

function world(configuration: Configuration): World {
    const book = new Book({ id: 'book_1', name: 'Book', fractionDigits: 2, permission: 'OWNER' });
    const group = new Group(book, { id: 'group_1', name: 'Banks', properties: { ...configuration.group } });
    const otherGroup = new Group(book, { id: 'group_2', name: 'Imports', properties: { ...configuration.otherGroup } });
    const account = new Account(book, { id: 'account_1', name: 'Checking', type: 'ASSET', properties: { ...configuration.account } });
    account.getGroups = mock(async () => [group]);
    book.getAccount = mock(async (idOrName: string) => idOrName === 'account_1' || idOrName === 'Checking' ? account : undefined);
    book.getAccounts = mock(async () => [account]);
    book.getGroup = mock(async (id: string) => id === 'group_1' ? group : id === 'group_2' ? otherGroup : undefined);
    const file = new File(book, {
        id: 'file_1',
        name: configuration.file?.name ?? 'statement.pdf',
        contentType: configuration.file?.contentType ?? 'application/pdf',
        content: 'ZGF0YQ==',
        properties: { ...configuration.file?.properties },
    });
    book.getFile = mock(async () => file);
    book.batchCreateTransactions = writes as unknown as typeof book.batchCreateTransactions;

    const ai = mock((_extractor: string) => undefined);
    const discoveryClient = createNoMatchBookbotDiscoveryClient();
    const promptLookupService = new PromptLookupService({ migrateLegacyPromptProperties: async () => {} } as never, false);
    const lookupParserUrl = spyOn(promptLookupService, 'lookupParserUrl');
    const context = {
        env: {},
        readOnly: false,
        promptLookupService,
        createBookbotDiscoveryClient: () => discoveryClient,
        createExtractorFileClassification: () => ({ extract: async () => { ai('classification'); return { kind: 'statement' as const }; } }),
        createExtractorStatementIMG: () => ({ extract: async () => { ai('statement'); return { transactions: [] }; } }),
        createExtractorStatementCSV: () => ({ extract: async () => { ai('csv'); return { transactions: [] }; } }),
        createExtractorInvoice: () => ({ extract: async () => { ai('invoice'); return undefined; } }),
        createExtractorFileProperties: () => ({ extract: async () => { ai('file'); return undefined; } }),
        createExtractorAmount: () => ({ extract: async () => { ai('amount'); return undefined; } }),
        createExtractorDate: () => ({ extract: async () => { ai('date'); return undefined; } }),
    } as unknown as AppContext;

    return { book, file, context, ai, discover: discoveryClient.discover, lookupParserUrl };
}

function fileCreated(w: World): Promise<Result> {
    return new EventHandlerFileCreated(w.context).handleEvent(w.book, { bookId: 'book_1', type: 'FILE_CREATED', data: { object: { id: 'file_1' } } } as bkper.Event);
}

function transactionCreated(w: World, transaction: bkper.Transaction): Promise<Result> {
    return new EventHandlerTransactionCreated(w.context).handleEvent(w.book, { bookId: 'book_1', type: 'TRANSACTION_CREATED', data: { object: { transaction } } } as bkper.Event);
}

/** A new transaction on the Account, with a file attached to it. */
const attached: bkper.Transaction = { id: 'tx_1', date: '2026-11-01', description: '', creditAccount: { id: 'account_1' }, files: [{ id: 'file_1' }] };

/** Extractor Bot stepped aside: no AI, no discovery, no parser call, no write, no response. */
function expectSkipped(w: World, result: Result): void {
    expect(result).toEqual({ result: false });
    expect(w.ai).not.toHaveBeenCalled();
    expect(w.discover).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
}

function expectOwnedByAnotherApp(w: World, result: Result): void {
    expectSkipped(w, result);
    expect(logged).toContain('Parser URL configured; extraction belongs to another app');
    expect(logged.join('\n')).not.toContain('SECRET-7781');
}

/** Extractor Bot processed the event with AI only. */
function expectProcessed(w: World, extractor: string): void {
    expect(w.ai).toHaveBeenCalledWith(extractor);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged).not.toContain('Parser URL configured; extraction belongs to another app');
}

describe('External parser ownership', () => {
    it('O1: a URL pair on the Group of the file\'s Account owns a PDF upload', async () => {
        const w = world({ group: { agent_parser_url_transactions: PARSER_URL, agent_parser_url_file: PARSER_URL }, file: { properties: { account_id: 'account_1' } } });
        expectOwnedByAnotherApp(w, await fileCreated(w));
    });

    it('O2: the same with the extractor_url_ names', async () => {
        const w = world({ group: { extractor_url_transactions: PARSER_URL, extractor_url_file: PARSER_URL }, file: { properties: { account_id: 'account_1' } } });
        expectOwnedByAnotherApp(w, await fileCreated(w));
    });

    it('O3: a file URL alone on the Account owns a PDF upload', async () => {
        const w = world({ account: { agent_parser_url_file: PARSER_URL }, file: { properties: { account_id: 'account_1' } } });
        expectOwnedByAnotherApp(w, await fileCreated(w));
    });

    it('O4: a transaction URL alone does not own a CSV upload', async () => {
        const w = world({ account: { extractor_url_transaction: PARSER_URL }, file: { name: 'statement.csv', contentType: 'text/csv', properties: { account_id: 'account_1' } } });
        await fileCreated(w);
        expectProcessed(w, 'csv');
    });

    it('O5: a transaction URL alone owns a PDF upload', async () => {
        const w = world({ account: { extractor_url_transaction: PARSER_URL }, file: { properties: { account_id: 'account_1' } } });
        expectOwnedByAnotherApp(w, await fileCreated(w));
    });

    it('O6: a prompt without any parser URL does not own a PDF upload', async () => {
        const w = world({ account: { extractor_prompt_transactions: 'Read the statement table' }, file: { properties: { account_id: 'account_1' } } });
        await fileCreated(w);
        expectProcessed(w, 'statement');
    });

    it('O7: a URL on the Group named by the file\'s group_id, a Group of no named Account, owns the upload', async () => {
        const w = world({ otherGroup: { agent_parser_url_transactions: PARSER_URL }, file: { properties: { group_id: 'group_2' } } });
        expectOwnedByAnotherApp(w, await fileCreated(w));
    });

    it('O8: a URL on the Group of the Account named in the filename owns the upload', async () => {
        const w = world({ group: { agent_parser_url_transactions: PARSER_URL }, file: { name: 'Checking statement.pdf' } });
        expectOwnedByAnotherApp(w, await fileCreated(w));
    });

    it('O9: a statements URL alone does not own an attachment', async () => {
        const w = world({ group: { agent_parser_url_transactions: PARSER_URL }, file: { name: 'receipt.pdf', properties: { upload_method: 'attachment' } } });
        await transactionCreated(w, attached);
        expectProcessed(w, 'invoice');
        expect(w.discover).toHaveBeenCalledTimes(1);
    });

    it('O10: a statements and file URL pair on the Group owns an attachment on an Account of that Group', async () => {
        const w = world({ group: { agent_parser_url_transactions: PARSER_URL, agent_parser_url_file: PARSER_URL }, file: { name: 'receipt.pdf', properties: { upload_method: 'attachment' } } });
        expectOwnedByAnotherApp(w, await transactionCreated(w, attached));
    });

    it('O11: the same pair does not own a transaction without an attachment', async () => {
        const w = world({ group: { agent_parser_url_transactions: PARSER_URL, agent_parser_url_file: PARSER_URL } });
        await transactionCreated(w, { id: 'tx_1', date: '2026-11-01', description: 'Coffee', creditAccount: { id: 'account_1' } });
        expect(w.discover).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('O12: the same pair does not own an attachment whose file was not uploaded as one; both apps skip it', async () => {
        const w = world({ group: { agent_parser_url_transactions: PARSER_URL, agent_parser_url_file: PARSER_URL }, file: { name: 'receipt.pdf' } });
        expectSkipped(w, await transactionCreated(w, attached));
        expect(w.lookupParserUrl).not.toHaveBeenCalled();
    });

    for (const summary of ['extractor_transactions_summary', 'transactions_summary']) {
        it(`O13: a file with ${summary} is skipped by both apps`, async () => {
            const w = world({ group: { agent_parser_url_transactions: PARSER_URL }, file: { properties: { account_id: 'account_1', [summary]: '[]' } } });
            expectSkipped(w, await fileCreated(w));
            expect(w.lookupParserUrl).not.toHaveBeenCalled();
        });
    }

    it('O14: a file uploaded as an attachment is skipped by both apps on upload', async () => {
        const w = world({ group: { agent_parser_url_transactions: PARSER_URL }, file: { properties: { account_id: 'account_1', upload_method: 'attachment' } } });
        expectSkipped(w, await fileCreated(w));
        expect(w.lookupParserUrl).not.toHaveBeenCalled();
    });
});

describe('Drafts recorded from a file by another app', () => {
    for (const property of ['extractor_file_id_', 'agent_file_id_']) {
        it(`${property === 'extractor_file_id_' ? 'E1' : 'E2'}: a new transaction with ${property} is left alone`, async () => {
            const w = world({});
            const result = await transactionCreated(w, { id: 'tx_1', date: '2026-11-01', description: 'Row', creditAccount: { id: 'account_1' }, properties: { [property]: 'file_1', auto_filled_date_: 'true' } });
            expectSkipped(w, result);
        });
    }

    it('E3: a new transaction without them is discovered and extracted as before', async () => {
        const w = world({});
        await transactionCreated(w, { id: 'tx_1', date: '2026-11-01', description: 'Row', creditAccount: { id: 'account_1' }, properties: { auto_filled_date_: 'true' } });
        expect(w.discover).toHaveBeenCalledTimes(1);
        expect(w.ai).toHaveBeenCalledWith('amount');
        expect(w.ai).toHaveBeenCalledWith('date');
    });
});
