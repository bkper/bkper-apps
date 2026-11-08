import { Book } from 'bkper-js';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, quote } from '../../src/services/snapshot';
import { TODAY, bookPayload } from '../fixtures/snapshot-book';

const DATA_AT = new Date('2026-11-05T15:00:00Z');

/** The map of the fixture Book, or of another Book payload, with no balances at all. */
async function build(payload: bkper.Book = bookPayload) {
    const book = new Book(structuredClone(payload));
    const groups = await book.getGroups();
    const accounts = await book.getAccounts();
    return buildSnapshot({ book, groups, accounts, today: TODAY, dataAt: DATA_AT });
}

describe('quote', () => {
    it('quotes names with a single quote in double quotes', () => {
        expect(quote('Sales & Marketing')).toBe("'Sales & Marketing'");
        expect(quote("Owner's Equity")).toBe('"Owner\'s Equity"');
    });
});

describe('buildSnapshot', () => {
    it('keeps the Book, the time of the data and the root groups in Book order', async () => {
        const snapshot = await build();
        expect(snapshot.book).toEqual({
            id: 'book-1',
            name: 'Test Ledger',
            timeZone: 'America/Sao_Paulo',
            fractionDigits: 2,
            permission: 'VIEWER',
        });
        expect(snapshot.today).toBe(TODAY);
        expect(snapshot.dataAt).toBe('2026-11-05T15:00:00.000Z');
        expect(snapshot.roots).toEqual(['g-assets', 'g-card', 'g-expenses', 'g-revenue', 'g-net']);
    });

    it('builds the tree of subgroups and accounts under each root, with their natures', async () => {
        const { groups, accounts } = await build();
        expect(groups['g-assets']).toEqual({
            id: 'g-assets',
            name: 'Assets',
            type: 'ASSET',
            permanent: true,
            credit: false,
            groups: ['g-banks'],
            accounts: ['a-cash'],
        });
        expect(groups['g-banks']).toMatchObject({
            parent: 'g-assets',
            groups: [],
            accounts: ['a-bank-a', 'a-bank-b'],
        });
        expect(groups['g-expenses'].accounts).toEqual(['a-food', 'a-old', 'a-rent']);
        expect(groups['g-net']).toMatchObject({
            type: 'MIXED',
            permanent: false,
            credit: true,
            accounts: ['a-food', 'a-rent', 'a-salary'],
        });
        expect(accounts['a-card']).toEqual({
            id: 'a-card',
            name: 'Credit Card',
            type: 'LIABILITY',
            credit: true,
            permanent: true,
            archived: false,
            posted: true,
        });
        // Archived accounts are part of the structure.
        expect(accounts['a-old']).toMatchObject({ type: 'OUTGOING', archived: true });
        // An account under several roots appears once.
        expect(Object.keys(accounts)).toHaveLength(8);
    });

    it('keeps the accounts in no group apart, with their nature', async () => {
        const { accounts, ungrouped } = await build();
        expect(ungrouped).toEqual({
            'a-owner': {
                id: 'a-owner',
                name: 'Owner',
                type: 'LIABILITY',
                credit: true,
                permanent: true,
                archived: false,
                posted: true,
            },
        });
        expect(accounts['a-owner']).toBeUndefined();
    });

    it('marks the accounts that have transactions posted', async () => {
        const payload = structuredClone(bookPayload);
        const card = payload.accounts?.find(account => account.id === 'a-card');
        delete card?.hasTransactionPosted;
        const owner = payload.accounts?.find(account => account.id === 'a-owner');
        if (owner) {
            owner.hasTransactionPosted = false;
        }
        const { accounts, ungrouped } = await build(payload);
        expect(accounts['a-card'].posted).toBe(false);
        expect(ungrouped['a-owner'].posted).toBe(false);
        expect(accounts['a-cash'].posted).toBe(true);
    });

    it('holds no amounts and no months', async () => {
        const values = JSON.stringify(await build());
        for (const text of ['1000', '200.5', 'activeMonths', 'dataRange', '2026-10', '2024-03']) {
            expect(values).not.toContain(text);
        }
    });

    it('keeps roots in the payload’s order, and what is under a group by name', async () => {
        const group = (id: string, name: string, parent?: string): bkper.Group => ({
            id,
            name,
            type: 'OUTGOING',
            permanent: false,
            ...(parent ? { parent: { id: parent } } : {}),
        });
        const account = (id: string, name: string, groups: string[]): bkper.Account => ({
            id,
            name,
            type: 'OUTGOING',
            groups: groups.map(id => ({ id })),
        });
        // Ids that look like small integers do not keep their order as object keys.
        const groups = [
            group('900', 'b'),
            group('15', 'A'),
            group('7', 'Ab', '15'),
            group('3', 'aa', '15'),
        ];
        const accounts = [account('9', 'Zed', ['15']), account('2', 'alpha', ['15', '900'])];
        const snapshot = await build({ ...bookPayload, groups, accounts });
        expect(snapshot.roots).toEqual(['900', '15']);
        expect(snapshot.groups['15'].groups).toEqual(['3', '7']);
        expect(snapshot.groups['15'].accounts).toEqual(['2', '9']);
        // What is under a group is the same however the Book's payload orders it.
        const reversed = await build({
            ...bookPayload,
            groups: [...groups].reverse(),
            accounts: [...accounts].reverse(),
        });
        expect(reversed.roots).toEqual(['15', '900']);
        expect(reversed.groups).toEqual(snapshot.groups);
    });

    it('maps a Book without groups or accounts to an empty map', async () => {
        const snapshot = await build({ ...bookPayload, groups: [], accounts: [] });
        expect(snapshot.roots).toEqual([]);
        expect(snapshot.groups).toEqual({});
        expect(snapshot.ungrouped).toEqual({});
    });
});
