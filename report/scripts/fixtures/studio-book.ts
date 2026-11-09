/**
 * A made-up design studio's Book: its groups and accounts, shaped like the payload recorded
 * from the Bkper API (`GET /v5/books/{id}` with accounts and groups), and two years of
 * transactions in a fake ledger that answers balances queries as the Bkper API does.
 *
 * Every month balances: Checking receives the revenue and pays expenses, taxes, loan
 * repayments and transfers, each on the 15th, so all accounts add up to zero, as in any
 * Bkper Book.
 *
 * Today is 2025-12-31, the last day of the data.
 */
import { Amount } from 'bkper-js';
import type { Snapshot } from '../../server/src/services/snapshot.ts';
import { FakeLedger, type LedgerTransaction } from '../../server/test/fixtures/ledger.ts';
import { ledgerSnapshot } from '../../server/test/fixtures/snapshot-book.ts';

export const STUDIO_TODAY = '2025-12-31';
/** When the studio's balances were read. */
export const STUDIO_DATA_AT = new Date('2025-12-31T21:00:00Z');
const MONTHS = 24;
const FIRST_YEAR = 2024;

type AccountType = NonNullable<bkper.Account['type']>;

interface AccountSpec {
    name: string;
    type: AccountType;
    /** The amount of each month, as people see it (positive for money in each account's sense). */
    amount: (month: number) => number;
}

interface GroupSpec {
    name: string;
    type: AccountType;
    groups?: GroupSpec[];
    accounts: AccountSpec[];
}

/** A smooth, repeatable monthly series: a base, a yearly season, a trend and some wobble. */
function series(base: number, season: number, trend: number, seed: number) {
    return (month: number) =>
        base *
        (1 +
            season * Math.sin((month / 12) * 2 * Math.PI + seed) +
            trend * month +
            0.06 * Math.sin(month * 2.3 + seed * 7));
}

const revenue: GroupSpec = {
    name: 'Revenue',
    type: 'INCOMING',
    accounts: [
        { name: 'Design projects', type: 'INCOMING', amount: series(18200, 0.18, 0.012, 0.4) },
        { name: 'Subscriptions', type: 'INCOMING', amount: series(5400, 0.02, 0.03, 1.1) },
        { name: 'Workshops', type: 'INCOMING', amount: series(2600, 0.6, 0.01, 2.2) },
        { name: 'Interest', type: 'INCOMING', amount: series(140, 0.05, 0.02, 3) },
    ],
};

const expenses: GroupSpec = {
    name: 'Expenses',
    type: 'OUTGOING',
    groups: [
        {
            name: 'People',
            type: 'OUTGOING',
            accounts: [
                { name: 'Salaries', type: 'OUTGOING', amount: series(9600, 0, 0.008, 0) },
                { name: 'Benefits', type: 'OUTGOING', amount: series(1900, 0, 0.008, 0.3) },
                { name: 'Contractors', type: 'OUTGOING', amount: series(2300, 0.35, 0.01, 1.7) },
            ],
        },
        {
            name: 'Office',
            type: 'OUTGOING',
            accounts: [
                { name: 'Rent', type: 'OUTGOING', amount: () => 3200 },
                { name: 'Utilities', type: 'OUTGOING', amount: series(460, 0.25, 0, 0.9) },
                { name: 'Supplies', type: 'OUTGOING', amount: series(280, 0.2, 0, 2.5) },
            ],
        },
        {
            name: 'Admin',
            type: 'OUTGOING',
            accounts: [
                { name: 'Insurance', type: 'OUTGOING', amount: () => 340 },
                { name: 'Bank fees', type: 'OUTGOING', amount: series(55, 0.1, 0, 0.6) },
            ],
        },
    ],
    // Six parts in all, so they stack by month.
    accounts: [
        { name: 'Software', type: 'OUTGOING', amount: series(1250, 0.02, 0.015, 0.2) },
        { name: 'Marketing', type: 'OUTGOING', amount: series(1400, 0.4, 0.01, 1.3) },
        { name: 'Travel', type: 'OUTGOING', amount: series(850, 0.5, 0, 2.9) },
    ],
};

const taxes: GroupSpec = {
    name: 'Taxes',
    type: 'OUTGOING',
    accounts: [
        { name: 'Income tax', type: 'OUTGOING', amount: series(1900, 0.1, 0.01, 0.5) },
        { name: 'Payroll tax', type: 'OUTGOING', amount: series(1350, 0, 0.008, 0.1) },
        { name: 'Sales tax', type: 'OUTGOING', amount: series(820, 0.18, 0.012, 0.4) },
        // Paid once a year, in September, so most periods have none of it.
        { name: 'Property tax', type: 'OUTGOING', amount: month => (month % 12 === 8 ? 2400 : 0) },
    ],
};

/** Positions move by transfers; Checking settles every month, so the Book balances. */
const savings = (month: number) => (month === 0 ? 15000 : 1200);
const cash = (month: number) => (month === 0 ? 300 : 0) + 40 * Math.sin(month * 1.7);
const loan = (month: number) => (month === 0 ? 60000 : -1100);
const card = (month: number) => 350 * Math.sin(month * 0.8 + 0.5) + (month === 0 ? 1800 : 0);

function checking(month: number): number {
    const total = (group: GroupSpec): number =>
        [...group.accounts, ...(group.groups ?? []).flatMap(child => child.accounts)].reduce(
            (sum, account) => sum + cents(account.amount(month)),
            0
        );
    return (
        total(revenue) -
        total(expenses) -
        total(taxes) +
        cents(loan(month)) +
        cents(card(month)) -
        cents(savings(month)) -
        cents(cash(month))
    );
}

const bankAccounts: GroupSpec = {
    name: 'Bank accounts',
    type: 'ASSET',
    accounts: [
        { name: 'Checking', type: 'ASSET', amount: checking },
        { name: 'Savings', type: 'ASSET', amount: savings },
        { name: 'Cash', type: 'ASSET', amount: cash },
    ],
};

const loans: GroupSpec = {
    name: 'Loans',
    type: 'LIABILITY',
    accounts: [
        { name: 'Bank loan', type: 'LIABILITY', amount: loan },
        { name: 'Credit card', type: 'LIABILITY', amount: card },
    ],
};

const ROOTS = [revenue, expenses, taxes, bankAccounts, loans];

function cents(value: number): number {
    return Math.round(value * 100) / 100;
}

function credit(type: AccountType): boolean {
    return type === 'INCOMING' || type === 'LIABILITY';
}

function permanent(type: AccountType): boolean {
    return type === 'ASSET' || type === 'LIABILITY';
}

function id(name: string): string {
    return name.toLowerCase().replace(/ /g, '-');
}

function allGroups(roots: GroupSpec[], parent?: GroupSpec): [GroupSpec, GroupSpec | undefined][] {
    return roots.flatMap(group => [
        [group, parent] as [GroupSpec, GroupSpec | undefined],
        ...allGroups(group.groups ?? [], group),
    ]);
}

function bookPayload(): bkper.Book {
    const groups = allGroups(ROOTS);
    return {
        id: 'studio-book',
        name: 'Studio Norte',
        timeZone: 'America/Sao_Paulo',
        datePattern: 'dd/MM/yyyy',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        permission: 'VIEWER',
        groups: groups.map(([group, parent]) => ({
            id: `g-${id(group.name)}`,
            name: group.name,
            normalizedName: id(group.name),
            type: group.type,
            credit: credit(group.type),
            permanent: permanent(group.type),
            mixed: false,
            hidden: false,
            locked: false,
            ...(parent ? { parent: { id: `g-${id(parent.name)}`, name: parent.name } } : {}),
        })),
        accounts: groups.flatMap(([group]) =>
            group.accounts.map(account => ({
                id: `a-${id(account.name)}`,
                name: account.name,
                normalizedName: id(account.name),
                type: account.type,
                credit: credit(account.type),
                permanent: permanent(account.type),
                archived: false,
                hasTransactionPosted: true,
                groups: [{ id: `g-${id(group.name)}`, locked: false }],
            }))
        ),
    };
}

function accountRaw(account: AccountSpec): Amount[] {
    const sign = credit(account.type) ? 1 : -1;
    return Array.from({ length: MONTHS }, (_, month) =>
        new Amount(cents(account.amount(month)).toFixed(2)).times(sign)
    );
}

function sum(series: Amount[][]): Amount[] {
    return Array.from({ length: MONTHS }, (_, month) =>
        series.reduce((total, raw) => total.plus(raw[month]), new Amount(0))
    );
}

/** Every month, the raw balances of all accounts add up to zero. */
function assertBalanced(): void {
    const accounts = allGroups(ROOTS).flatMap(([group]) => group.accounts);
    sum(accounts.map(accountRaw)).forEach((total, month) => {
        if (!total.eq(0)) {
            throw new Error(`The studio Book does not balance in month ${month}: ${total}`);
        }
    });
}

/**
 * Each account's movement of each month, with Checking: credited (`from`) when its raw
 * balance goes up, debited (`to`) when it goes down. Checking gets the rest, so its raw
 * balance is minus all the others'.
 */
function studioTransactions(): LedgerTransaction[] {
    const accounts = allGroups(ROOTS)
        .flatMap(([group]) => group.accounts)
        .filter(account => account.name !== 'Checking');
    return accounts.flatMap(account =>
        accountRaw(account).flatMap((raw, index): LedgerTransaction[] => {
            if (raw.eq(0)) {
                return [];
            }
            const year = FIRST_YEAR + Math.floor(index / 12);
            const month = String((index % 12) + 1).padStart(2, '0');
            const credited = raw.gt(0);
            return [
                {
                    date: `${year}-${month}-15`,
                    from: credited ? account.name : 'Checking',
                    to: credited ? 'Checking' : account.name,
                    amount: raw.abs().toFixed(),
                },
            ];
        })
    );
}

/** The studio's Book and its transactions. */
export function studioLedger(): FakeLedger {
    assertBalanced();
    return new FakeLedger(bookPayload(), studioTransactions(), STUDIO_TODAY);
}

/** The snapshot (the map) of the studio's Book, built by the app's snapshot code. */
export async function studioSnapshot(ledger: FakeLedger = studioLedger()): Promise<Snapshot> {
    return ledgerSnapshot(ledger, STUDIO_TODAY, STUDIO_DATA_AT);
}
