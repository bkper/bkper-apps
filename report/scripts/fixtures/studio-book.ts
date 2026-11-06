/**
 * A made-up design studio's Book, two years of balances shaped like the payloads recorded from
 * the Bkper API (`GET /v5/books/{id}` with accounts and groups, and one
 * `group:'<root>' before:<tomorrow> by:m` balances query per root group): raw decimal strings
 * (credit minus debit), `day: 0` monthly buckets with running cumulative balances.
 *
 * Every month balances: Checking receives the revenue and pays expenses, taxes, loan
 * repayments and transfers, so all accounts add up to zero, as in any Bkper Book.
 *
 * Today is 2025-12-31, the last day of the data, so no current period needs a partial-month
 * comparison window.
 */
import { Amount, BalancesReport, Book } from 'bkper-js';
import {
    buildSnapshot,
    snapshotQueries,
    type Snapshot,
} from '../../server/src/services/snapshot.ts';

export const STUDIO_TODAY = '2025-12-31';
const DATA_AT = new Date('2025-12-31T21:00:00Z');
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
    ],
    accounts: [
        { name: 'Software', type: 'OUTGOING', amount: series(1250, 0.02, 0.015, 0.2) },
        { name: 'Marketing', type: 'OUTGOING', amount: series(1400, 0.4, 0.01, 1.3) },
        { name: 'Travel', type: 'OUTGOING', amount: series(850, 0.5, 0, 2.9) },
        { name: 'Insurance', type: 'OUTGOING', amount: () => 340 },
        { name: 'Bank fees', type: 'OUTGOING', amount: series(55, 0.1, 0, 0.6) },
    ],
};

const taxes: GroupSpec = {
    name: 'Taxes',
    type: 'OUTGOING',
    accounts: [
        { name: 'Income tax', type: 'OUTGOING', amount: series(1900, 0.1, 0.01, 0.5) },
        { name: 'Payroll tax', type: 'OUTGOING', amount: series(1350, 0, 0.008, 0.1) },
        { name: 'Sales tax', type: 'OUTGOING', amount: series(820, 0.18, 0.012, 0.4) },
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

/** Raw monthly balances (credit minus debit) with running cumulative balances. */
function monthlyBalances(raw: Amount[]): bkper.Balance[] {
    let cumulative = new Amount(0);
    return raw.map((period, index) => {
        cumulative = cumulative.plus(period);
        const year = FIRST_YEAR + Math.floor(index / 12);
        const month = (index % 12) + 1;
        return {
            year,
            month,
            day: 0,
            fuzzyDate: year * 10000 + month * 100,
            periodBalance: period.toFixed(),
            cumulativeBalance: cumulative.toFixed(),
            periodCredit: period.gt(0) ? period.toFixed() : '0',
            periodDebit: period.lt(0) ? period.abs().toFixed() : '0',
            cumulativeCredit: '0',
            cumulativeDebit: '0',
        };
    });
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

interface GroupBalances {
    balances: bkper.GroupBalances;
    raw: Amount[];
}

function groupBalances(group: GroupSpec): GroupBalances {
    const children = (group.groups ?? []).map(groupBalances);
    const accounts = group.accounts.map(account => ({ account, raw: accountRaw(account) }));
    const raw = sum([...children.map(child => child.raw), ...accounts.map(entry => entry.raw)]);
    const nature = { credit: credit(group.type), permanent: permanent(group.type) };
    return {
        raw,
        balances: {
            name: group.name,
            normalizedName: id(group.name),
            ...nature,
            balances: monthlyBalances(raw),
            ...(children.length > 0
                ? { groupBalances: children.map(child => child.balances) }
                : {}),
            accountBalances: accounts.map(({ account, raw: accountRaw }) => {
                const balances = monthlyBalances(accountRaw);
                const last = balances[balances.length - 1].cumulativeBalance;
                return {
                    name: account.name,
                    normalizedName: id(account.name),
                    credit: credit(account.type),
                    permanent: permanent(account.type),
                    archived: false,
                    empty: false,
                    balances,
                    periodBalance: last,
                    cumulativeBalance: last,
                };
            }),
        },
    };
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

/** The snapshot of the studio's Book, built by the app's snapshot code from its payloads. */
export async function studioSnapshot(): Promise<Snapshot> {
    const book = new Book(bookPayload());
    const groups = await book.getGroups();
    const accounts = await book.getAccounts();
    const roots = groups
        .filter(group => !group.hasParent())
        .map(group => ({ name: group.getName() ?? '', permanent: group.isPermanent() ?? false }));
    assertBalanced();
    const payloads = new Map<string, bkper.Balances>(
        ROOTS.map(root => [
            root.name,
            { periodicity: 'MONTHLY', groupBalances: [groupBalances(root).balances] },
        ])
    );
    const results = snapshotQueries(roots, STUDIO_TODAY).map(query => {
        const payload = payloads.get(query.root);
        if (!payload || query.window) {
            throw new Error(`No balances for ${query.query}`);
        }
        return { query, report: new BalancesReport(book, payload) };
    });
    return buildSnapshot({ book, groups, accounts, results, today: STUDIO_TODAY, dataAt: DATA_AT });
}
