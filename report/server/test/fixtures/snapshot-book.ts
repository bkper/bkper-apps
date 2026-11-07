/**
 * A small Book, shaped like the payload recorded from the Bkper API
 * (`GET /v5/books/{id}?loadAccounts=true&loadGroups=true`), and its made-up transactions in a
 * {@link FakeLedger}, which answers every balances query as the Bkper API does.
 *
 * Today is 2026-11-05 in the Book time zone, so current periods end before 2026-11-06.
 * `Owner` is in no group: it only balances the movements of the others.
 */
import { BalancesReport, Book } from 'bkper-js';
import { buildSnapshot, type Snapshot } from '../../src/services/snapshot';
import type { QueryBalances } from '../../src/services/balances';
import { readQueryBalances } from '../../src/services/balances';
import { FakeLedger, type LedgerTransaction } from './ledger';

export const TODAY = '2026-11-05';

const ref = (id: string) => ({ id, locked: false });

export const bookPayload: bkper.Book = {
    id: 'book-1',
    name: 'Test Ledger',
    timeZone: 'America/Sao_Paulo',
    datePattern: 'dd/MM/yyyy',
    decimalSeparator: 'DOT',
    fractionDigits: 2,
    permission: 'VIEWER',
    groups: [
        group('g-assets', 'Assets', { type: 'ASSET', permanent: true, credit: false }),
        group('g-banks', 'Banks', { type: 'ASSET', permanent: true, credit: false }, 'g-assets'),
        group('g-card', 'Card', { type: 'LIABILITY', permanent: true, credit: true }),
        group('g-expenses', 'Expenses', { type: 'OUTGOING', permanent: false, credit: false }),
        group('g-revenue', 'Revenue', { type: 'INCOMING', permanent: false, credit: true }),
        group('g-net', 'Net income', { mixed: true, permanent: false, credit: true }),
    ],
    accounts: [
        account('a-cash', 'Cash', 'ASSET', ['g-assets']),
        account('a-bank-a', 'Bank A', 'ASSET', ['g-banks']),
        account('a-bank-b', 'Bank B', 'ASSET', ['g-banks']),
        account('a-card', 'Credit Card', 'LIABILITY', ['g-card']),
        account('a-rent', 'Rent', 'OUTGOING', ['g-expenses', 'g-net']),
        account('a-food', 'Food', 'OUTGOING', ['g-expenses', 'g-net']),
        account('a-old', 'Old Supplier', 'OUTGOING', ['g-expenses'], true),
        account('a-salary', 'Salary', 'INCOMING', ['g-revenue', 'g-net']),
        account('a-owner', 'Owner', 'LIABILITY', []),
    ],
};

function group(
    id: string,
    name: string,
    nature: Partial<Pick<bkper.Group, 'type' | 'mixed' | 'permanent' | 'credit'>>,
    parent?: string
): bkper.Group {
    return {
        id,
        name,
        normalizedName: name.toLowerCase().replace(/ /g, '_'),
        hidden: false,
        locked: false,
        mixed: false,
        ...nature,
        ...(parent ? { parent: { id: parent, name: 'Assets' } } : {}),
    };
}

function account(
    id: string,
    name: string,
    type: NonNullable<bkper.Account['type']>,
    groups: string[],
    archived = false
): bkper.Account {
    return {
        id,
        name,
        normalizedName: name.toLowerCase().replace(/ /g, '_'),
        type,
        credit: type === 'LIABILITY' || type === 'INCOMING',
        permanent: type === 'ASSET' || type === 'LIABILITY',
        archived,
        hasTransactionPosted: true,
        groups: groups.map(ref),
    };
}

/** Every transaction of the fixture Book, `from >> to`. */
export const transactions: LedgerTransaction[] = [
    { date: '2024-03-10', from: 'Owner', to: 'Cash', amount: '100' },
    { date: '2024-03-15', from: 'Owner', to: 'Old Supplier', amount: '10' },
    { date: '2025-11-02', from: 'Owner', to: 'Rent', amount: '1000' },
    { date: '2026-08-20', from: 'Owner', to: 'Rent', amount: '1000' },
    { date: '2026-10-03', from: 'Bank A', to: 'Rent', amount: '1000' },
    { date: '2026-10-05', from: 'Salary', to: 'Bank A', amount: '5000' },
    { date: '2026-10-15', from: 'Bank A', to: 'Food', amount: '200.5', hashtags: ['trip'] },
    { date: '2026-11-03', from: 'Bank A', to: 'Rent', amount: '1000', hashtags: ['trip'] },
    { date: '2026-11-04', from: 'Bank A', to: 'Food', amount: '50.25' },
    { date: '2026-11-05', from: 'Salary', to: 'Bank A', amount: '5000' },
];

/** When the fixture balances were read. */
export const DATA_AT = new Date('2026-11-05T15:00:00Z');

/** A fresh ledger of the fixture Book, which a test may change. */
export function fixtureLedger(): FakeLedger {
    return new FakeLedger(structuredClone(bookPayload), structuredClone(transactions));
}

/**
 * The fixture Book without its Net income group, so no group combines Incoming and Outgoing:
 * its activity roots are simple, Expenses and Revenue, and share no account.
 */
export function simpleRootsLedger(): FakeLedger {
    const ledger = fixtureLedger();
    ledger.removeGroup('g-net');
    return ledger;
}

/** The balances of a query of the ledger, as the app reads them. */
export function ledgerBalances(
    ledger: FakeLedger,
    query: string,
    dataAt: Date = DATA_AT
): QueryBalances {
    return readQueryBalances(
        query,
        new BalancesReport(new Book(ledger.book), ledger.balances(query)),
        dataAt
    );
}

/** The snapshot (the Book's map) of a ledger, built by the app's snapshot code. */
export async function ledgerSnapshot(
    ledger: FakeLedger,
    today = TODAY,
    dataAt = DATA_AT
): Promise<Snapshot> {
    const book = new Book(ledger.book);
    const groups = await book.getGroups();
    const accounts = await book.getAccounts();
    return buildSnapshot({ book, groups, accounts, today, dataAt });
}

/** The snapshot of the fixture Book. */
export async function fixtureSnapshot(): Promise<Snapshot> {
    return ledgerSnapshot(fixtureLedger());
}
