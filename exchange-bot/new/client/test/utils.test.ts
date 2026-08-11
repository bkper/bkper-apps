import { describe, expect, it } from 'bun:test';
import { Book, Permission, Transaction } from 'bkper-js';
import { Utils } from '../src/utils.js';

async function summarizeValues(transactions: Transaction[]): Promise<Record<string, string>> {
    return Object.fromEntries(
        Array.from(await Utils.summarizeExchangeUpdate(transactions), ([name, amount]) => [
            name,
            amount.toString(),
        ])
    );
}

function wrapTransactions(
    payloads: bkper.Transaction[],
    accounts: bkper.Account[] = []
): Transaction[] {
    const book = new Book({ id: 'book-id', accounts });
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

    it('uses explicit view and edit permission allowlists', () => {
        const cases = [
            { permission: Permission.OWNER, canView: true, canEdit: true },
            { permission: Permission.EDITOR, canView: true, canEdit: true },
            { permission: Permission.POSTER, canView: true, canEdit: false },
            { permission: Permission.VIEWER, canView: true, canEdit: false },
            { permission: Permission.RECORDER, canView: false, canEdit: false },
            { permission: Permission.NONE, canView: false, canEdit: false },
            { permission: undefined, canView: false, canEdit: false },
        ] as const;

        for (const permissionCase of cases) {
            const book = new Book({ id: 'book-id', permission: permissionCase.permission });
            expect(Utils.canViewBook(book)).toBe(permissionCase.canView);
            expect(Utils.canEditBook(book)).toBe(permissionCase.canEdit);
        }
    });

    it('returns false when no base Book is configured', () => {
        const book = new Book({ id: 'selected-book', properties: {} });

        expect(Utils.isBaseBook(book)).toBe(false);
        expect(Utils.hasBaseBookInCollection(book)).toBe(false);
    });

    it('aggregates signed Exchange Account adjustments from the Book Account map', async () => {
        const transactions = wrapTransactions(
            [
                {
                    amount: '12.345',
                    description: 'Adjustment #exchange_loss for Cash',
                    debitAccount: { id: 'cash-exchange' },
                },
                {
                    amount: '2.345',
                    description: '#exchange_gain',
                    creditAccount: { id: 'cash-exchange' },
                },
                {
                    amount: '3',
                    description: 'Historical #exchange_gain_hist adjustment',
                    creditAccount: { id: 'historical-exchange' },
                },
            ],
            [
                { id: 'cash-exchange', name: 'Cash EXC' },
                { id: 'historical-exchange', name: 'Historical EXC' },
            ]
        );

        expect(await summarizeValues(transactions)).toEqual({
            'Cash EXC': '10',
            'Historical EXC': '-3',
        });
    });

    it('returns no adjustments when no Exchange Update movements were accepted', async () => {
        expect(await summarizeValues(wrapTransactions([]))).toEqual({});
    });

    it('returns the calendar date in the Book timezone', () => {
        const date = new Date('2026-01-01T00:30:00.000Z');

        expect(Utils.getIsoDateInTimeZone(date, 'America/New_York')).toBe('2025-12-31');
        expect(Utils.getIsoDateInTimeZone(date, 'Asia/Tokyo')).toBe('2026-01-01');
    });
});
