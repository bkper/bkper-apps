import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Account, Amount, Bkper, BkperError, Book, File, Group, Permission, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { parse } from '../../src/api/parse.js';
import { BkperAIResponsesClient } from '../../src/genai/BkperAIResponsesClient.js';
import { BkperAIClientError } from '../../src/genai/BkperAIClientError.js';
import { ExtractorInvoice } from '../../src/genai/invoice/ExtractorInvoice.js';
import { ExtractorStatementCSV } from '../../src/genai/statement/csv/ExtractorStatementCSV.js';
import { ExtractorAmount } from '../../src/genai/ExtractorAmount.js';
import { ExtractorDate } from '../../src/genai/ExtractorDate.js';
import { ExtractorFileProperties } from '../../src/genai/file/ExtractorFileProperties.js';
import { ExtractorFileClassification } from '../../src/genai/file/ExtractorFileClassification.js';

const originalGenerate = BkperAIResponsesClient.prototype.generate;
const originalTransactionCreate = Transaction.prototype.create;
const originalTransactionUpdate = Transaction.prototype.update;
const originalFileCreate = File.prototype.create;
const originalFileUpdate = File.prototype.update;
const originalAccountUpdate = Account.prototype.update;
const originalGroupUpdate = Group.prototype.update;
const resourceWrites = mock(async () => { throw new Error('API must not write resources'); });
beforeEach(() => {
    resourceWrites.mockClear();
    Transaction.prototype.create = Transaction.prototype.update = resourceWrites;
    File.prototype.create = File.prototype.update = resourceWrites;
    Account.prototype.update = Group.prototype.update = resourceWrites;
});
afterEach(() => {
    expect(resourceWrites).not.toHaveBeenCalled();
    BkperAIResponsesClient.prototype.generate = originalGenerate;
    Transaction.prototype.create = originalTransactionCreate;
    Transaction.prototype.update = originalTransactionUpdate;
    File.prototype.create = originalFileCreate;
    File.prototype.update = originalFileUpdate;
    Account.prototype.update = originalAccountUpdate;
    Group.prototype.update = originalGroupUpdate;
});

function setup(permission = Permission.VIEWER) {
    const book = new Book({ id: 'book_1', permission, fractionDigits: 2 });
    book.getAccounts = mock(async () => []);
    const bkper = new Bkper();
    bkper.getBook = mock(async () => book);
    const context = new AppContext(bkper, {} as Env, 'test-token', undefined, true);
    const writes = mock(async () => { throw new Error('API must not write'); });
    book.batchCreateTransactions = writes;
    book.batchUpdateTransactions = writes;
    book.update = writes;
    return { book, bkper, context, writes };
}

const file: bkper.File = { name: 'statement.csv', contentType: 'text/csv', content: 'ZGF0ZSxhbW91bnQ=' };

describe('read-only parse', () => {
    it('auto-routes a CSV and returns canonical, unrecorded transactions without mutating input', async () => {
        const { context, writes } = setup();
        const extract = mock(async () => ({ transactions: [{ date: null, description: 'Row', amount: -12.5, properties: { count: 2 } }] }));
        context.createExtractorStatementCSV = () => ({ extract }) as unknown as ExtractorStatementCSV;
        const input = { bookId: 'book_1', file: structuredClone(file) };
        const before = structuredClone(input);
        const result = await parse(input, context);
        expect(result.outcome).toBe('parsed');
        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0]).toMatchObject({ bookId: 'book_1', transaction: { amount: '-12.5', description: 'Row', properties: { count: '2' }, draft: true, posted: false } });
        expect(result.transactions[0].transaction.id).toBeUndefined();
        expect(result.transactions[0].transaction.date).toBeUndefined();
        expect(input).toEqual(before);
        expect(writes).not.toHaveBeenCalled();
        expect(extract).toHaveBeenCalledTimes(1);
    });

    it('requires primary Book access before extraction and does not check installation', async () => {
        const { context, book, writes } = setup(Permission.NONE);
        const extract = mock(async () => ({ transactions: [] }));
        context.createExtractorStatementCSV = () => ({ extract }) as unknown as ExtractorStatementCSV;
        book.getApps = mock(async () => { throw new Error('Installation is not required'); });
        expect(await parse({ bookId: 'book_1', file }, context)).toMatchObject({ outcome: 'error', error: { code: 'FORBIDDEN' }, transactions: [] });
        expect(extract).not.toHaveBeenCalled();
        expect(book.getApps).not.toHaveBeenCalled();
        expect(writes).not.toHaveBeenCalled();
    });

    it('authorizes extracted cross-Book targets and resolves account overrides there', async () => {
        const { context, bkper, writes } = setup();
        const target = new Book({ id: 'book_2', permission: Permission.VIEWER, fractionDigits: 2 });
        const account = new Account(target, { id: 'account_2', name: 'Bank', type: 'ASSET' });
        target.getAccount = mock(async () => account);
        const source = await bkper.getBook('book_1');
        bkper.getBook = mock(async id => id === 'book_2' ? target : source);
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => ({ transactions: [{ date: '2024-01-02', description: 'Row', amount: -10, properties: {}, book_id: 'book_2', account_name: 'Bank' }] })) }) as unknown as ExtractorStatementCSV;
        const result = await parse({ bookId: 'book_1', file }, context);
        expect(result.transactions[0]).toMatchObject({ bookId: 'book_2', transaction: { creditAccount: { id: 'account_2' } } });
        expect(writes).not.toHaveBeenCalled();
        target.getPermission = () => Permission.NONE;
        expect(await parse({ bookId: 'book_1', file }, context)).toMatchObject({ outcome: 'error', error: { code: 'FORBIDDEN' }, transactions: [] });
    });

    it('returns a row without an Account when its account_name is not in the target Book', async () => {
        const { context, book, writes } = setup();
        book.getAccount = mock(async () => { throw new BkperError(404, 'Account NOT found!', undefined); });
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => ({ transactions: [{ date: '2024-01-02', description: 'Row', amount: -10, properties: {}, account_name: 'Missing Account' }] })) }) as unknown as ExtractorStatementCSV;
        const result = await parse({ bookId: 'book_1', file }, context);
        expect(result.outcome).toBe('parsed');
        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0].transaction.creditAccount).toBeUndefined();
        expect(result.transactions[0].transaction.debitAccount).toBeUndefined();
        expect(writes).not.toHaveBeenCalled();
    });

    it('preserves supplied transaction fields and properties while extracting an attachment', async () => {
        const { book, context, writes } = setup();
        const account = new Account(book, { id: 'account_1', type: 'ASSET' });
        account.getGroups = mock(async () => []);
        book.getAccount = mock(async () => account);
        const extract = mock(async () => ({ date: '2024-02-02', description: 'Extracted', amount: 15, properties: { supplied: 'overwrite', added: 2 } }));
        context.createExtractorInvoice = () => ({ extract }) as unknown as ExtractorInvoice;
        const input = { bookId: 'book_1', file: { ...file, name: 'invoice.pdf' }, transaction: { id: 'existing', date: '2024-01-01', description: 'Supplied', creditAccount: { id: 'account_1' }, properties: { supplied: 'keep' } } };
        const result = await parse(input, context);
        expect(result.transactions[0].transaction).toMatchObject({ date: '2024-01-01', description: 'Supplied', amount: '15', creditAccount: { id: 'account_1' }, properties: { supplied: 'keep', added: '2' } });
        expect(result.transactions[0].transaction.id).toBeUndefined();
        expect(input.transaction.id).toBe('existing');
        expect(writes).not.toHaveBeenCalled();
    });

    it('extracts missing description fields without discovery or writes', async () => {
        const { context, writes } = setup();
        context.createExtractorAmount = () => ({ extract: mock(async () => new Amount('12.5')) }) as unknown as ExtractorAmount;
        context.createExtractorDate = () => ({ extract: mock(async () => '2024-01-02') }) as unknown as ExtractorDate;
        context.createBookbotDiscoveryClient = mock(() => { throw new Error('Raw parsing must not discover'); });
        const result = await parse({ bookId: 'book_1', transaction: { description: 'Payment 12.50 on 2024-01-02' } }, context);
        expect(result.transactions[0].transaction).toMatchObject({ amount: '12.5', date: '2024-01-02' });
        expect(context.createBookbotDiscoveryClient).not.toHaveBeenCalled();
        expect(writes).not.toHaveBeenCalled();
    });

    it('distinguishes empty results, safe dependency failures, and cancellation', async () => {
        const { context } = setup();
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => ({ transactions: [] })) }) as unknown as ExtractorStatementCSV;
        expect(await parse({ bookId: 'book_1', file }, context)).toEqual({ transactions: [], outcome: 'empty', kind: 'transactions' });
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => { throw new Error('private parser response'); }) }) as unknown as ExtractorStatementCSV;
        expect(await parse({ bookId: 'book_1', file }, context)).toEqual({ transactions: [], outcome: 'error', error: { code: 'DEPENDENCY_ERROR', message: 'A parsing dependency failed.' } });
        const signal = AbortSignal.abort();
        expect(await parse({ bookId: 'book_1', file }, context, signal)).toMatchObject({ outcome: 'error', error: { code: 'REQUEST_ABORTED' } });
    });

    it('loads an attachment from the authorized Book and never updates its file', async () => {
        const { book, context, writes } = setup();
        const stored = new File(book, { id: 'file_1', ...file });
        stored.update = writes;
        book.getFile = mock(async () => stored);
        context.createExtractorInvoice = () => ({ extract: mock(async () => ({ date: null, description: 'Invoice', amount: 10, properties: {} })) }) as unknown as ExtractorInvoice;
        context.createExtractorDate = () => ({ extract: mock(async () => undefined) }) as unknown as ExtractorDate;
        const result = await parse({ bookId: 'book_1', transaction: { files: [{ id: 'file_1' }] } }, context);
        expect(result.outcome).toBe('parsed');
        expect(book.getFile).toHaveBeenCalledWith('file_1');
        expect(writes).not.toHaveBeenCalled();
    });

    it('returns configured metadata while retaining distinct import and attachment filters', async () => {
        const { book, context } = setup();
        const account = new Account(book, { id: 'account_1', properties: { agent_parser_file: 'Extract metadata' } });
        account.getGroups = mock(async () => []);
        book.getAccount = mock(async () => account);
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => ({ transactions: [] })) }) as unknown as ExtractorStatementCSV;
        context.createExtractorFileProperties = () => ({ extract: mock(async () => ({ properties: { issuer: 'Bank', pages: 2, agent_hidden: 'hidden', transactions_summary: 'raw parser property' } })) }) as unknown as ExtractorFileProperties;
        const request = { bookId: 'book_1', file: { ...file, properties: { account_id: 'account_1' } } };
        expect(await parse(request, context)).toEqual({ transactions: [], outcome: 'parsed', kind: 'transactions', fileProperties: { issuer: 'Bank', pages: '2' } });
        expect(await parse({ ...request, transaction: { amount: '10', date: '2024-01-01', description: 'Supplied' } }, context)).toEqual({ transactions: [], outcome: 'parsed', fileProperties: { issuer: 'Bank', pages: '2', transactions_summary: 'raw parser property' } });
    });

    it('returns extraction provenance under the new property names only', async () => {
        const { book, context } = setup();
        book.getFile = mock(async () => new File(book, { id: 'file_1', ...file }));
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => ({ transactions: [{ date: null, description: 'Row', amount: -1, properties: {} }] })) }) as unknown as ExtractorStatementCSV;
        const result = await parse({ bookId: 'book_1', file: { id: 'file_1' } }, context);
        const properties = result.transactions[0].transaction.properties ?? {};
        expect(properties.extractor_file_id_).toBe('file_1');
        expect(JSON.parse(properties.extractor_extracted_!)).toMatchObject({ description: 'Row' });
        expect(Object.keys(properties).filter(key => key.startsWith('agent_'))).toEqual([]);
    });

    it('keeps a supplied extraction stored under its old name', async () => {
        const { book, context } = setup();
        book.getFile = mock(async () => new File(book, { id: 'file_1', ...file }));
        context.createExtractorInvoice = () => ({ extract: mock(async () => ({ date: null, description: 'Invoice', amount: 10, properties: {} })) }) as unknown as ExtractorInvoice;
        context.createExtractorDate = () => ({ extract: mock(async () => undefined) }) as unknown as ExtractorDate;
        const result = await parse({ bookId: 'book_1', transaction: { files: [{ id: 'file_1' }], properties: { agent_extracted_: '{"earlier":true}' } } }, context);
        expect(result.transactions[0].transaction.properties).toEqual({ agent_extracted_: '{"earlier":true}' });
    });

    it('drops app-owned keys returned by file metadata extraction on both paths', async () => {
        const { book, context } = setup();
        const account = new Account(book, { id: 'account_1', properties: { extractor_prompt_file: 'Extract metadata' } });
        account.getGroups = mock(async () => []);
        book.getAccount = mock(async () => account);
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => ({ transactions: [] })) }) as unknown as ExtractorStatementCSV;
        context.createExtractorFileProperties = () => ({ extract: mock(async () => ({ properties: { issuer: 'Bank', extractor_transactions_summary: '[]', bookbot_x: 'y' } })) }) as unknown as ExtractorFileProperties;
        const request = { bookId: 'book_1', file: { ...file, properties: { account_id: 'account_1' } } };
        expect((await parse(request, context)).fileProperties).toEqual({ issuer: 'Bank' });
        expect((await parse({ ...request, transaction: { amount: '10', date: '2024-01-01', description: 'Supplied' } }, context)).fileProperties).toEqual({ issuer: 'Bank' });
    });

    it('keeps zero amounts and legacy prompts without lazy migration writes', async () => {
        const { book, context } = setup();
        const account = new Account(book, { id: 'account_1', type: 'ASSET', properties: { agent_prompt_transactions: 'Legacy instructions' } });
        account.getGroups = mock(async () => []);
        book.getAccount = mock(async () => account);
        const before = structuredClone(account.json());
        const extract = mock(async (prompt?: string) => ({ transactions: [{ date: null, description: prompt || '', amount: 0, properties: {} }] }));
        context.createExtractorStatementCSV = () => ({ extract }) as unknown as ExtractorStatementCSV;
        const result = await parse({ bookId: 'book_1', file: { ...file, properties: { account_id: 'account_1' } } }, context);
        expect(result.transactions[0].transaction.amount).toBe('0');
        expect(extract).toHaveBeenCalledWith('Legacy instructions');
        expect(account.json()).toEqual(before);
    });

    it('rejects foreign account/file context and malformed extracted values', async () => {
        const { book, context } = setup();
        book.getAccount = mock(async () => undefined);
        expect(await parse({ bookId: 'book_1', transaction: { creditAccount: { id: 'foreign' } } }, context)).toMatchObject({ outcome: 'error', error: { code: 'INVALID_CONTEXT' } });
        book.getFile = mock(async () => undefined);
        expect(await parse({ bookId: 'book_1', file: { id: 'foreign' } }, context)).toMatchObject({ outcome: 'error', error: { code: 'INVALID_CONTEXT' } });
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => ({ transactions: [{ date: null, description: 'Row', amount: Infinity, properties: {} }] })) }) as unknown as ExtractorStatementCSV;
        expect(await parse({ bookId: 'book_1', file }, context)).toMatchObject({ outcome: 'error', error: { code: 'DEPENDENCY_ERROR' }, transactions: [] });
    });

    it('reports INVALID_CONTEXT when the Book raises a 404 for a foreign Account', async () => {
        const { book, context } = setup();
        book.getAccount = mock(async () => { throw new BkperError(404, 'Account NOT found!', undefined); });
        expect(await parse({ bookId: 'book_1', transaction: { creditAccount: { id: 'foreign' } } }, context)).toMatchObject({ outcome: 'error', error: { code: 'INVALID_CONTEXT' } });
        book.getAccount = mock(async () => { throw new BkperError(403, 'Forbidden', undefined); });
        expect(await parse({ bookId: 'book_1', transaction: { creditAccount: { id: 'bank' } } }, context)).toMatchObject({ outcome: 'error', error: { code: 'FORBIDDEN' } });
    });

    it('reports INVALID_CONTEXT when the Book raises a 404 for a foreign file or group', async () => {
        const { book, context } = setup();
        book.getFile = mock(async () => { throw new BkperError(404, 'File NOT found!', undefined); });
        expect(await parse({ bookId: 'book_1', file: { id: 'foreign' } }, context)).toMatchObject({ outcome: 'error', error: { code: 'INVALID_CONTEXT' } });
        book.getGroup = mock(async () => { throw new BkperError(404, 'Group NOT found!', undefined); });
        expect(await parse({ bookId: 'book_1', file: { ...file, properties: { group_id: 'foreign' } } }, context)).toMatchObject({ outcome: 'error', error: { code: 'INVALID_CONTEXT' } });
        book.getGroup = mock(async () => { throw new BkperError(403, 'Forbidden', undefined); });
        expect(await parse({ bookId: 'book_1', file: { ...file, properties: { group_id: 'group_1' } } }, context)).toMatchObject({ outcome: 'error', error: { code: 'FORBIDDEN' } });
    });

    it('E4: never calls a configured parser URL and extracts with AI on both paths', async () => {
        const { book, context } = setup();
        const group = new Group(book, { id: 'group_1', properties: { extractor_url_transactions: 'https://parser.example.com', extractor_url_file: 'https://parser.example.com' } });
        const account = new Account(book, { id: 'account_1', type: 'ASSET', properties: { agent_parser_url_transaction: 'https://parser.example.com', agent_parser_url_file: 'https://parser.example.com' } });
        account.getGroups = mock(async () => [group]);
        book.getAccount = mock(async () => account);
        book.setProperty('agent_parser_url_transactions', 'https://parser.example.com');
        const originalFetch = globalThis.fetch;
        const fetchMock = mock(async () => { throw new Error('Parser URLs must not be called'); });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => ({ transactions: [{ date: null, description: 'Row', amount: -10, properties: {} }] })) }) as unknown as ExtractorStatementCSV;
        context.createExtractorInvoice = () => ({ extract: mock(async () => ({ date: '2024-01-02', description: 'Invoice', amount: 10, properties: {} })) }) as unknown as ExtractorInvoice;
        try {
            const statement = await parse({ bookId: 'book_1', file: { ...file, properties: { account_id: 'account_1' } } }, context);
            expect(statement).toMatchObject({ outcome: 'parsed', kind: 'transactions', transactions: [{ transaction: { description: 'Row' } }] });
            const attachment = await parse({ bookId: 'book_1', transaction: { creditAccount: { id: 'account_1' }, files: [{ ...file, name: 'invoice.pdf', contentType: 'application/pdf' }] } }, context);
            expect(attachment).toMatchObject({ outcome: 'parsed', transactions: [{ transaction: { description: 'Invoice', amount: '10' } }] });
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('reports the kind of extraction for file requests only', async () => {
        const { context } = setup();
        context.createExtractorStatementCSV = () => ({ extract: mock(async () => ({ transactions: [] })) }) as unknown as ExtractorStatementCSV;
        expect(await parse({ bookId: 'book_1', file }, context)).toEqual({ transactions: [], outcome: 'empty', kind: 'transactions' });
        context.createExtractorFileClassification = () => ({ extract: mock(async () => ({ kind: 'single_transaction' })) }) as unknown as ExtractorFileClassification;
        context.createExtractorInvoice = () => ({ extract: mock(async () => ({ date: '2024-01-02', description: 'Invoice', amount: 10, properties: {} })) }) as unknown as ExtractorInvoice;
        const pdf = { name: 'invoice.pdf', contentType: 'application/pdf', content: 'ZGF0YQ==' };
        expect(await parse({ bookId: 'book_1', file: pdf }, context)).toMatchObject({ outcome: 'parsed', kind: 'transaction' });
        const withTransaction = await parse({ bookId: 'book_1', file: pdf, transaction: { description: 'Supplied', amount: '10', date: '2024-01-01' } }, context);
        expect(withTransaction.kind).toBeUndefined();
        context.createExtractorDate = () => ({ extract: mock(async () => undefined) }) as unknown as ExtractorDate;
        expect((await parse({ bookId: 'book_1', transaction: { description: 'Payment', amount: '10' } }, context)).kind).toBeUndefined();
    });

    it('keeps default amount/date failure handling unchanged outside the API', async () => {
        const { bkper } = setup();
        const context = new AppContext(bkper, {} as Env, 'test-token');
        BkperAIResponsesClient.prototype.generate = mock(async () => { throw new BkperAIClientError(429, 'usage_limit_exceeded', 'Limit reached', false); });
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;
        console.log = console.warn = console.error = mock(() => {});
        try {
            expect(await context.createExtractorAmount().extract('Payment')).toBeNull();
            expect(await context.createExtractorDate().extract('Payment')).toBeUndefined();
        } finally {
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;
        }
    });

    it('reports amount inference failures without logging the private description', async () => {
        const { context } = setup();
        BkperAIResponsesClient.prototype.generate = mock(async () => { throw new BkperAIClientError(429, 'usage_limit_exceeded', 'Private detail', false); });
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;
        const logs = mock(() => {});
        console.log = console.warn = console.error = logs;
        try {
            const result = await parse({ bookId: 'book_1', transaction: { description: 'PRIVATE DESCRIPTION' } }, context);
            expect(result).toMatchObject({ outcome: 'error', error: { code: 'usage_limit_exceeded' } });
            expect(logs).not.toHaveBeenCalled();
        } finally {
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;
        }
    });
});
