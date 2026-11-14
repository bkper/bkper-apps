/// <reference types="@bkper/bkper-api-types" />

import { describe, expect, it, mock } from 'bun:test';
import { Account, Book, Transaction } from 'bkper-js';
import { BOOKBOT_API_BASE_URL, BookbotDiscoveryClient } from '../../src/services/BookbotDiscoveryClient.js';

const book = { getId: () => 'book_1' } as unknown as Book;

function draft(payload: bkper.Transaction): Transaction {
    return new Transaction(book, structuredClone(payload));
}

function respondWith(body: unknown, status = 200) {
    return mock(async (_input: string, _init: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function sentBody(fetcher: ReturnType<typeof respondWith>): any {
    return JSON.parse(String(fetcher.mock.calls[0][1].body));
}

describe('BookbotDiscoveryClient', () => {
    it('calls production Bookbot from every environment', () => {
        expect(BOOKBOT_API_BASE_URL).toBe('https://bookbot.bkper.app');
    });

    it('sends one batch for the target Book without credentials or attached files', async () => {
        const fetcher = respondWith({ items: [] });
        const transaction = draft({
            description: 'Monthly rent',
            amount: '1500',
            draft: true,
            creditAccount: { id: 'bank' },
            files: [{ id: 'file_1', content: 'base64==' }],
            properties: { agent_file_id_: 'file_1' },
        });

        await new BookbotDiscoveryClient(fetcher, 'https://bookbot.test').discover('book_1', [
            { transaction, sourceAccount: new Account(book, { id: 'bank', name: 'Bank Account', properties: { secret: 'x' } }) },
            { transaction: draft({ description: 'Adobe subscription' }) },
        ]);

        expect(fetcher).toHaveBeenCalledTimes(1);
        const [url, init] = fetcher.mock.calls[0];
        expect(url).toBe('https://bookbot.test/api/v1/complete/batch');
        expect(init.method).toBe('POST');
        expect(new Headers(init.headers).get('Authorization')).toBeNull();
        const body = sentBody(fetcher);
        expect(body.items.map((item: any) => [item.itemId, item.bookId])).toEqual([['0', 'book_1'], ['1', 'book_1']]);
        expect(body.items[0].transaction.files).toBeUndefined();
        expect(body.items[0].transaction.description).toBe('Monthly rent');
        expect(body.items[0].sourceAccount).toEqual({ id: 'bank' });
        expect(body.items[1].sourceAccount).toBeUndefined();
        // The local draft keeps its attached file.
        expect(transaction.payload.files).toHaveLength(1);
    });

    it('applies discovered Accounts and properties while keeping extracted fields', async () => {
        const transaction = draft({
            description: 'Adobe subscription',
            amount: '60',
            date: '2026-10-05',
            draft: true,
            creditAccount: { id: 'bank' },
            files: [{ id: 'file_1' }],
            properties: { agent_file_id_: 'file_1' },
        });
        const fetcher = respondWith({
            items: [{
                itemId: '0',
                bookId: 'book_1',
                outcome: 'changed',
                transaction: {
                    description: 'Adobe subscription',
                    amount: '60',
                    creditAccount: { id: 'bank' },
                    debitAccount: { id: 'software' },
                    properties: { agent_file_id_: 'file_1', agent_debit_account_id_: 'software', vendor: 'Adobe', agent_discovered_properties_: '["vendor"]' },
                },
            }],
        });

        const result = await new BookbotDiscoveryClient(fetcher).discover('book_1', [{ transaction }]);

        expect(result).toEqual({ outcomes: ['changed'] });
        expect(transaction.payload.creditAccount).toEqual({ id: 'bank' });
        expect(transaction.payload.debitAccount).toEqual({ id: 'software' });
        expect(transaction.payload.properties).toEqual({ agent_file_id_: 'file_1', agent_debit_account_id_: 'software', vendor: 'Adobe', agent_discovered_properties_: '["vendor"]' });
        expect(transaction.payload.amount).toBe('60');
        expect(transaction.payload.date).toBe('2026-10-05');
        expect(transaction.payload.draft).toBe(true);
        expect(transaction.payload.files).toEqual([{ id: 'file_1' }]);
    });

    it('applies an amount and date Bookbot read from the description', async () => {
        const transaction = draft({ description: 'Lunch 25 on 12/11', date: '2026-11-14', creditAccount: { id: 'bank' }, properties: { auto_filled_date_: 'true' } });
        const fetcher = respondWith({
            items: [{
                itemId: '0', bookId: 'book_1', outcome: 'changed',
                transaction: { description: 'Lunch 25 on 12/11', amount: '25', date: '2026-11-12', creditAccount: { id: 'bank' }, properties: { auto_filled_date_: 'true' } },
            }],
        });

        await new BookbotDiscoveryClient(fetcher).discover('book_1', [{ transaction }]);

        expect(transaction.payload.amount).toBe('25');
        expect(transaction.payload.date).toBe('2026-11-12');
    });

    it('correlates results by item ID and reports per-item failures without touching failed drafts', async () => {
        const first = draft({ description: 'Monthly rent', creditAccount: { id: 'bank' } });
        const second = draft({ description: 'Unknown vendor', creditAccount: { id: 'bank' }, properties: { keep: 'me' } });
        const fetcher = respondWith({
            items: [
                { itemId: '1', bookId: 'book_1', outcome: 'error', error: { code: 'DEPENDENCY_ERROR', message: 'A discovery dependency failed.' }, transaction: { description: 'Unknown vendor', creditAccount: { id: 'other' } } },
                { itemId: '0', bookId: 'book_1', outcome: 'changed', transaction: { description: 'Monthly rent', creditAccount: { id: 'bank' }, debitAccount: { id: 'rent' }, properties: {} } },
            ],
        });

        const result = await new BookbotDiscoveryClient(fetcher).discover('book_1', [{ transaction: first }, { transaction: second }]);

        expect(result.outcomes).toEqual(['changed', 'error']);
        expect(result.error).toEqual({ code: 'DEPENDENCY_ERROR', message: 'A discovery dependency failed.' });
        expect(first.payload.debitAccount).toEqual({ id: 'rent' });
        expect(second.payload.creditAccount).toEqual({ id: 'bank' });
        expect(second.payload.debitAccount).toBeUndefined();
        expect(second.payload.properties).toEqual({ keep: 'me' });
    });

    it('passes no-match outcomes through', async () => {
        const transaction = draft({ description: 'Office supplies at Staples', creditAccount: { id: 'cash' } });
        const fetcher = respondWith({ items: [{ itemId: '0', bookId: 'book_1', outcome: 'no_match', transaction: { description: 'Office supplies at Staples', creditAccount: { id: 'cash' } } }] });

        const result = await new BookbotDiscoveryClient(fetcher).discover('book_1', [{ transaction }]);

        expect(result).toEqual({ outcomes: ['no_match'] });
        expect(transaction.payload.debitAccount).toBeUndefined();
    });

    it('treats HTTP failures as discovery failures for every item', async () => {
        const transaction = draft({ description: 'Monthly rent', creditAccount: { id: 'bank' } });
        const result = await new BookbotDiscoveryClient(respondWith({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401)).discover('book_1', [{ transaction }, { transaction: draft({ description: 'b' }) }]);

        expect(result.outcomes).toEqual(['error', 'error']);
        expect(result.error?.code).toBe('HTTP_401');
        expect(transaction.payload.debitAccount).toBeUndefined();
    });

    it('treats an unreachable Bookbot as a discovery failure', async () => {
        const fetcher = mock(async () => { throw new TypeError('fetch failed'); });
        const result = await new BookbotDiscoveryClient(fetcher).discover('book_1', [{ transaction: draft({ description: 'Monthly rent' }) }]);

        expect(result).toEqual({ outcomes: ['error'], error: { code: 'UNAVAILABLE', message: 'Bookbot discovery is unavailable.' } });
    });

    it('rejects responses without an items array', async () => {
        const result = await new BookbotDiscoveryClient(respondWith({ ok: true })).discover('book_1', [{ transaction: draft({ description: 'Monthly rent' }) }]);

        expect(result.outcomes).toEqual(['error']);
        expect(result.error?.code).toBe('INVALID_RESPONSE');
    });

    it('reports an item missing from the response as a failure', async () => {
        const result = await new BookbotDiscoveryClient(respondWith({ items: [] })).discover('book_1', [{ transaction: draft({ description: 'Monthly rent' }) }]);

        expect(result.outcomes).toEqual(['error']);
        expect(result.error?.code).toBe('INVALID_RESPONSE');
    });

    it('propagates cancellation instead of reporting an outage', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetcher = mock(async (_input: string, init: RequestInit) => {
            init.signal?.throwIfAborted();
            return new Response('{}');
        });

        await expect(new BookbotDiscoveryClient(fetcher, undefined, controller.signal).discover('book_1', [{ transaction: draft({ description: 'Monthly rent' }) }])).rejects.toThrow();
    });

    it('does not call Bookbot without items', async () => {
        const fetcher = respondWith({ items: [] });
        expect(await new BookbotDiscoveryClient(fetcher).discover('book_1', [])).toEqual({ outcomes: [] });
        expect(fetcher).not.toHaveBeenCalled();
    });
});
