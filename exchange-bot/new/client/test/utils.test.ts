import { describe, expect, it } from 'bun:test';
import { Book, Permission, Transaction } from 'bkper-js';
import { Utils } from '../src/utils.js';

function summarizeValues(transactions: Transaction[]): Record<string, string> {
    return Object.fromEntries(
        Array.from(Utils.summarizeExchangeUpdateTransactions(transactions), ([name, amount]) => [
            name,
            amount.toString(),
        ])
    );
}

function wrapTransactions(payloads: bkper.Transaction[]): Transaction[] {
    const book = new Book({ id: 'book-id' });
    return payloads.map(payload => new Transaction(book, payload));
}

describe('Utils', () => {
    it('preserves exchange-code aliases and base-Book rules', () => {
        const book = new Book({
            id: 'selected-book',
            properties: { exchange_code: 'USD' },
            collection: {
                books: [
                    { id: 'base-book', properties: { exc_base: 'false' } },
                    { id: 'connected-book', properties: {} },
                ],
            },
        });
        const baseBook = book.getCollection()!.getBooks()[0];

        expect(Utils.getExcCode(book)).toBe('USD');
        expect(Utils.isBaseBook(baseBook)).toBe(true);
        expect(Utils.hasBaseBookInCollection(book)).toBe(true);
    });

    it('preserves edit-permission rules', () => {
        const editorBook = new Book({ id: 'editor-book', permission: Permission.EDITOR });
        const viewerBook = new Book({ id: 'viewer-book', permission: Permission.VIEWER });

        expect(Utils.canEditBook(editorBook)).toBe(true);
        expect(Utils.canEditBook(viewerBook)).toBe(false);
    });

    it('returns false when no base Book is configured', () => {
        const book = new Book({ id: 'selected-book', properties: {} });

        expect(Utils.isBaseBook(book)).toBe(false);
        expect(Utils.hasBaseBookInCollection(book)).toBe(false);
    });

    it('aggregates signed Exchange Account adjustments from accepted movements', () => {
        const transactions = wrapTransactions([
            {
                amount: '12.345',
                description: 'Adjustment #exchange_loss for Cash',
                debitAccount: { name: 'Cash EXC' },
            },
            {
                amount: '2.345',
                description: '#exchange_gain',
                creditAccount: { name: 'Cash EXC' },
            },
            {
                amount: '3',
                description: 'Historical #exchange_gain_hist adjustment',
                creditAccount: { name: 'Historical EXC' },
            },
        ]);

        expect(summarizeValues(transactions)).toEqual({
            'Cash EXC': '10',
            'Historical EXC': '-3',
        });
    });

    it('returns no adjustments when no Exchange Update movements were accepted', () => {
        expect(summarizeValues(wrapTransactions([]))).toEqual({});
    });

    it('returns the calendar date in the Book timezone', () => {
        const date = new Date('2026-01-01T00:30:00.000Z');

        expect(Utils.getIsoDateInTimeZone(date, 'America/New_York')).toBe('2025-12-31');
        expect(Utils.getIsoDateInTimeZone(date, 'Asia/Tokyo')).toBe('2026-01-01');
    });
});
