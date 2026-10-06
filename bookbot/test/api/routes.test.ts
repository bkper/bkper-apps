import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import { Account, Bkper, Book, TransactionList } from 'bkper-js';
import app from '../../src/index.js';
import { DiscoveryBatchResultSchema, DiscoveryResultSchema, ErrorResponseSchema } from '../../src/api/schemas.js';
import type { components } from '../../src/api/generated/types.js';

const book = new Book({ id: 'synthetic-book', permission: 'VIEWER' });
const env: Env = { BKPER_AI_BASE_URL: 'https://ai.bkper.app/v1' };

afterEach(() => mock.restore());

it('accepts and returns the canonical transaction without writing when both sides are supplied', async () => {
    const loadBook = spyOn(Bkper.prototype, 'getBook').mockResolvedValue(book);
    spyOn(Book.prototype, 'getAccount').mockImplementation(async id => id ? new Account(book, { id }) : undefined);
    const input: components['schemas']['DiscoveryItem'] = {
        itemId: 'row-1',
        bookId: 'synthetic-book',
        transaction: {
            id: 'existing-draft',
            amount: '12.34',
            date: '2026-01-02',
            description: 'Synthetic purchase',
            creditAccount: { id: 'bank', name: 'Supplied Bank' },
            debitAccount: { id: 'expense' },
            properties: { project: 'supplied' },
            posted: false,
        },
    };
    const response = await app.request('/api/v1/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    }, env);

    expect(response.status).toBe(200);
    expect(DiscoveryResultSchema.parse(await response.json())).toEqual({ ...input, outcome: 'no_change' });
    expect(loadBook).toHaveBeenCalledWith('synthetic-book');
});

it('rejects invalid fields and duplicate correlation IDs before Book access', async () => {
    const loadBook = spyOn(Bkper.prototype, 'getBook');
    const bodies = [
        { itemId: 'row', bookId: 'synthetic-book', transaction: { tags: ['ok', 123] } },
        { itemId: 'row', bookId: 'synthetic-book', transaction: { creditAccount: { name: 'missing ID' } } },
        { itemId: 'row', bookId: 'synthetic-book', transaction: { properties: { bad: 123 } } },
        { items: Array.from({ length: 2 }, () => ({ itemId: 'duplicate', bookId: 'synthetic-book', transaction: {} })) },
    ];
    for (const body of bodies) {
        const response = await app.request('items' in body ? '/api/v1/discovery/batch' : '/api/v1/discovery', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }, env);
        expect(response.status).toBe(400);
        expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('INVALID_REQUEST');
    }
    expect(loadBook).not.toHaveBeenCalled();
});

it('uses the same item contract for batches without introducing the proposed small batch cap', async () => {
    spyOn(Bkper.prototype, 'getBook').mockResolvedValue(book);
    spyOn(Book.prototype, 'getAccount').mockImplementation(async id => id ? new Account(book, { id }) : undefined);
    const inputs: components['schemas']['DiscoveryItem'][] = Array.from({ length: 11 }, (_, index) => ({
        itemId: `row-${index}`, bookId: 'synthetic-book',
        transaction: { creditAccount: { id: 'bank' }, debitAccount: { id: 'expense' }, posted: false },
    }));
    const response = await app.request('/api/v1/discovery/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: inputs }),
    }, env);
    const results = DiscoveryBatchResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(results.items).toEqual(inputs.map(input => ({ ...input, outcome: 'no_change' })));
});

it('uses Platform SDK configuration and reports an actual swallowed AI allowance failure', async () => {
    let apiConfig: ReturnType<Bkper['getConfig']> | undefined;
    spyOn(Bkper.prototype, 'getBook').mockImplementation(async function (this: Bkper) {
        apiConfig = this.getConfig();
        return book;
    });
    spyOn(Book.prototype, 'listTransactions').mockResolvedValue(new TransactionList(book, { items: [{
        creditAccount: { id: 'bank' }, debitAccount: { id: 'expense' }, posted: true,
    }] }));
    spyOn(Book.prototype, 'getAccount').mockImplementation(async id => id ? new Account(book, { id }) : undefined);
    const outbound: Request[] = [];
    spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        outbound.push(request);
        return Response.json({ error: { code: 'usage_limit_exceeded', message: 'Allowance exhausted.' } }, { status: 429 });
    }, { preconnect: globalThis.fetch.preconnect }));
    const input: components['schemas']['DiscoveryItem'] = {
        itemId: 'row', bookId: 'synthetic-book', transaction: { description: 'Synthetic purchase', posted: false },
    };
    const response = await app.request('/api/v1/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer never-forward-this', 'bkper-agent-id': 'untrusted-app' },
        body: JSON.stringify(input),
    }, env);
    const result = DiscoveryResultSchema.parse(await response.json());

    expect(result.outcome).toBe('error');
    expect(result.error?.code).toBe('usage_limit_exceeded');
    expect(result.transaction).toEqual(input.transaction);
    expect(apiConfig?.oauthTokenProvider).toBeUndefined();
    expect(apiConfig?.agentIdProvider).toBeUndefined();
    expect(outbound).toHaveLength(1);
    expect(outbound[0].headers.get('Authorization')).toBe('Bearer bkper-platform-outbound');
    expect(outbound[0].headers.get('bkper-ai-source')).toBe('bookbot');
    expect(outbound[0].headers.get('bkper-agent-id')).not.toBe('untrusted-app');
    expect(await outbound[0].text()).not.toContain('never-forward-this');

    const batchResponse = await app.request('/api/v1/discovery/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [input, { ...input, itemId: 'second-row' }] }),
    }, env);
    const batch = DiscoveryBatchResultSchema.parse(await batchResponse.json());
    expect(batch.items.map(result => result.outcome)).toEqual(['error', 'error']);
    expect(outbound).toHaveLength(3);
});
