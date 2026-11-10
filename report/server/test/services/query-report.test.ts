import { beforeAll, describe, expect, it } from 'vitest';
import type { QueryBalances } from '../../src/services/balances';
import {
    QueryNotAReportError,
    isBkperQuery,
    parseQuery,
    planQueryReport,
    previousDays,
    queryDays,
} from '../../src/services/query-report';
import { buildQueryReport, queryReportQueries, type ReportData } from '../../src/services/report';
import { buildReportSpec } from '../../src/services/report-spec';
import { withoutIsolates } from 'report-shared/bidi';
import type { Snapshot } from '../../src/services/snapshot';
import type { FakeLedger } from '../fixtures/ledger';
import {
    fixtureLedger,
    fixtureSnapshot,
    ledgerBalances,
    ledgerSnapshot,
} from '../fixtures/snapshot-book';

// The fixture Book's today is 2026-11-05 and its dates are written dd/MM/yyyy.
let snapshot: Snapshot;
beforeAll(async () => {
    snapshot = await fixtureSnapshot();
});

function withPattern(datePattern: string): Snapshot {
    return { ...snapshot, book: { ...snapshot.book, datePattern } };
}

/** A text as read: without isolates, its spaces plain (Intl writes thin ones in ranges). */
const plain = (text: unknown) => withoutIsolates(String(text)).replace(/\s/gu, ' ');

const idsOf = (query: string, book = snapshot) =>
    planQueryReport(query, book).nodes.map(node => node.id);

describe('parseQuery', () => {
    it('reads names, dates and where they are written, and nothing else', () => {
        const query = `=(Group:'Food & Drinks' OR acc:Rent) -account:"Joe's Bar" after:01/2026 before:$m+1 on:2025 #trip amount>10 is:checked text "a phrase" 100`;
        const terms = parseQuery(query);
        expect(terms.names).toEqual([
            { kind: 'group', name: 'Food & Drinks' },
            { kind: 'account', name: 'Rent' },
            { kind: 'account', name: "Joe's Bar" },
        ]);
        expect(terms.dates.map(({ field, value }) => ({ field, value }))).toEqual([
            { field: 'after', value: '01/2026' },
            { field: 'before', value: '$m+1' },
            { field: 'on', value: '2025' },
        ]);
        for (const term of terms.dates) {
            expect(query.slice(term.start, term.end)).toBe(`${term.field}:${term.value}`);
        }
        expect(terms.byMonth).toBe(false);
        expect(parseQuery("group:'Expenses' by:m").byMonth).toBe(true);
    });

    it('reads only the fields it knows', () => {
        expect(parseQuery('constructor:x toString:y __proto__:z remoteId:1')).toEqual({
            names: [],
            dates: [],
            byMonth: false,
        });
    });

    it('tells a Bkper query from a person’s words by its group and account terms', () => {
        expect(isBkperQuery("group:'Expenses' after:01/2026")).toBe(true);
        expect(isBkperQuery('acc:Rent')).toBe(true);
        expect(isBkperQuery('expenses this year')).toBe(false);
        expect(isBkperQuery('expenses by group: food')).toBe(false);
        expect(isBkperQuery('after:01/2026 #trip')).toBe(false);
    });
});

describe('planQueryReport: groups and accounts', () => {
    it('reads a group by its name, quoted or not, ignoring case, accents and separators', () => {
        for (const query of [
            "group:'Expenses'",
            'group:Expenses',
            'GROUP:expenses',
            'group:"EXPENSÉS"',
        ]) {
            expect(idsOf(query)).toEqual(['g-expenses']);
        }
        expect(idsOf("group:'net-income'")).toEqual(['g-net']);
        expect(idsOf('group:net_income')).toEqual(['g-net']);
    });

    it('reads subgroups, accounts under groups and accounts in no group', () => {
        expect(idsOf("group:'Banks'")).toEqual(['g-banks']);
        expect(idsOf("account:'credit card'")).toEqual(['a-card']);
        expect(idsOf('account:Owner')).toEqual(['a-owner']);
    });

    it('reads only what each operator names: an account is never a group', () => {
        expect(() => idsOf("account:'Expenses'")).toThrow(QueryNotAReportError);
        expect(() => idsOf("group:'Rent'")).toThrow(QueryNotAReportError);
    });

    it('shows several side by side, in the order written, each once, at most six', () => {
        expect(idsOf("(account:'Rent' OR account:'Food') account:rent group:'Expenses'")).toEqual([
            'a-rent',
            'a-food',
            'g-expenses',
        ]);
        expect(
            idsOf(
                "account:Cash account:'Bank A' group:Nope account:'Bank B' account:'Credit Card' account:Owner group:Card group:Banks"
            )
        ).toEqual(['a-cash', 'a-bank-a', 'a-bank-b', 'a-card', 'a-owner', 'g-card']);
        expect(idsOf("group:'Nope' account:'Rent'")).toEqual(['a-rent']);
    });

    it('is not a report without a group or account of the Book', () => {
        for (const query of ['', 'on:2025', '#trip', 'is:checked rent', "group:'Nope'"]) {
            expect(() => planQueryReport(query, snapshot)).toThrow(QueryNotAReportError);
        }
    });

    it('rejects balances side by side with activity', () => {
        expect(() => planQueryReport("account:'Rent' account:'Cash'", snapshot)).toThrow(
            expect.objectContaining({ reason: 'mixed_targets' })
        );
    });

    it('reads the query as sent, and its months with by:m', () => {
        const query = "group:'Expenses' #trip amount>5 after:01/2026 before:01/2027";
        const plan = planQueryReport(query, snapshot);
        expect(plan).toMatchObject({ query, nature: 'activity', monthsQuery: `${query} by:m` });
        expect(planQueryReport(`${query} by:m`, snapshot).monthsQuery).toBe(`${query} by:m`);
        expect(planQueryReport("group:'Assets'", snapshot).nature).toBe('position');
    });
});

describe('queryDays', () => {
    // Today is 2026-11-05.
    const daysOf = (dates: string, pattern = 'dd/MM/yyyy') =>
        queryDays(
            parseQuery(dates).dates,
            pattern === 'dd/MM/yyyy' || pattern === 'MM/dd/yyyy' || pattern === 'yyyy/MM/dd'
                ? pattern
                : undefined,
            '2026-11-05'
        );

    it.each([
        ['', {}],
        ['amount>10 is:checked', {}],
        ['on:2025', { after: '2025-01-01', before: '2026-01-01' }],
        ['on:$y', { after: '2026-01-01', before: '2027-01-01' }],
        ['on:$y-1', { after: '2025-01-01', before: '2026-01-01' }],
        ['after:$y before:$m+1', { after: '2026-01-01', before: '2026-12-01' }],
        ['on:10/2026', { after: '2026-10-01', before: '2026-11-01' }],
        ['on:$m-1', { after: '2026-10-01', before: '2026-11-01' }],
        ['on:$d', { after: '2026-11-05', before: '2026-11-06' }],
        ['before:$d+1', { before: '2026-11-06' }],
        ['after:15/08/2026 before:20/08/2026', { after: '2026-08-15', before: '2026-08-20' }],
        ['after:01/2026 before:01/2027', { after: '2026-01-01', before: '2027-01-01' }],
        ['after:01/12/2026', { after: '2026-12-01' }],
        ['before:2026', { before: '2026-01-01' }],
        ['on:2027', { after: '2027-01-01', before: '2028-01-01' }],
        ['after:2024 after:2025 before:2026', { after: '2024-01-01', before: '2026-01-01' }],
    ])('%s', (dates, days) => {
        expect(daysOf(dates)).toEqual(days);
    });

    it.each([
        ['dd/MM/yyyy', 'on:05/09/2026', { after: '2026-09-05', before: '2026-09-06' }],
        ['dd/MM/yyyy', 'on:5/9/2026', { after: '2026-09-05', before: '2026-09-06' }],
        ['dd/MM/yyyy', 'on:15/09', { after: '2026-09-15', before: '2026-09-16' }],
        ['MM/dd/yyyy', 'on:09/05/2026', { after: '2026-09-05', before: '2026-09-06' }],
        ['MM/dd/yyyy', 'on:9/2026', { after: '2026-09-01', before: '2026-10-01' }],
        ['yyyy/MM/dd', 'on:2026/09/05', { after: '2026-09-05', before: '2026-09-06' }],
        ['yyyy/MM/dd', 'on:2026-09', { after: '2026-09-01', before: '2026-10-01' }],
        ['dd/MM/yyyy', 'on:2026-09-05', { after: '2026-09-05', before: '2026-09-06' }],
    ])('%s %s', (pattern, dates, days) => {
        expect(daysOf(dates, pattern)).toEqual(days);
    });

    it('cannot read dates of another format, days that do not exist, or a range that ends first', () => {
        expect(daysOf('on:2026/09/05')).toBeUndefined();
        expect(daysOf('on:13/09/2026', 'MM/dd/yyyy')).toBeUndefined();
        expect(daysOf('on:31/02/2026')).toBeUndefined();
        expect(daysOf('on:soon')).toBeUndefined();
        expect(daysOf('after:2026 before:2025')).toBeUndefined();
    });
});

describe('previousDays', () => {
    it.each([
        [
            { after: '2026-01-01', before: '2027-01-01' },
            { after: '2025-01-01', before: '2026-01-01' },
        ],
        [
            { after: '2026-07-01', before: '2026-10-01' },
            { after: '2026-04-01', before: '2026-07-01' },
        ],
        [
            { after: '2026-10-01', before: '2026-11-01' },
            { after: '2026-09-01', before: '2026-10-01' },
        ],
        [
            { after: '2026-08-15', before: '2026-08-20' },
            { after: '2026-08-10', before: '2026-08-15' },
        ],
        [{ before: '2027-01-01' }, { before: '2026-12-01' }],
        [{ before: '2026-11-06' }, { before: '2026-11-01' }],
        [{ after: '2026-01-01' }, undefined],
        [{}, undefined],
    ])('%j', (days, previous) => {
        expect(previousDays(days)).toEqual(previous);
    });
});

describe('planQueryReport: the comparison', () => {
    const comparisonOf = (query: string, book = snapshot) =>
        planQueryReport(query, book).comparison?.query;

    it('writes the period before in place of the query’s own dates, in the Book’s format', () => {
        expect(comparisonOf("group:'Expenses' after:01/2026 #trip before:01/2027 amount>5")).toBe(
            "group:'Expenses' after:01/01/2025 #trip before:01/01/2026 amount>5"
        );
        expect(comparisonOf("(group:'Expenses') on:$m-1")).toBe(
            "(group:'Expenses') after:01/09/2026 before:01/10/2026"
        );
        expect(comparisonOf("group:'Assets' before:01/2027")).toBe(
            "group:'Assets' before:01/12/2026"
        );
        expect(comparisonOf("group:'Expenses' on:2025", withPattern('MM/dd/yyyy'))).toBe(
            "group:'Expenses' after:01/01/2024 before:01/01/2025"
        );
        expect(comparisonOf("group:'Expenses' on:2025", withPattern('yyyy/MM/dd'))).toBe(
            "group:'Expenses' after:2024/01/01 before:2025/01/01"
        );
    });

    it('has none with no end, no dates, dates it cannot read, or dates written twice', () => {
        for (const query of [
            "group:'Expenses'",
            "group:'Expenses' after:01/2026",
            "group:'Expenses' on:soon",
            "group:'Expenses' after:2024 after:2025 before:2026",
            "group:'Expenses' on:2025 before:2026",
        ]) {
            expect(comparisonOf(query)).toBeUndefined();
        }
    });
});

describe('buildQueryReport', () => {
    /** The report of a query on a ledger, read as the app reads it. */
    async function reportOf(
        ledger: FakeLedger,
        query: string,
        read: (query: string) => QueryBalances = q => ledgerBalances(ledger, q)
    ): Promise<ReportData> {
        const book = await ledgerSnapshot(ledger);
        const plan = planQueryReport(query, book);
        return buildQueryReport(plan, book, queryReportQueries(plan).map(read));
    }

    /** The fixture ledger with Rent paid in December and next year: dated in the future. */
    function futureLedger(): FakeLedger {
        const ledger = fixtureLedger();
        ledger.transactions.push(
            { date: '2026-12-10', from: 'Bank A', to: 'Rent', amount: '700' },
            { date: '2027-02-10', from: 'Bank A', to: 'Rent', amount: '300' }
        );
        return ledger;
    }

    it('shows Bkper’s balances of the query as sent, future-dated transactions and all', async () => {
        const ledger = futureLedger();
        const query = "group:'Expenses' after:01/2026 before:01/2027";
        const report = await reportOf(ledger, query);

        // August, October and November's 1,000 of Rent, December's 700, and Food.
        expect(report.answer?.amount).toBe(ledgerBalances(ledger, query).groups.Expenses.period);
        expect(report.answer?.amount).toBe('3950.75');
        expect(report.query).toBe(query);
        expect(report.url).toBe(
            `https://bkper.app/books/book-1/transactions?query=${encodeURIComponent(query)}`
        );
        expect(report.months).toHaveLength(12);
        expect(report.months.at(-1)).toBe('2026-12');
        expect(report.breakdown.find(row => row.name === 'Rent')?.months.at(-1)).toBe('700');
        // Compared with 2025, as sent with its dates moved.
        expect(report.answer?.previous).toBe('1000');
        expect(report.intent).toBeUndefined();

        const spec = buildReportSpec(report, 'en');
        const props = spec.elements.report.props as Record<string, unknown>;
        expect(plain(props.subtitle)).toBe('Jan 1 – Dec 31, 2026');
        expect(props.request).toBe(query);
        expect(spec.elements.source.props.query).toBe(query);
        expect(plain(spec.elements.source.props.period)).toBe('Jan 1 – Dec 31, 2026');
    });

    it('reads a query with no dates as Bkper does: every date, and no comparison', async () => {
        const ledger = futureLedger();
        const report = await reportOf(ledger, "account:'Rent'");

        expect(report.answer).toEqual({ amount: '5000' });
        expect(report.months.at(-1)).toBe('2027-02');
        const spec = buildReportSpec(report, 'en');
        expect((spec.elements.report.props as Record<string, unknown>).subtitle).toBe('All time');
    });

    it('reads a balance up to a day, its line of 12 month-ends ending there', async () => {
        const ledger = futureLedger();
        const report = await reportOf(ledger, "group:'Assets' before:01/2027");

        // Bank A paid December's rent: its balance at the end of the year counts it.
        expect(report.nature).toBe('position');
        expect(report.answer?.amount).toBe(
            ledgerBalances(ledger, "group:'Assets' before:01/2027").groups.Assets.cumulative
        );
        expect(report.months).toEqual([
            '2026-01',
            '2026-02',
            '2026-03',
            '2026-04',
            '2026-05',
            '2026-06',
            '2026-07',
            '2026-08',
            '2026-09',
            '2026-10',
            '2026-11',
            '2026-12',
        ]);
        const line = report.charts.views.find(view => view.kind === 'line');
        expect(line && 'series' in line && line.series[0].amounts.at(-1)).toBe(
            report.answer?.amount
        );
        // Compared with the end of November.
        expect(report.answer?.previous).toBe(
            ledgerBalances(ledger, "group:'Assets' before:01/12/2026").groups.Assets.cumulative
        );
        const spec = buildReportSpec(report, 'en');
        const props = spec.elements.report.props as Record<string, unknown>;
        expect(plain(props.subtitle)).toBe('As of Dec 31, 2026');
        expect(plain(spec.elements.answer.props.comparison)).toBe('vs. Nov 30, 2026');
    });

    it('reads days as written, by the days Bkper read', async () => {
        const report = await reportOf(
            fixtureLedger(),
            "account:'Rent' account:'Food' after:02/10/2026 before:04/11/2026"
        );

        // Rent of October 3 and November 3, Food of October 15; not November 4's.
        expect(report.targets?.map(row => [row.name, row.amount, row.previous])).toEqual([
            ['Rent', '2000', '0'],
            ['Food', '200.5', '0'],
        ]);
        expect(report.months).toEqual(['2026-10', '2026-11']);
        // As many days before: 33.
        expect(report.previous).toMatchObject({ after: '2026-08-30', before: '2026-10-02' });
        const spec = buildReportSpec(report, 'en');
        expect(plain((spec.elements.report.props as Record<string, unknown>).subtitle)).toBe(
            'Oct 2 – Nov 3, 2026'
        );
    });

    it('leaves out names Bkper does not find, and has no report when it finds none', async () => {
        const ledger = fixtureLedger();
        const answer = (query: string): QueryBalances => {
            const read = ledgerBalances(ledger, query);
            // Bkper does not find Food by its name.
            const { Food: _food, ...accounts } = read.accounts;
            return { ...read, accounts };
        };
        const report = await reportOf(ledger, "account:'Rent' account:'Food' on:10/2026", answer);
        expect(report.root?.name).toBe('Rent');
        expect(report.answer?.amount).toBe('1000');

        await expect(reportOf(ledger, "account:'Food' on:10/2026", answer)).rejects.toThrow(
            QueryNotAReportError
        );
    });

    it('never shows months whose totals differ from the query’s, nor a comparison Bkper read otherwise', async () => {
        const ledger = fixtureLedger();
        const query = "group:'Expenses' on:10/2026";
        const answer = (asked: string): QueryBalances => {
            const read = ledgerBalances(ledger, asked);
            if (asked.endsWith(' by:m')) {
                // By month, Bkper answers other totals.
                return {
                    ...read,
                    groups: { ...read.groups, Expenses: { ...read.groups.Expenses, period: '1' } },
                };
            }
            if (asked !== query) {
                // The comparison read other days than meant.
                return { ...read, rangeBeginLabel: '01/01/2026' };
            }
            return read;
        };
        const report = await reportOf(ledger, query, answer);

        expect(report.answer).toEqual({ amount: '1200.5' });
        expect(report.months).toEqual([]);
        expect(report.previous).toBeUndefined();
        expect(report.charts.views.map(view => view.kind)).not.toContain('bar');
    });
});
