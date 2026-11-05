/**
 * A small Book and its balances, shaped like the payloads recorded from the Bkper API
 * (`GET /v5/books/{id}?loadAccounts=true&loadGroups=true` and `GET /v5/books/{id}/balances`):
 * raw decimal strings (credit minus debit), sparse months, `day: 0` monthly buckets, and a
 * zero bucket for the month of `before` in activity groups. The amounts are made up.
 *
 * Today is 2026-11-05 in the Book time zone, so every query ends before 2026-11-06.
 */
import { Amount } from 'bkper-js';

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

/** Monthly buckets from `[year, month, raw period balance]`, with running cumulative balances. */
function months(entries: [number, number, string][]): bkper.Balance[] {
    let cumulative = new Amount(0);
    return entries.map(([year, month, period]) => {
        const amount = new Amount(period);
        cumulative = cumulative.plus(amount);
        return {
            year,
            month,
            day: 0,
            fuzzyDate: year * 10000 + month * 100,
            periodBalance: period,
            cumulativeBalance: cumulative.toFixed(),
            periodCredit: amount.gt(0) ? period : '0',
            periodDebit: amount.lt(0) ? amount.abs().toFixed() : '0',
            cumulativeCredit: '0',
            cumulativeDebit: '0',
        };
    });
}

function accountBalances(
    name: string,
    nature: { credit: boolean; permanent: boolean },
    balances: bkper.Balance[],
    archived = false
): bkper.AccountBalances {
    const last = balances[balances.length - 1];
    return {
        name,
        normalizedName: name.toLowerCase().replace(/ /g, '_'),
        ...nature,
        archived,
        empty: balances.length === 0,
        balances,
        periodBalance: last?.cumulativeBalance ?? '0',
        cumulativeBalance: last?.cumulativeBalance ?? '0',
    };
}

function windowBalances(name: string, credit: boolean, period: string): bkper.AccountBalances {
    return {
        name,
        normalizedName: name.toLowerCase().replace(/ /g, '_'),
        credit,
        permanent: false,
        archived: false,
        empty: false,
        periodBalance: period,
        cumulativeBalance: period,
    };
}

const outgoing = { credit: false, permanent: false };
const incoming = { credit: true, permanent: false };
const asset = { credit: false, permanent: true };

const rent = months([
    [2025, 11, '-1000'],
    [2026, 8, '-1000'],
    [2026, 10, '-1000'],
    [2026, 11, '-1000'],
]);
const food = months([
    [2026, 10, '-200.5'],
    [2026, 11, '-50.25'],
]);
const salary = months([
    [2026, 10, '5000'],
    [2026, 11, '5000'],
]);

/** Balances payloads by exact query. */
export const balancesPayloads: Record<string, bkper.Balances> = {
    "group:'Assets' before:2026-11-06 by:m": {
        periodicity: 'MONTHLY',
        groupBalances: [
            {
                name: 'Assets',
                normalizedName: 'assets',
                ...asset,
                balances: months([
                    [2024, 3, '-100'],
                    [2026, 10, '-3799.5'],
                    [2026, 11, '-3949.75'],
                ]),
                groupBalances: [
                    {
                        name: 'Banks',
                        normalizedName: 'banks',
                        ...asset,
                        balances: months([
                            [2026, 10, '-3799.5'],
                            [2026, 11, '-3949.75'],
                        ]),
                        accountBalances: [
                            accountBalances(
                                'Bank A',
                                asset,
                                months([
                                    [2026, 10, '-3799.5'],
                                    [2026, 11, '-3949.75'],
                                ])
                            ),
                            accountBalances('Bank B', asset, []),
                        ],
                    },
                ],
                accountBalances: [accountBalances('Cash', asset, months([[2024, 3, '-100']]))],
            },
        ],
    },
    "group:'Card' before:2026-11-06 by:m": {
        periodicity: 'MONTHLY',
        groupBalances: [
            {
                name: 'Card',
                normalizedName: 'card',
                credit: true,
                permanent: true,
                balances: [],
                accountBalances: [
                    accountBalances('Credit Card', { credit: true, permanent: true }, []),
                ],
            },
        ],
    },
    "group:'Expenses' before:2026-11-06 by:m": {
        periodicity: 'MONTHLY',
        groupBalances: [
            {
                name: 'Expenses',
                normalizedName: 'expenses',
                ...outgoing,
                balances: months([
                    [2024, 3, '-10'],
                    [2025, 11, '-1000'],
                    [2026, 8, '-1000'],
                    [2026, 10, '-1200.5'],
                    [2026, 11, '-1050.25'],
                ]),
                accountBalances: [
                    accountBalances('Rent', outgoing, rent),
                    accountBalances('Food', outgoing, food),
                    accountBalances('Old Supplier', outgoing, months([[2024, 3, '-10']]), true),
                ],
            },
        ],
    },
    "group:'Revenue' before:2026-11-06 by:m": {
        periodicity: 'MONTHLY',
        groupBalances: [
            {
                name: 'Revenue',
                normalizedName: 'revenue',
                ...incoming,
                balances: months([
                    [2026, 10, '5000'],
                    [2026, 11, '5000'],
                ]),
                accountBalances: [accountBalances('Salary', incoming, salary)],
            },
        ],
    },
    "group:'Net income' before:2026-11-06 by:m": {
        periodicity: 'MONTHLY',
        groupBalances: [
            {
                name: 'Net income',
                normalizedName: 'net_income',
                ...incoming,
                balances: months([
                    [2025, 11, '-1000'],
                    [2026, 8, '-1000'],
                    [2026, 10, '3799.5'],
                    [2026, 11, '3949.75'],
                ]),
                accountBalances: [
                    accountBalances('Rent', outgoing, rent),
                    accountBalances('Food', outgoing, food),
                    accountBalances('Salary', incoming, salary),
                ],
            },
        ],
    },
    ...windowPayloads('2026-10-01', '2026-10-06', { rent: '-1000', food: '0', salary: '5000' }),
    ...windowPayloads('2026-08-01', '2026-08-06', { rent: '0', food: '0', salary: '0' }),
    ...windowPayloads('2025-11-01', '2025-11-06', { rent: '-1000', food: '0', salary: '0' }),
};

function windowPayloads(
    after: string,
    before: string,
    raw: { rent: string; food: string; salary: string }
): Record<string, bkper.Balances> {
    const sum = (...values: string[]) =>
        values.reduce((total, value) => total.plus(value), new Amount(0)).toFixed();
    const range = `after:${after} before:${before}`;
    const expenses = sum(raw.rent, raw.food);
    return {
        [`group:'Expenses' ${range}`]: {
            groupBalances: [
                {
                    name: 'Expenses',
                    ...outgoing,
                    periodBalance: expenses,
                    cumulativeBalance: expenses,
                    accountBalances: [
                        windowBalances('Rent', false, raw.rent),
                        // Like Bkper, windows may leave out accounts without movements.
                        ...(raw.food === '0' ? [] : [windowBalances('Food', false, raw.food)]),
                    ],
                },
            ],
        },
        [`group:'Revenue' ${range}`]: {
            groupBalances: [
                {
                    name: 'Revenue',
                    ...incoming,
                    periodBalance: raw.salary,
                    cumulativeBalance: raw.salary,
                    accountBalances: [windowBalances('Salary', true, raw.salary)],
                },
            ],
        },
        [`group:'Net income' ${range}`]: {
            groupBalances: [
                {
                    name: 'Net income',
                    ...incoming,
                    periodBalance: sum(expenses, raw.salary),
                    cumulativeBalance: sum(expenses, raw.salary),
                    accountBalances: [
                        windowBalances('Rent', false, raw.rent),
                        windowBalances('Food', false, raw.food),
                        windowBalances('Salary', true, raw.salary),
                    ],
                },
            ],
        },
    };
}
