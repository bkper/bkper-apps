import type { PeriodParts } from 'report-shared/report-intent';
import { beforeAll, describe, expect, it } from 'vitest';
import { QueryNotAReportError, parseQuery, queryIntent } from '../../src/services/query-intent';
import { ReportError } from '../../src/services/report';
import type { Snapshot } from '../../src/services/snapshot';
import { fixtureSnapshot } from '../fixtures/snapshot-book';

// The fixture Book's today is 2026-11-05 and its dates are written dd/MM/yyyy.
let snapshot: Snapshot;
beforeAll(async () => {
    snapshot = await fixtureSnapshot();
});

function withPattern(datePattern: string): Snapshot {
    return { ...snapshot, book: { ...snapshot.book, datePattern } };
}

const periodOf = (query: string, book = snapshot): PeriodParts => queryIntent(query, book).period;

describe('parseQuery', () => {
    it('reads names, dates and hashtags as Bkper does, and nothing else', () => {
        expect(
            parseQuery(
                `=(Group:'Food & Drinks' OR acc:Rent) -account:"Joe's Bar" after:01/2026 before:$m+1 on:2025 #trip amount>10 is:checked text "a phrase" 100`
            )
        ).toEqual({
            names: [
                { kind: 'group', name: 'Food & Drinks' },
                { kind: 'account', name: 'Rent' },
                { kind: 'account', name: "Joe's Bar" },
            ],
            hashtags: ['trip'],
            after: '01/2026',
            before: '$m+1',
            on: '2025',
        });
    });

    it('reads only the fields it knows', () => {
        expect(parseQuery('constructor:x toString:y __proto__:z remoteId:1')).toEqual({
            names: [],
            hashtags: [],
        });
    });

    it('keeps the first date of each kind, as Bkper does', () => {
        expect(parseQuery('after:2024 after:2025')).toMatchObject({ after: '2024' });
    });
});

describe('queryIntent: groups and accounts', () => {
    it('reads a group by its name, quoted or not, ignoring case, accents and separators', () => {
        for (const query of [
            "group:'Expenses'",
            'group:Expenses',
            'GROUP:expenses',
            'group:"EXPENSÉS"',
        ]) {
            expect(queryIntent(query, snapshot)).toMatchObject({ root: 'g-expenses' });
        }
        expect(queryIntent("group:'net-income'", snapshot)).toMatchObject({ root: 'g-net' });
        expect(queryIntent('group:net_income', snapshot)).toMatchObject({ root: 'g-net' });
    });

    it('reads a subgroup or an account under its root, and an account in no group as a root', () => {
        expect(queryIntent("group:'Banks'", snapshot)).toMatchObject({
            root: 'g-assets',
            target: 'g-banks',
        });
        expect(queryIntent("account:'credit card'", snapshot)).toMatchObject({
            root: 'g-card',
            target: 'a-card',
        });
        const owner = queryIntent('account:Owner', snapshot);
        expect(owner.root).toBe('a-owner');
        expect(owner.target).toBeUndefined();
    });

    it('reads only what each operator names: an account is never a group', () => {
        expect(() => queryIntent("account:'Expenses'", snapshot)).toThrow(QueryNotAReportError);
        expect(() => queryIntent("group:'Rent'", snapshot)).toThrow(QueryNotAReportError);
    });

    it('shows several side by side, in the order written, each once', () => {
        const intent = queryIntent(
            "(account:'Rent' OR account:'Food') account:rent group:'Expenses'",
            snapshot
        );
        expect(intent).toMatchObject({
            root: 'g-expenses',
            target: 'a-rent',
            alongside: [{ root: 'g-expenses', target: 'a-food' }, { root: 'g-expenses' }],
        });
    });

    it('shows at most six, the first six it finds', () => {
        const intent = queryIntent(
            "account:Cash account:'Bank A' group:Nope account:'Bank B' account:'Credit Card' account:Owner group:Card group:Banks",
            snapshot
        );
        expect([
            intent.target ?? intent.root,
            ...(intent.alongside ?? []).map(s => s.target ?? s.root),
        ]).toEqual(['a-cash', 'a-bank-a', 'a-bank-b', 'a-card', 'a-owner', 'g-card']);
    });

    it('leaves out names the Book does not have', () => {
        const intent = queryIntent("group:'Nope' account:'Rent'", snapshot);
        expect(intent).toMatchObject({ root: 'g-expenses', target: 'a-rent' });
        expect(intent.alongside).toBeUndefined();
    });

    it('is not a report without a group or account of the Book', () => {
        for (const query of ['', 'on:2025', '#trip', 'is:checked rent', "group:'Nope'"]) {
            expect(() => queryIntent(query, snapshot)).toThrow(QueryNotAReportError);
        }
    });

    it('is by month only when asked, and leaves the chart to the report', () => {
        const intent = queryIntent("group:'Expenses' on:2025", snapshot);
        expect(intent.monthly).toBe(false);
        expect(intent.chart).toBeUndefined();
        expect(intent.view).toBeUndefined();
        expect(intent.compareWith).toBeUndefined();
    });
});

describe('queryIntent: hashtags', () => {
    it('filters by exactly one hashtag', () => {
        expect(queryIntent("group:'Expenses' #trip", snapshot).hashtags).toEqual(['trip']);
    });

    it('ignores two or more, as Bkper balances do', () => {
        expect(queryIntent("group:'Expenses' #trip #food", snapshot).hashtags).toBeUndefined();
    });
});

describe('queryIntent: periods of activity', () => {
    // Today is 2026-11-05.
    it.each([
        ["group:'Expenses'", { span: 'all_time' }],
        ["group:'Expenses' amount>10 is:checked rent", { span: 'all_time' }],
        ["group:'Expenses' on:2025", { span: 'year', year: 2025 }],
        ["group:'Expenses' on:$y", { span: 'year', year: 'current' }],
        ["group:'Expenses' on:$y-1", { span: 'year', year: 'previous' }],
        ["group:'Expenses' on:$y-2", { span: 'year', year: 'before_previous' }],
        ["group:'Expenses' on:$y-5", { span: 'year', year: 2021 }],
        ["group:'Expenses' after:$y before:$m+1", { span: 'year', year: 'current' }],
        ["group:'Expenses' on:10/2026", { span: 'month', year: 2026, month: 10 }],
        ["group:'Expenses' on:$m", { span: 'month', month: 'current' }],
        ["group:'Expenses' on:$d", { span: 'month', month: 'current' }],
        ["group:'Expenses' on:$m-1", { span: 'month', month: 'previous' }],
        ["group:'Expenses' on:$m-3", { span: 'month', year: 'current', month: 8 }],
        ["group:'Expenses' on:$m-14", { span: 'month', year: 'previous', month: 9 }],
        [
            "group:'Expenses' after:15/08/2026 before:20/08/2026",
            { span: 'month', year: 2026, month: 8 },
        ],
        [
            "group:'Expenses' after:01/07/2026 before:01/10/2026",
            { span: 'quarter', year: 2026, quarter: 3 },
        ],
        [
            "group:'Expenses' after:01/07/2026 before:01/09/2026",
            { span: 'quarter', year: 2026, quarter: 3 },
        ],
        ["group:'Expenses' after:$m-1", { span: 'quarter', quarter: 'current' }],
        ["group:'Expenses' after:$m-4 before:$m-1", { span: 'quarter', quarter: 'previous' }],
        ["group:'Expenses' after:01/10/2026", { span: 'quarter', year: 2026, quarter: 4 }],
        [
            "group:'Expenses' after:01/10/2026 before:01/01/2027",
            { span: 'quarter', year: 2026, quarter: 4 },
        ],
        ["group:'Expenses' after:01/03/2026 before:01/09/2026", { span: 'year', year: 2026 }],
        ["group:'Expenses' after:01/12/2025 before:01/03/2026", { span: 'last_12_months' }],
        ["group:'Expenses' after:2024 before:2026", { span: 'all_time' }],
        ["group:'Expenses' before:2026", { span: 'all_time' }],
        // Dates Bkper cannot read are left out, as it leaves them out.
        ["group:'Expenses' on:31/02/2026", { span: 'all_time' }],
        ["group:'Expenses' on:soon", { span: 'all_time' }],
    ] satisfies [string, PeriodParts][])('%s', (query, period) => {
        expect(periodOf(query)).toEqual(period);
    });

    it('rejects a period that has not started', () => {
        for (const query of ["group:'Expenses' on:2027", "group:'Expenses' after:01/12/2026"]) {
            expect(() => periodOf(query)).toThrow(ReportError);
            try {
                periodOf(query);
            } catch (error) {
                expect(error).toMatchObject({ reason: 'future_period' });
            }
        }
    });
});

describe('queryIntent: periods of positions', () => {
    it.each([
        ["group:'Assets'", { span: 'now' }],
        ["group:'Assets' before:$d+1", { span: 'now' }],
        ["group:'Assets' after:2026", { span: 'now' }],
        ["group:'Assets' on:2026", { span: 'now' }],
        ["group:'Assets' on:2025", { span: 'year', year: 2025 }],
        ["group:'Assets' on:$y-1", { span: 'year', year: 'previous' }],
        ["group:'Assets' on:$m-1", { span: 'month', month: 'previous' }],
        ["group:'Assets' before:01/2026", { span: 'month', year: 2025, month: 12 }],
        [
            "group:'Assets' after:01/04/2025 before:01/07/2025",
            { span: 'quarter', year: 2025, quarter: 2 },
        ],
        // A balance is read at the end of the query's dates: the largest period ending there.
        [
            "group:'Assets' after:01/01/2025 before:01/07/2025",
            { span: 'quarter', year: 2025, quarter: 2 },
        ],
        [
            "group:'Assets' after:01/01/2025 before:01/06/2025",
            { span: 'month', year: 2025, month: 5 },
        ],
    ] satisfies [string, PeriodParts][])('%s', (query, period) => {
        expect(periodOf(query)).toEqual(period);
    });
});

describe('queryIntent: date formats', () => {
    it.each([
        ['dd/MM/yyyy', 'on:05/09/2026', { span: 'month', year: 2026, month: 9 }],
        ['dd/MM/yyyy', 'on:5/9/2026', { span: 'month', year: 2026, month: 9 }],
        ['dd/MM/yyyy', 'on:09/2026', { span: 'month', year: 2026, month: 9 }],
        ['dd/MM/yyyy', 'on:15/09', { span: 'month', year: 2026, month: 9 }],
        ['MM/dd/yyyy', 'on:09/05/2026', { span: 'month', year: 2026, month: 9 }],
        ['MM/dd/yyyy', 'on:05/09/2026', { span: 'month', year: 2026, month: 5 }],
        ['MM/dd/yyyy', 'on:9/2026', { span: 'month', year: 2026, month: 9 }],
        ['MM/dd/yyyy', 'on:9/15', { span: 'month', year: 2026, month: 9 }],
        ['yyyy/MM/dd', 'on:2026/09/05', { span: 'month', year: 2026, month: 9 }],
        ['yyyy/MM/dd', 'on:2026/9', { span: 'month', year: 2026, month: 9 }],
        ['yyyy/MM/dd', 'on:9/15', { span: 'month', year: 2026, month: 9 }],
        ['yyyy/MM/dd', 'on:2026-09', { span: 'month', year: 2026, month: 9 }],
        ['dd/MM/yyyy', 'on:2026-09-05', { span: 'month', year: 2026, month: 9 }],
        ['MM/dd/yyyy', 'on:2025', { span: 'year', year: 2025 }],
    ] satisfies [string, string, PeriodParts][])('%s %s', (pattern, dates, period) => {
        expect(periodOf(`group:'Expenses' ${dates}`, withPattern(pattern))).toEqual(period);
    });

    it('reads dates of another format as Bkper does: not at all', () => {
        expect(periodOf("group:'Expenses' on:2026/09/05", withPattern('dd/MM/yyyy'))).toEqual({
            span: 'all_time',
        });
        expect(periodOf("group:'Expenses' on:13/09/2026", withPattern('MM/dd/yyyy'))).toEqual({
            span: 'all_time',
        });
    });
});
