import { describe, expect, it } from 'bun:test';
import { Book } from 'bkper-js';

describe('bkper-js merge payload contract', () => {
    it('forwards submitted transaction fields while ID-only payloads preserve default behavior', async () => {
        const originalFetch = globalThis.fetch;
        let request: Request | undefined;
        globalThis.fetch = async (input, init) => {
            request = new Request(input, init);
            return Response.json({ transaction: { id: 'merged' } });
        };

        const primary: bkper.Transaction & { id: string } = {
            id: 'primary',
            date: '2026-08-04',
            amount: '42.50',
            description: 'User-resolved description',
            creditAccount: { id: 'bank' },
            debitAccount: { id: 'expense' },
            properties: { source: 'resolved' },
        };
        const secondary: bkper.Transaction & { id: string } = { id: 'secondary' };

        try {
            const book = new Book({ id: 'book' });
            await book.mergeTransactions(primary, secondary);
        } finally {
            globalThis.fetch = originalFetch;
        }

        expect(request?.method).toBe('PATCH');
        expect(await request?.json()).toEqual({ items: [primary, secondary] });
    });
});
