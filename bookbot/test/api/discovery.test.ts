import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Account, Bkper, Book, Group, Transaction, TransactionList, User } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { discoverItems } from '../../src/api/discovery.js';
import type { components } from '../../src/api/generated/types.js';
import { AGENT_DISCOVERED_PROPERTIES_PROPERTY, PARSED_ACCOUNT_NAME_PROPERTY } from '../../src/constants.js';
import { BkperAIClientError } from '../../src/genai/BkperAIClientError.js';
import { ExtractorDescriptionParts } from '../../src/genai/ExtractorDescriptionParts.js';
import { Discovery } from '../../src/services/DiscoveryService.js';

class TestAccount extends Account {
    override async getGroups(): Promise<Group[]> {
        return [];
    }
}

class TestBook extends Book {
    readonly accounts = new Map<string, Account>();
    readonly queries: string[] = [];
    history: bkper.Transaction[] = [];
    historyError?: Error;
    afterRead?: () => void;
    stored?: Transaction;

    constructor(id = 'synthetic-book', permission: bkper.Book['permission'] = 'VIEWER') {
        super({ id, permission });
        for (const name of ['bank', 'expense']) {
            this.accounts.set(name, new TestAccount(this, { id: name, name, properties: { agent_discovery_examples: 'synthetic' } }));
        }
    }

    override async getAccount(id?: string): Promise<Account | undefined> {
        return id ? this.accounts.get(id) : undefined;
    }

    override async listTransactions(query: string, limit?: number): Promise<TransactionList> {
        this.queries.push(query);
        if (this.historyError) throw this.historyError;
        this.afterRead?.();
        return new TransactionList(this, { items: this.history.slice(0, limit) });
    }

    override async getTransaction(): Promise<Transaction | undefined> {
        return this.stored;
    }
}

class TestBkper extends Bkper {
    readonly loads: string[] = [];
    readonly books = new Map<string, Book>();

    override async getBook(id: string): Promise<Book> {
        this.loads.push(id);
        const book = this.books.get(id);
        if (!book) throw new Error('Synthetic unavailable Book');
        return book;
    }

    override async getUser(): Promise<User> {
        return new User({ username: 'verified-user' });
    }
}

class TestExtractor extends ExtractorDescriptionParts {
    calls = 0;
    error?: Error;

    override async extract(): Promise<string[]> {
        this.calls++;
        if (this.error) throw this.error;
        return ['Synthetic purchase'];
    }
}

class TestContext extends AppContext {
    readonly extractor = new TestExtractor(this.env);

    constructor(bkper: TestBkper) {
        super(bkper, { BKPER_AI_BASE_URL: 'https://ai.bkper.app/v1' });
    }

    override createExtractorDescriptionParts(): ExtractorDescriptionParts {
        return this.extractor;
    }
}

function fixture(book = new TestBook()) {
    const bkper = new TestBkper();
    bkper.books.set(book.getId()!, book);
    return { book, bkper, context: new TestContext(bkper) };
}

function item(itemId = 'row-1', bookId = 'synthetic-book'): components['schemas']['DiscoveryItem'] {
    return {
        itemId, bookId,
        transaction: { description: 'Synthetic purchase', creditAccount: { id: 'bank' }, properties: { project: 'caller' }, posted: false },
    };
}

function matchingHistory(): bkper.Transaction[] {
    return Array.from({ length: 3 }, () => ({
        description: 'Synthetic purchase', creditAccount: { id: 'bank' }, debitAccount: { id: 'expense' },
        properties: { project: 'history', department: 'synthetic' }, posted: true,
    }));
}

afterEach(() => mock.restore());

describe('read-only discovery adapter', () => {
    it('preserves supplied fields and discovers only missing Accounts and properties with legacy provenance', async () => {
        const { book, context } = fixture();
        book.history = matchingHistory();
        const input = item();
        input.sourceAccount = { id: 'bank', properties: { agent_excluded_properties: 'department' } };
        input.transaction.creditAccount = { id: 'bank', name: 'Caller account metadata' };
        input.transaction.properties = { project: 'caller', agent_description_part_: 'caller provenance' };
        const original = structuredClone(input);
        const [result] = await discoverItems([input], context);

        expect(result.outcome).toBe('changed');
        expect(result.transaction.creditAccount).toEqual(input.transaction.creditAccount);
        expect(result.transaction.debitAccount?.id).toBe('expense');
        expect(result.transaction.properties).toEqual({
            project: 'caller', department: 'synthetic', agent_description_part_: 'Synthetic purchase',
            agent_debit_account_id_: 'expense', [AGENT_DISCOVERED_PROPERTIES_PROPERTY]: '["department"]',
        });
        expect(result.transaction.posted).toBe(false);
        expect(input).toEqual(original);
        expect(result).not.toHaveProperty('dataSet');
    });

    it('returns the existing discovery JSON, including consumed context and updated internal provenance', async () => {
        const { book, context } = fixture();
        book.history = matchingHistory();
        const input = item();
        delete input.transaction.creditAccount;
        input.transaction.description = 'bank Synthetic purchase';
        input.transaction.properties = {
            project: 'caller',
            [PARSED_ACCOUNT_NAME_PROPERTY]: 'bank',
            agent_description_part_: 'old description part',
            agent_debit_account_id_: 'old-expense',
            [AGENT_DISCOVERED_PROPERTIES_PROPERTY]: '["missing","project"]',
        };
        input.sourceAccount = { id: 'bank' };
        const original = structuredClone(input);
        const draft = new Transaction(book, structuredClone(input.transaction));
        const discovery = context.createDiscovery();
        const discovered = await discovery.discover(draft);
        const account = await book.getAccount('bank');
        if (account && discovered.dataSet) await discovery.discoverProperties(account, draft, discovered.dataSet);
        const [result] = await discoverItems([input], context);

        expect(result.transaction).toEqual(draft.json());
        // The SDK encodes property removal as an empty value in the canonical payload.
        expect(result.transaction.properties?.[PARSED_ACCOUNT_NAME_PROPERTY]).toBe('');
        expect(result.transaction.properties?.agent_debit_account_id_).toBe('expense');
        expect(result.transaction.properties?.[AGENT_DISCOVERED_PROPERTIES_PROPERTY]).toBe('["department","project"]');
        expect(input).toEqual(original);
    });

    it('single and batch return equivalent correlated items while sharing only same-Book request caches', async () => {
        const { book, bkper, context } = fixture();
        book.history = matchingHistory();
        const inputs = [item('first'), item('second')];
        const batch = await discoverItems(inputs, context);
        const expected = await Promise.all(inputs.map(input => {
            const separate = fixture();
            separate.book.history = matchingHistory();
            return discoverItems([input], separate.context).then(results => results[0]);
        }));

        expect(batch).toEqual(expected);
        expect(bkper.loads).toEqual(['synthetic-book']);
        expect(context.extractor.calls).toBe(1);
        expect(book.queries).toHaveLength(1);
        await discoverItems([item()], context);
        expect(context.extractor.calls).toBe(2);
        expect(book.queries).toHaveLength(2);
    });

    it('isolates caches and membership checks across target Books', async () => {
        const { book, bkper, context } = fixture();
        book.history = matchingHistory();
        const other = new TestBook('other-book');
        other.accounts.delete('expense');
        other.accounts.set('other-expense', new TestAccount(other, { id: 'other-expense' }));
        other.history = matchingHistory().map(tx => ({ ...tx, debitAccount: { id: 'other-expense' } }));
        bkper.books.set('other-book', other);
        const results = await discoverItems([item('first'), item('second', 'other-book')], context);

        expect(results.map(result => result.transaction.debitAccount?.id)).toEqual(['expense', 'other-expense']);
        expect(bkper.loads).toEqual(['synthetic-book', 'other-book']);
        expect(context.extractor.calls).toBe(2);
    });

    it('distinguishes an early no-change from a valid no-match and dependency failure', async () => {
        const { book, context } = fixture();
        const complete = item('complete');
        complete.transaction.debitAccount = { id: 'expense' };
        const results = await discoverItems([complete, item('unmatched')], context);
        expect(results.map(result => result.outcome)).toEqual(['no_change', 'no_match']);
        expect(results.every(result => !result.error)).toBe(true);

        book.historyError = new Error('Private history error and query');
        const failed = await discoverItems([item()], context);
        expect(failed[0].outcome).toBe('error');
        expect(failed[0].error?.code).toBe('DEPENDENCY_ERROR');
        expect(JSON.stringify(failed)).not.toContain('Private history');
    });

    it('rejects known, source and suggested Accounts absent from the authorized Book', async () => {
        const { book, context } = fixture();
        const known = item('known');
        known.transaction.creditAccount = { id: 'foreign' };
        const source = item('source');
        source.sourceAccount = { id: 'foreign' };
        book.history = matchingHistory().map(tx => ({ ...tx, debitAccount: { id: 'foreign' } }));
        const inputs = [known, source, item('suggested')];
        const results = await discoverItems(inputs, context);

        expect(results.map(result => result.error?.code)).toEqual(['INVALID_ACCOUNT', 'INVALID_ACCOUNT', 'INVALID_ACCOUNT']);
        expect(results.map(result => result.transaction)).toEqual(inputs.map(input => input.transaction));
    });

    it('authorizes every target Book with read permissions, without requiring installation', async () => {
        const { bkper, context } = fixture();
        const inputs: components['schemas']['DiscoveryItem'][] = [];
        for (const permission of ['VIEWER', 'POSTER', 'EDITOR', 'OWNER', 'RECORDER', 'NONE'] as const) {
            const book = new TestBook(permission, permission);
            bkper.books.set(permission, book);
            const input = item(permission, permission);
            input.transaction.debitAccount = { id: 'expense' };
            inputs.push(input);
        }
        const apps = spyOn(Book.prototype, 'getApps');
        const results = await discoverItems(inputs, context);

        expect(results.map(result => result.outcome)).toEqual(['no_change', 'no_change', 'no_change', 'no_change', 'error', 'error']);
        expect(bkper.loads).toEqual(inputs.map(input => input.bookId));
        expect(apps).not.toHaveBeenCalled();
        expect(results.slice(4).every(result => result.error?.code === 'FORBIDDEN')).toBe(true);
    });

    it('uses only a verified creator for the creator-specific history tier, preserving supplied identity fields', async () => {
        const { book, context } = fixture();
        book.history = matchingHistory();
        book.stored = new Transaction(book, { id: 'existing', createdBy: 'stored-creator' });
        const current = item('current');
        current.transaction.createdBy = 'verified-user';
        const stored = item('stored');
        stored.transaction.id = 'existing';
        stored.transaction.createdBy = 'stored-creator';
        const unverified = item('unverified');
        unverified.transaction.createdBy = 'unverified-creator';
        const results = await discoverItems([current, stored, unverified], context);

        expect(book.queries).toEqual([
            'account: \'bank\' "Synthetic purchase" createdBy:verified-user is:posted',
            'account: \'bank\' "Synthetic purchase" createdBy:stored-creator is:posted',
            'account: \'bank\' "Synthetic purchase" is:posted',
        ]);
        expect(results.map(result => result.transaction.createdBy)).toEqual(['verified-user', 'stored-creator', 'unverified-creator']);
    });

    it('keeps successful batch items when another fails and discards the failed item local mutations', async () => {
        const { book, context } = fixture();
        book.history = matchingHistory();
        const denied = item('denied', 'unavailable-book');
        const results = await discoverItems([denied, item('success')], context);
        expect(results.map(result => result.outcome)).toEqual(['error', 'changed']);
        expect(results[0].transaction).toEqual(denied.transaction);

        context.extractor.error = new BkperAIClientError(429, 'usage_limit_exceeded', 'Private allowance details', false);
        const parsed = item('parsed');
        delete parsed.transaction.creditAccount;
        parsed.transaction.description = 'bank Different purchase';
        parsed.transaction.properties = { [PARSED_ACCOUNT_NAME_PROPERTY]: 'bank' };
        const [failed] = await discoverItems([parsed], context);
        expect(failed.error).toEqual({ code: 'usage_limit_exceeded', message: 'Bkper AI allowance is exhausted.' });
        expect(failed.transaction).toEqual(parsed.transaction);
    });

    it('reports swallowed property enrichment failures without returning partial suggestions', async () => {
        const { book, context } = fixture();
        book.history = matchingHistory();
        spyOn(context.promptLookupService, 'lookupPropertySkipKeys').mockRejectedValue(new Error('Private policy details'));
        const input = item();
        input.sourceAccount = { id: 'bank' };
        const [result] = await discoverItems([input], context);

        expect(result.error?.code).toBe('DEPENDENCY_ERROR');
        expect(result.transaction).toEqual(input.transaction);
        expect(JSON.stringify(result)).not.toContain('Private policy');
    });

    it('never calls recording, posting or configuration writes, including failed and cancelled requests', async () => {
        const { book, context } = fixture();
        book.history = matchingHistory();
        const writes = [
            spyOn(Transaction.prototype, 'create'), spyOn(Transaction.prototype, 'update'), spyOn(Transaction.prototype, 'post'),
            spyOn(Book.prototype, 'batchUpdateTransactions'), spyOn(Book.prototype, 'batchCreateTransactions'), spyOn(Book.prototype, 'update'),
            spyOn(Account.prototype, 'update'), spyOn(Group.prototype, 'update'),
        ];
        await discoverItems([item()], context);
        await discoverItems([item('failed', 'unavailable-book')], context);
        const controller = new AbortController();
        book.afterRead = () => controller.abort();
        const results = await discoverItems([item('cancelled'), item('never-started')], context, controller.signal);

        expect(results.map(result => result.error?.code)).toEqual(['REQUEST_ABORTED', 'REQUEST_ABORTED']);
        expect(results.every(result => result.transaction.debitAccount === undefined)).toBe(true);
        for (const write of writes) expect(write).not.toHaveBeenCalled();
    });

    it('reports the existing discovery limit instead of pretending it is no match', async () => {
        const { context } = fixture();
        spyOn(Discovery.prototype, 'getExternalRequestCount').mockReturnValue(951);
        const [result] = await discoverItems([item()], context);
        expect(result.error?.code).toBe('DISCOVERY_LIMIT');
        expect(result.outcome).toBe('error');
        expect(result.transaction).toEqual(item().transaction);
    });
});
