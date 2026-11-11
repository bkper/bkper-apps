/**
 * Read-only cross-check of report calculations against the bkper CLI on live Books.
 *
 *     npx tsx scripts/verify-report.ts [--today=YYYY-MM-DD] [--hashtag=<tag>] [--root=<id or name>] <bookId> [<bookId> ...]
 *
 * For each Book it loads the snapshot (as of `--today`, when given, so Books with old data also
 * exercise current periods and today's activity), builds reports for several intents within the
 * Book's data range from the balances of each report's own queries (its period and the previous
 * one, per group read, in parallel, as the Worker runs them), and compares every amount shown to
 * the cent with `bkper balance list` over the report's exact query and its previous period.
 * `--root` (repeatable) checks only those root groups, their targets and their default periods,
 * and no net result, so a large Book's run stays small; every amount it shows is still checked:
 *
 * - the answer, as Bkper's balance of the root; for a net result Report calculates, the
 *   Incoming roots minus the Outgoing roots of the CLI, in total, before and in every month;
 * - reports of targets (subgroups and accounts under each root; a group read from its own
 *   queries, an account from those of the smallest group holding it, by the map's groups and
 *   accounts; and accounts in no group, read with a query of their own): every amount as
 *   above, against the CLI's query of the target alone; an account under a root against its row
 *   in the CLI's query of the root, as Bkper does not find some accounts of older Books by name
 *   (`account:'<name>'` answers nothing), and an account in no group Bkper does not find so is
 *   no report, never a zero;
 * - targets side by side (roots, a root with a group or account under it, groups or accounts
 *   of different roots, positions, repeats, the reverse order and hashtags): that they read
 *   exactly the queries each reads alone, each once; that each is a row of its own, in the order
 *   asked for, checked as a report of it alone is, with no total, no share and no
 *   calculation, so nothing adds them up; that charts by month draw each target's own months,
 *   ranked bars rank them by size, and no donut or stacked chart fits; that one asked for
 *   twice shows once; and that positions and activity together are `mixed_targets`;
 * - every row of the breakdown, at any depth, as Bkper's own balance of its group or account,
 *   now, before and in each month: no sign changed, no remainder; and that every group or
 *   account the CLI lists with an amount is a row, so nothing Bkper returns is hidden;
 * - where the net result comes from, against the Book's groups and accounts as the CLI lists
 *   them: the root group that combines Incoming and Outgoing, else simple activity roots that
 *   share no account (and the CLI table shows none twice), else none (`no_net_result`);
 * - every chart that fits each report, the main one and every other one a renderer may switch
 *   to: each month of a chart by month; the parts of a breakdown chart, exactly the rows with an
 *   amount, positive in a donut and adding up to the root's CLI total; each stacked part
 *   in every month (at most six) and their sum against the root; each compared row; that a
 *   bridge asked for is unfit (`no_bridge`), as reports draw none; that the main chart is
 *   among them, and a preferred chart that does not fit is not, with its reason (a pie asked for
 *   is a donut); that no report offers more than six charts. Each line shows the preference, the
 *   main chart, the rule and the reason.
 *
 * The app reads its own queries, with their variables (`on:$m-1 by:m`); the CLI reads the same
 * dates in ISO months, `on:` as `after:` and `before:`, as it lists activity by month only for a
 * query with `after:`. With `--today`, every relative date is written in ISO as of that day.
 *
 * The CLI shows raw balances (credit minus debit), negated for permanent accounts, so Liability
 * and Outgoing come out negative; reports show them as Bkper charts do, by credit nature. A CLI
 * amount is flipped when its row's `credit` equals its `permanent`. Uses your `bkper auth token`;
 * never writes to a Book.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { Amount, Bkper, type Book } from 'bkper-js';
import { readQueryBalances, type QueryBalances } from '../server/src/services/balances.ts';
import { periodIdOf } from 'report-shared/report-intent';
import { readReport } from '../server/src/services/default-period.ts';
import { resolveQueryDates } from '../server/src/services/period-query.ts';
import {
    addDays,
    defaultPeriod,
    isPlausibleYear,
    isoMonth,
    type ReportNature,
} from '../server/src/services/periods.ts';
import {
    MissingBalancesError,
    ReportError,
    buildReport,
    planQueries,
    planReport,
    shownPreference,
    viewKindOf,
    type ReportAmounts,
    type ReportChart,
    type ReportData,
    type ReportRow,
} from '../server/src/services/report.ts';
import {
    NET_RESULT_ROOT,
    REPORT_CHARTS,
    reportIntentOf,
    type ReportIntent,
    type ReportIntentInput,
} from '../server/src/services/report-intent.ts';
import { quote, type Snapshot } from '../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../server/src/services/timing.ts';

const CLI_CONCURRENCY = 6;

/**
 * The Book's today given with `--today`. Bkper resolves `$y`, `$m` and `$d` from its own today,
 * so every query of relative dates is then written in ISO months as of this day, for the app's
 * reads and the CLI's alike; `before:$d+1` (a balance now) reads through the end of that month,
 * as Bkper cannot be asked for a given day by month.
 */
let fixedToday: string | undefined;

function nextMonthOf(month: string): string {
    const [year, monthOfYear] = month.split('-').map(Number);
    return monthOfYear === 12 ? isoMonth(year + 1, 1) : isoMonth(year, monthOfYear + 1);
}

/** A query as Bkper should read it: as of `--today` when given, else as the app wrote it. */
function asOfToday(query: string): string {
    const today = fixedToday;
    if (today === undefined) {
        return query;
    }
    return query
        .split(' ')
        .map(token => {
            const match = /^(on|after|before):(\$[ymd]\S*)$/.exec(token);
            if (!match) {
                return token;
            }
            const [, key, value] = match;
            if (value === '$d+1') {
                return `before:${nextMonthOf(today.slice(0, 7))}`;
            }
            const { first, last } = resolveQueryDates(`${key}:${value} by:m`, today);
            if (key === 'on' && first !== undefined && last !== undefined) {
                return first === last ? `on:${first}` : `on:${first.slice(0, 4)}`;
            }
            if (key === 'after' && first !== undefined) {
                return `after:${first}`;
            }
            if (key === 'before' && last !== undefined) {
                return `before:${nextMonthOf(last)}`;
            }
            throw new Error(`Unexpected query dates: ${token}`);
        })
        .join(' ');
}

/**
 * A query as the CLI reads it: its dates in ISO months, `on:` as `after:` and `before:`, since
 * the CLI lists activity in each month only for a query with `after:`, and running totals for
 * any other. The app's own query, with variables, is read apart, so both must agree.
 */
function forCli(query: string, today: string): string {
    return asOfToday(query)
        .split(' ')
        .map(token => {
            const match = /^on:(\S+)$/.exec(token);
            if (!match) {
                return token;
            }
            const { first, last } = resolveQueryDates(`on:${match[1]} by:m`, today);
            if (first === undefined || last === undefined) {
                throw new Error(`Unexpected query dates: ${token}`);
            }
            return `after:${first} before:${nextMonthOf(last)}`;
        })
        .join(' ');
}
const MAX_STACKED_PARTS = 6;
const run = promisify(execFile);

class MemoryStore implements SnapshotStore {
    private readonly values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async put(key: string, value: string) {
        this.values.set(key, value);
    }
}

/** Runs CLI commands a few at a time. */
class Cli {
    private active = 0;
    private readonly waiting: (() => void)[] = [];

    async balances(bookId: string, query: string): Promise<(string | number)[][]> {
        return JSON.parse(
            await this.run(['balance', 'list', '-b', bookId, '-q', query, '--expanded', '10'])
        ) as (string | number)[][];
    }

    async items<T>(command: 'group' | 'account', bookId: string): Promise<T[]> {
        const list = JSON.parse(await this.run([command, 'list', '-b', bookId])) as {
            items?: T[];
        };
        return list.items ?? [];
    }

    private async run(args: string[]): Promise<string> {
        if (this.active >= CLI_CONCURRENCY) {
            await new Promise<void>(resolve => this.waiting.push(resolve));
        }
        this.active++;
        try {
            const { stdout } = await run('bkper', args, {
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
            });
            return stdout;
        } finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }
}

/**
 * One CLI table: amounts by row name, in total and by month. Like the CLI, a query with
 * `after:` lists activity in each month, and any other query the running total at each month.
 */
interface CliRow {
    name: string;
    /** The top-level row it is under, or its own name. */
    root: string;
    total: Amount;
    months: Map<string, Amount>;
}

type CliTable = Map<string, CliRow[]>;

function cliRows(matrix: (string | number)[][], cumulative: boolean): CliTable {
    const [header = [], ...lines] = matrix;
    const dates = header
        .map((cell, index) => ({ cell: String(cell), index }))
        .filter(({ cell }) => /^\d{4}-\d{2}-\d{2}$/.test(cell));
    const rows: CliTable = new Map();
    let root = '';
    for (const line of lines) {
        const name = String(line[0]).trim();
        // The CLI indents rows by their depth.
        if (!/^\s/.test(String(line[0]))) {
            root = name;
        }
        const months = new Map<string, Amount>();
        let total = new Amount(0);
        for (const { cell, index } of dates) {
            const value = new Amount(String(line[index] ?? 0));
            const month = cell.slice(0, 7);
            months.set(
                month,
                cumulative ? value : (months.get(month) ?? new Amount(0)).plus(value)
            );
            total = cumulative ? value : total.plus(value);
        }
        rows.set(name, [...(rows.get(name) ?? []), { name, root, total, months }]);
    }
    return rows;
}

/** The nature that decides the sign Bkper shows for a group or an account. */
interface Nature {
    credit: boolean;
    permanent: boolean;
}

/**
 * Whether a report's amount is the CLI's. The CLI prints amounts as JavaScript numbers
 * (bkper-js `Amount.toNumber()`), so an amount Bkper answers with more digits than a number
 * holds, such as `631410.608024020000488`, is the CLI's when it is at that precision; amounts of
 * a few decimal places must be exactly equal either way.
 */
function isCliAmount(actual: string, expected: Amount): boolean {
    const amount = new Amount(actual);
    return amount.eq(expected) || amount.toNumber() === expected.toNumber();
}

/** A CLI amount in the sign reports show for the node. */
function shown(nature: Nature, cli: Amount): Amount {
    return nature.credit === nature.permanent ? cli.times(-1) : cli;
}

/** A group, an account or an account in no group of the map, by id. */
function nodeOf(
    snapshot: Snapshot,
    id: string
): { name: string; credit: boolean; permanent: boolean } | undefined {
    return snapshot.groups[id] ?? snapshot.accounts[id] ?? snapshot.ungrouped[id];
}

/** A row's nature: its group's or account's in the map, else that of its type. */
function natureOf(snapshot: Snapshot, row: { id: string; type: string }): Nature {
    const node = nodeOf(snapshot, row.id);
    if (node) {
        return { credit: node.credit, permanent: node.permanent };
    }
    return {
        credit: row.type === 'LIABILITY' || row.type === 'INCOMING',
        permanent: row.type === 'ASSET' || row.type === 'LIABILITY',
    };
}

let failures = 0;
let checks = 0;

function check(ok: boolean, message: string): void {
    checks++;
    if (!ok) {
        failures++;
    }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
}

function intentsFor(
    snapshot: Snapshot,
    history: History,
    hashtags: string[],
    checked: string[]
): ReportIntent[] {
    const range = history.range;
    if (!range) {
        return [];
    }
    const firstYear = range.firstMonth.slice(0, 4);
    const lastYear = range.lastMonth.slice(0, 4);
    const quarter = `${lastYear}-Q${Math.ceil(Number(range.lastMonth.slice(5)) / 3)}`;
    // The net result may read roots that are not checked: only when every root is.
    const roots = checked === snapshot.roots ? [...checked, NET_RESULT_ROOT] : checked;
    const charts = REPORT_CHARTS.filter(chart => chart !== 'auto');
    const intents: ReportIntentInput[] = roots.flatMap(root => [
        { root, period: firstYear, monthly: false },
        { root, period: lastYear, monthly: true },
        { root, period: quarter, monthly: false },
        { root, period: range.lastMonth, monthly: false },
        { root, period: 'this_month', monthly: false },
        { root, period: 'today', monthly: false },
        ...charts.map(chart => ({ root, period: lastYear, monthly: false, chart })),
        { root, period: quarter, monthly: false, chart: 'stacked' as const },
        { root, period: range.lastMonth, monthly: false, chart: 'compare' as const },
        { root, period: range.lastMonth, monthly: false, chart: 'waterfall' as const },
    ]);
    const targets = targetsOf(snapshot, history, lastYear, checked);
    for (const target of targets) {
        intents.push(
            { ...target, period: lastYear, monthly: true },
            { ...target, period: quarter, monthly: false },
            { ...target, period: range.lastMonth, monthly: false, chart: 'compare' },
            { ...target, period: 'today', monthly: false }
        );
    }
    for (const hashtag of hashtags) {
        for (const root of [...roots, ...targets]) {
            const target = typeof root === 'string' ? { root } : root;
            intents.push({ ...target, period: 'all', monthly: false, hashtags: [hashtag] });
            intents.push({ ...target, period: lastYear, monthly: true, hashtags: [hashtag] });
        }
    }
    for (const group of sideBySideOf(snapshot, targets, checked)) {
        const [first, ...alongside] = group;
        const intent = { ...first, alongside };
        intents.push(
            { ...intent, period: lastYear, monthly: true },
            { ...intent, period: quarter, monthly: false },
            { ...intent, period: range.lastMonth, monthly: false, chart: 'compare' },
            { ...intent, period: lastYear, monthly: false, chart: 'pie' },
            { ...intent, period: lastYear, monthly: true, chart: 'stacked' },
            { ...intent, period: 'today', monthly: false },
            // The same targets the other way round.
            {
                ...group[group.length - 1],
                alongside: group.slice(0, -1).reverse(),
                period: lastYear,
                monthly: false,
            },
            // A target asked for again shows once.
            { ...intent, alongside: [...alongside, first], period: quarter, monthly: false },
            ...hashtags.map(hashtag => ({
                ...intent,
                period: lastYear,
                monthly: true,
                hashtags: [hashtag],
            }))
        );
    }
    return intents.map(reportIntentOf);
}

type Subject = Pick<ReportIntent, 'root' | 'target'>;

/**
 * Targets to show side by side, each of one kind: the activity roots; a root with each kind of
 * target under it (a group, an account); targets under different roots; the position roots
 * with an account in no group of their kind.
 */
function sideBySideOf(snapshot: Snapshot, targets: Subject[], checked: string[]): Subject[][] {
    const permanent = (subject: Subject) =>
        nodeOf(snapshot, subject.target ?? subject.root)?.permanent ?? false;
    const roots = checked.map(root => ({ root }));
    const groups: Subject[][] = [];
    for (const kind of [false, true]) {
        const own = roots.filter(subject => permanent(subject) === kind);
        const under = targets.filter(
            subject => subject.target !== undefined && permanent(subject) === kind
        );
        const ungrouped = targets.filter(
            subject => subject.target === undefined && permanent(subject) === kind
        );
        if (own.length >= 2) groups.push(own.slice(0, 3));
        const [nested] = under;
        if (nested) groups.push([{ root: nested.root }, nested]);
        const other = under.find(subject => subject.root !== nested?.root);
        if (nested && other) groups.push([nested, other]);
        const account = under.find(
            subject => snapshot.accounts[subject.target ?? ''] !== undefined
        );
        if (account && account !== nested) groups.push([nested ?? account, account]);
        if (own[0] && ungrouped[0]) groups.push([own[0], ungrouped[0]]);
    }
    return groups.filter(group => group.length >= 2);
}

/** Targets of both kinds side by side, which no report shows. */
function mixedOf(snapshot: Snapshot): ReportIntent | undefined {
    const activity = snapshot.roots.find(root => !snapshot.groups[root].permanent);
    const position = snapshot.roots.find(root => snapshot.groups[root].permanent);
    return activity && position
        ? reportIntentOf({
              root: activity,
              alongside: [{ root: position }],
              period: 'this_year',
              monthly: false,
          })
        : undefined;
}

/** Accounts of a root read for its targets, the busiest in the year first. */
const ACCOUNT_TARGETS = 2;
/** Accounts in no group read, the first in the Book. */
const UNGROUPED_TARGETS = 3;

/**
 * Targets of reports: every subgroup and the busiest accounts of each root, under it, and a few
 * accounts in no group, each a root of its own.
 */
function targetsOf(
    snapshot: Snapshot,
    history: History,
    year: string,
    checked: string[]
): Pick<ReportIntent, 'root' | 'target'>[] {
    const targets: Pick<ReportIntent, 'root' | 'target'>[] = [];
    for (const root of checked) {
        const groups: string[] = [];
        const accounts = new Set<string>();
        const collect = (id: string): void => {
            const group = snapshot.groups[id];
            group.accounts.forEach(account => accounts.add(account));
            group.groups.forEach(child => {
                groups.push(child);
                collect(child);
            });
        };
        collect(root);
        const busy = (id: string) =>
            [...(history.months.get(snapshot.accounts[id].name) ?? [])].filter(month =>
                month.startsWith(year)
            ).length;
        const busiest = [...accounts]
            .filter(id => busy(id) > 0)
            .sort((a, b) => busy(b) - busy(a))
            .slice(0, ACCOUNT_TARGETS);
        targets.push(...[...groups, ...busiest].map(target => ({ root, target })));
    }
    const ungrouped = Object.values(snapshot.ungrouped)
        .filter(account => !account.archived)
        .slice(0, UNGROUPED_TARGETS);
    return [...targets, ...ungrouped.map(account => ({ root: account.id }))];
}

/**
 * Where the Book's net result comes from, from its groups and accounts as the CLI lists them,
 * apart from the snapshot: the root group of Incoming and Outgoing accounts with the most
 * accounts (the first in the CLI's order on a tie), else simple activity roots sharing no
 * account, else none.
 */
type ExpectedNet =
    | { kind: 'group'; id: string }
    | { kind: 'calculated'; incoming: string[]; outgoing: string[] }
    | { kind: 'none' };

interface CliGroup {
    id: string;
    name: string;
    type?: string;
    mixed?: boolean;
    permanent?: boolean;
    parent?: { id?: string };
}

interface CliAccount {
    id: string;
    type: string;
    groups?: { id?: string }[];
}

async function expectedNet(cli: Cli, bookId: string, snapshot: Snapshot): Promise<ExpectedNet> {
    const [groups, accounts] = await Promise.all([
        cli.items<CliGroup>('group', bookId),
        cli.items<CliAccount>('account', bookId),
    ]);
    const under = (root: string): Set<string> => {
        const ids = new Set([root]);
        for (let grew = true; grew;) {
            grew = false;
            for (const group of groups) {
                if (group.parent?.id && ids.has(group.parent.id) && !ids.has(group.id)) {
                    ids.add(group.id);
                    grew = true;
                }
            }
        }
        return new Set(
            accounts
                .filter(account => snapshot.accounts[account.id] !== undefined)
                .filter(account => account.groups?.some(ref => ids.has(ref.id ?? '')))
                .map(account => account.id)
        );
    };
    const activity = groups.filter(
        group => !group.parent?.id && !group.permanent && snapshot.roots.includes(group.id)
    );
    const held = new Map(activity.map(group => [group.id, under(group.id)]));
    const types = (id: string) =>
        new Set(
            [...(held.get(id) ?? [])].map(
                account => accounts.find(candidate => candidate.id === account)?.type
            )
        );
    const combining = activity
        .filter(group => group.mixed && types(group.id).has('INCOMING'))
        .filter(group => types(group.id).has('OUTGOING'))
        .sort((a, b) => (held.get(b.id)?.size ?? 0) - (held.get(a.id)?.size ?? 0))[0];
    if (combining) {
        return { kind: 'group', id: combining.id };
    }
    const incoming = activity.filter(group => !group.mixed && group.type === 'INCOMING');
    const outgoing = activity.filter(group => !group.mixed && group.type === 'OUTGOING');
    const all = activity.flatMap(group => [...(held.get(group.id) ?? [])]);
    return incoming.length > 0 &&
        outgoing.length > 0 &&
        incoming.length + outgoing.length === activity.length &&
        new Set(all).size === all.length
        ? {
              kind: 'calculated',
              incoming: incoming.map(group => group.id),
              outgoing: outgoing.map(group => group.id),
          }
        : { kind: 'none' };
}

/**
 * The months with movements of the Book, from the CLI apart from the app: each root's activity
 * by month over its whole history up to today, as amounts in each month by row name.
 */
interface History {
    /** By root id: the months any group or account of the root has an amount in. */
    roots: Map<string, Set<string>>;
    /** By group or account name: the months it has an amount in. */
    months: Map<string, Set<string>>;
    /** First and last months with movements in any root. */
    range?: { firstMonth: string; lastMonth: string };
}

async function bookHistory(
    cli: Cli,
    bookId: string,
    snapshot: Snapshot,
    checked: string[]
): Promise<History> {
    const history: History = { roots: new Map(), months: new Map() };
    // Through the end of the current month, as the app's own history query reads it.
    const end = `${nextMonthOf(snapshot.today.slice(0, 7))}-01`;
    const all = new Set<string>();
    await Promise.all(
        checked.map(async id => {
            // The CLI lists activity in each month of a query with `after:`.
            const query = `group:${quote(snapshot.groups[id].name)} after:1000-01-01 before:${end} by:m`;
            const root = new Set<string>();
            for (const [name, rows] of cliRows(await cli.balances(bookId, query), false)) {
                const moved = rows.flatMap(row =>
                    [...row.months]
                        .filter(([month, amount]) => !amount.eq(0) && plausible(month))
                        .map(([month]) => month)
                );
                const known = history.months.get(name) ?? new Set<string>();
                moved.forEach(month => (known.add(month), root.add(month), all.add(month)));
                history.months.set(name, known);
            }
            history.roots.set(id, root);
        })
    );
    const months = [...all].sort();
    if (months.length > 0) {
        history.range = { firstMonth: months[0], lastMonth: months[months.length - 1] };
    }
    return history;
}

function plausible(month: string): boolean {
    return isPlausibleYear(Number(month.slice(0, 4)));
}

/** Reads the balances of queries from Bkper, as the Worker does, counting them. */
function balancesReader(book: Book, count: { queries: number }) {
    return (queries: string[]): Promise<QueryBalances[]> => {
        count.queries += queries.length;
        return Promise.all(
            queries.map(async query => {
                const asked = new Date();
                return readQueryBalances(
                    query,
                    await book.getBalancesReport(asOfToday(query)),
                    asked
                );
            })
        );
    };
}

/**
 * Reports of requests that name no period, read as the Worker reads them: each root's (and the
 * net result's) default period, this year for activity or today for a position, and the last
 * 12 months by month. Checks that the period read is the default one when it has movements,
 * else the last year with movements by the CLI's history, and that only a default period
 * without movements reads one more query, of the history, before the report of that year.
 */
async function defaultPeriodReports(
    snapshot: Snapshot,
    history: History,
    net: ExpectedNet,
    book: Book,
    checked: string[]
): Promise<{ label: string; report: ReportData }[]> {
    const subjects: { root: string; months: Set<string>; nature: ReportNature }[] = [
        ...checked.map(root => ({
            root,
            months: history.roots.get(root) ?? new Set<string>(),
            nature: (snapshot.groups[root].permanent ? 'position' : 'activity') as ReportNature,
        })),
        ...(net.kind === 'none' || checked !== snapshot.roots
            ? []
            : [
                  {
                      root: NET_RESULT_ROOT,
                      months: new Set(
                          (net.kind === 'group'
                              ? [net.id]
                              : [...net.incoming, ...net.outgoing]
                          ).flatMap(root => [...(history.roots.get(root) ?? [])])
                      ),
                      nature: 'activity' as ReportNature,
                  },
              ]),
    ];
    const reports: { label: string; report: ReportData }[] = [];
    for (const { root, months, nature } of subjects) {
        for (const trend of [false, true]) {
            const today = snapshot.today;
            const asked = defaultPeriod({ nature, trend, today });
            const intent = reportIntentOf({ root, period: asked, monthly: trend });
            const last = [...months].sort().at(-1);
            const expected = defaultPeriod({ nature, trend, today, lastActiveMonth: last });
            const count = { queries: 0 };
            const read = await readReport(intent, snapshot, {
                loadBalances: balancesReader(book, count),
                defaultPeriod: true,
            });
            const own = planQueries(planReport(intent, snapshot)).length;
            const inPeriod = [...months].some(month => inRange(month, intent, snapshot));
            const expectedQueries =
                asked === 'today' || inPeriod
                    ? own
                    : own +
                      1 +
                      (expected === asked
                          ? 0
                          : planQueries(
                                planReport(
                                    reportIntentOf({ ...intent, period: expected }),
                                    snapshot
                                )
                            ).length);
            const label = `${nodeOf(snapshot, root)?.name ?? root} default ${asked}${trend ? ' monthly' : ''}`;
            check(
                periodText(read.intent) === expected && count.queries === expectedQueries,
                `${label}: reads ${periodText(read.intent)} (last movement ${last ?? 'none'}), ` +
                    `${count.queries} queries`
            );
            reports.push({ label, report: buildReport(read.intent, snapshot, read.balances) });
        }
    }
    return reports;
}

/** An intent's period as its id, or its parts when no id says them. */
function periodText(intent: ReportIntent): string {
    return periodIdOf({ period: intent.period }) ?? JSON.stringify(intent.period);
}

/** Whether a month is within an intent's period, as the CLI's history lists months. */
function inRange(month: string, intent: ReportIntent, snapshot: Snapshot): boolean {
    const { first, last } = planReport(intent, snapshot).period.read;
    return (first === undefined || month >= first) && month <= last;
}

async function computeReport(
    intent: ReportIntent,
    snapshot: Snapshot,
    book: Book
): Promise<{ report: ReportData; computeMs: number; queriesMs: number; queries: number }> {
    const queries = planQueries(planReport(intent, snapshot));
    let start = performance.now();
    const balances = await Promise.all(
        queries.map(async query => {
            const asked = new Date();
            return readQueryBalances(query, await book.getBalancesReport(asOfToday(query)), asked);
        })
    );
    const queriesMs = performance.now() - start;
    start = performance.now();
    const report = buildReport(intent, snapshot, balances);
    return { report, computeMs: performance.now() - start, queriesMs, queries: queries.length };
}

/**
 * The CLI query a report is checked against: the report's own, but for an account under a
 * root, whose root's query lists it, as Bkper does not find some accounts by name.
 */
function cliQuery(report: ReportData, snapshot: Snapshot): string {
    const { root, target } = report.intent;
    const account = target === undefined ? undefined : snapshot.accounts[target];
    if (!account) {
        return report.query;
    }
    const own = `account:${quote(account.name)}`;
    return `group:${quote(snapshot.groups[root].name)}${report.query.slice(own.length)}`;
}

/** A query of the report's dates, with the dates of the period it is compared with instead. */
function previousQuery(report: ReportData, query: string): string {
    const { period, previous } = report;
    if (!previous || !query.endsWith(period.dates)) {
        throw new Error(`No comparison of ${query}`);
    }
    return `${query.slice(0, -period.dates.length)}${previous.dates}`;
}

/** What the checks of one report read: its CLI tables, and how to compare with them. */
interface CliCheck {
    snapshot: Snapshot;
    current: CliTable;
    previous?: CliTable;
    /** The report's CLI table lists running totals rather than activity. */
    cumulative: boolean;
    /** Whether the report and the CLI table both have amounts by month to compare. */
    byMonth: boolean;
    /** Whether the CLI table is of the report's own group or account, not of its root's. */
    own: boolean;
    /** The CLI amount of a group or account by name, in the sign Bkper shows for it. */
    total(rows: CliTable | undefined, name: string, nature: Nature): Amount;
    /** The CLI amount of a group or account by name in a month of the report. */
    month(name: string, nature: Nature, at: string): Amount;
    same(what: string, actual: string | undefined, expected: Amount): void;
}

async function verifyReport(
    cli: Cli,
    bookId: string,
    snapshot: Snapshot,
    report: ReportData,
    label: string,
    net: ExpectedNet
): Promise<void> {
    if (!isOneSubject(report)) {
        return verifySideBySide(cli, bookId, snapshot, report, label);
    }
    const read = async (query: string) => {
        const text = forCli(query, snapshot.today);
        return cliRows(await cli.balances(bookId, text), !text.includes('after:'));
    };
    const cumulative = !forCli(report.query, snapshot.today).includes('after:');
    const query = cliQuery(report, snapshot);
    const [current, previous] = await Promise.all([
        read(query),
        report.previous ? read(previousQuery(report, query)) : Promise.resolve(undefined),
    ]);
    const problems: string[] = [];
    const same = (what: string, actual: string | undefined, expected: Amount) => {
        if (actual === undefined || !isCliAmount(actual, expected)) {
            problems.push(`${what}: report ${actual} vs CLI ${expected.toFixed()}`);
        }
    };
    const total = (rows: CliTable | undefined, name: string, nature: Nature) =>
        shown(nature, rows?.get(name)?.[0]?.total ?? new Amount(0));
    const month = (name: string, nature: Nature, at: string) => {
        const months = current.get(name)?.[0]?.months ?? new Map<string, Amount>();
        return shown(nature, cliSeries(report, months, cumulative).get(at) ?? new Amount(0));
    };
    const byMonth = report.months.length > 1 && (report.nature === 'position' || !cumulative);
    const cliCheck: CliCheck = {
        snapshot,
        current,
        previous,
        cumulative,
        byMonth,
        own: query === report.query,
        total,
        month,
        same,
    };

    problems.push(...netProblems(report, net));
    problems.push(...targetProblems(report, snapshot));
    if (report.calculated) {
        problems.push(...calculatedProblems(report, cliCheck));
    } else {
        const root = nodeOf(snapshot, report.root.id);
        if (!root) {
            problems.push(`${report.root.id}: the report is of nothing in the map`);
        } else {
            same('answer', report.answer.amount, total(current, root.name, root));
            if (previous) {
                same('previous', report.answer.previous, total(previous, root.name, root));
            }
        }
    }
    problems.push(...rowProblems(report, cliCheck));
    problems.push(...choiceProblems(report));
    for (const view of report.charts.views) {
        problems.push(
            ...chartProblems(report, view, cliCheck).map(problem => `${view.kind}: ${problem}`)
        );
    }

    const rowCount = countRows(report.breakdown);
    const { charts } = report;
    const unfit = charts.unfit ? `, ${charts.unfit.kind} unfit: ${charts.unfit.reason.code}` : '';
    const chart =
        ` [${report.intent.chart ?? 'auto'} → ${charts.main} by ${charts.rule}${unfit};` +
        ` ${charts.views.length} views]`;
    const calculated = report.calculated ? ' (calculated by Report)' : '';
    check(
        problems.length === 0,
        `${label}${chart}: ${report.answer.amount}${calculated}` +
            (report.answer.previous === undefined ? '' : ` (prev ${report.answer.previous})`) +
            `, ${rowCount} rows — ${report.query}` +
            (problems.length ? `\n         ${problems.slice(0, 4).join('\n         ')}` : '')
    );
}

/** A report of one group or account, or of a net result: not of targets side by side. */
type OneReport = Extract<ReportData, { answer: ReportAmounts }>;
type SideBySideReport = Extract<ReportData, { targets: ReportRow[] }>;

function isOneSubject(report: ReportData): report is OneReport {
    return report.targets === undefined;
}

/** The targets of an intent side by side, each once, in order. */
function subjectsOf(intent: ReportIntent, snapshot: Snapshot): Subject[] {
    const all = [{ root: intent.root, target: intent.target }, ...(intent.alongside ?? [])];
    const seen = new Set<string>();
    return all.filter(subject => {
        const id = subject.target ?? subject.root;
        const first = !seen.has(id) && nodeOf(snapshot, id) !== undefined;
        seen.add(id);
        return first;
    });
}

/**
 * Targets side by side: each its own row, in the order asked for, checked against the CLI as a
 * report of it alone is, from the queries of its root alone, each root once; no total, no
 * share and nothing calculated, so nothing adds them up; and only charts that imply no whole.
 */
async function verifySideBySide(
    cli: Cli,
    bookId: string,
    snapshot: Snapshot,
    report: SideBySideReport,
    label: string
): Promise<void> {
    const { intent, targets } = report;
    const problems: string[] = [];
    const subjects = subjectsOf(intent, snapshot);
    const single = (subject: Subject): ReportIntent => ({
        ...intent,
        root: subject.root,
        target: subject.target,
        alongside: undefined,
    });
    const queries = planQueries(planReport(intent, snapshot));
    const own = subjects.flatMap(subject => planQueries(planReport(single(subject), snapshot)));
    if (queries.join() !== [...new Set(own)].join() || new Set(queries).size !== queries.length) {
        problems.push('Targets side by side do not read exactly their own queries, each once');
    }
    if (targets.map(row => row.id).join() !== subjects.map(s => s.target ?? s.root).join()) {
        problems.push('The targets are not the rows, once each, in the order asked for');
    }
    if (report.answer !== undefined || report.calculated !== undefined) {
        problems.push('Targets side by side have a total');
    }
    if (targets.some(row => row.share !== undefined)) {
        problems.push('A target side by side has a share');
    }
    if (report.breakdown !== targets) {
        problems.push('The breakdown is not the targets');
    }
    const dates = report.period.dates;
    const tags = (intent.hashtags ?? []).map(tag => ` #${tag}`).join('');
    await Promise.all(
        subjects.map(async (subject, index) => {
            const row = targets[index];
            const node = nodeOf(snapshot, subject.target ?? subject.root);
            if (!row || !node) return;
            // An account under a root against its row in the CLI's query of the root, as Bkper
            // does not find some accounts of older Books by name.
            const id = subject.target ?? subject.root;
            const account =
                subject.target !== undefined && Object.hasOwn(snapshot.accounts, subject.target);
            const kind = Object.hasOwn(snapshot.groups, id) ? 'group' : 'account';
            const filter = account
                ? `group:${quote(snapshot.groups[subject.root].name)}`
                : `${kind}:${quote(node.name)}`;
            const query = `${filter}${tags} ${dates}`;
            const read = async (asked: string) => {
                const text = forCli(asked, snapshot.today);
                return cliRows(await cli.balances(bookId, text), !text.includes('after:'));
            };
            const [current, previous] = await Promise.all([
                read(query),
                report.previous ? read(previousQuery(report, query)) : Promise.resolve(undefined),
            ]);
            const cumulative = !forCli(report.query, snapshot.today).includes('after:');
            const byMonth =
                report.months.length > 1 && (report.nature === 'position' || !cumulative);
            const total = (rows: CliTable | undefined, name: string, nature: Nature) =>
                shown(nature, rows?.get(name)?.[0]?.total ?? new Amount(0));
            const same = (what: string, actual: string | undefined, expected: Amount) => {
                if (actual === undefined || !isCliAmount(actual, expected)) {
                    problems.push(`${what}: report ${actual} vs CLI ${expected.toFixed()}`);
                }
            };
            const month = (name: string, nature: Nature, at: string) => {
                const months = current.get(name)?.[0]?.months ?? new Map<string, Amount>();
                return shown(
                    nature,
                    cliSeries(report, months, cumulative).get(at) ?? new Amount(0)
                );
            };
            const names = new Set<string>();
            const visit = (entry: ReportRow) => {
                names.add(entry.name);
                const nature = natureOf(snapshot, entry);
                same(entry.name, entry.amount, total(current, entry.name, nature));
                if (previous) {
                    same(
                        `${entry.name} previous`,
                        entry.previous,
                        total(previous, entry.name, nature)
                    );
                }
                if (byMonth) {
                    report.months.forEach((at, i) =>
                        same(`${entry.name} ${at}`, entry.months[i], month(entry.name, nature, at))
                    );
                }
                entry.children.forEach(visit);
            };
            visit(row);
            // The CLI table of the target alone lists nothing with an amount that is no row.
            for (const table of account ? [] : [current, previous]) {
                for (const [name, rows] of table ?? []) {
                    if (!names.has(name) && !rows[0].total.eq(0)) {
                        problems.push(
                            `${name}: Bkper returns it with an amount, but it is not a row`
                        );
                    }
                }
            }
        })
    );
    const kinds = report.charts.views.map(viewKindOf);
    for (const whole of ['donut', 'stacked'] as const) {
        if (kinds.includes(whole)) problems.push(`${whole} of targets side by side`);
    }
    const preferred = intent.chart;
    if (
        (preferred === 'pie' || preferred === 'donut' || preferred === 'stacked') &&
        report.charts.unfit?.reason.code !== 'side_by_side'
    ) {
        problems.push(`A ${preferred} asked for is not unfit as side by side`);
    }
    for (const view of report.charts.views) {
        if (view.kind === 'bar' || view.kind === 'line' || view.kind === 'area') {
            const series = view.series.map(entry => `${entry.id}:${entry.amounts.join()}`);
            const rows = targets.map(row => `${row.id}:${row.months.join()}`);
            if (series.join('|') !== rows.join('|')) {
                problems.push(`${view.kind}: the series are not each target’s own months`);
            }
        }
        if (view.kind === 'ranked-bar') {
            const ranked = targets
                .filter(row => !new Amount(row.amount).eq(0))
                .sort((a, b) => new Amount(b.amount).abs().cmp(new Amount(a.amount).abs()))
                .map(row => row.id);
            if (view.rows.join() !== ranked.join()) {
                problems.push('ranked-bar: does not rank the targets with an amount by size');
            }
        }
        if (view.kind === 'compare' && view.rows.some(id => !targets.some(row => row.id === id))) {
            problems.push('compare: draws what is not a target');
        }
    }
    problems.push(...choiceProblems(report));
    const { charts } = report;
    const unfit = charts.unfit ? `, ${charts.unfit.kind} unfit: ${charts.unfit.reason.code}` : '';
    check(
        problems.length === 0,
        `${label} [${intent.chart ?? 'auto'} → ${charts.main} by ${charts.rule}${unfit}; ` +
            `${charts.views.length} views]: ${targets.map(row => `${row.name} ${row.amount}`).join(' | ')}` +
            ` — ${report.query}` +
            (problems.length ? `\n         ${problems.slice(0, 4).join('\n         ')}` : '')
    );
}

/**
 * Whether a report of a target is of the target, read from the queries of one group alone: a
 * group's own, an account's of a group holding it with no smaller group holding it (the fewest
 * groups and accounts at any depth); and an account in no group from queries of that account
 * alone.
 */
function targetProblems(report: OneReport, snapshot: Snapshot): string[] {
    const { intent } = report;
    const queries = planQueries(planReport(intent, snapshot));
    if (intent.target !== undefined) {
        return [
            ...(report.root.id === intent.target ? [] : ['The report is not of its target']),
            ...sourceProblems(queries, intent.target, snapshot),
        ];
    }
    const account = snapshot.ungrouped[intent.root];
    if (account) {
        const own = queries.every(query => query.startsWith(`account:${quote(account.name)} `));
        return own ? [] : ['An account in no group is not read with queries of its own'];
    }
    return [];
}

/** Whether a target's queries are all of the one group it must be read from. */
function sourceProblems(queries: string[], target: string, snapshot: Snapshot): string[] {
    const filters = new Set(queries.map(query => /^\S+:('[^']*'|"[^"]*")/.exec(query)?.[0]));
    const [filter] = filters;
    const group = Object.hasOwn(snapshot.groups, target) ? snapshot.groups[target] : undefined;
    if (group) {
        return filters.size === 1 && filter === `group:${quote(group.name)}`
            ? []
            : [`${group.name} is not read from its own queries: ${[...filters].join(', ')}`];
    }
    const size = (start: string): number => {
        const seen = new Set<string>();
        const visit = (id: string): void => {
            snapshot.groups[id].accounts.forEach(account => seen.add(`account:${account}`));
            snapshot.groups[id].groups.forEach(child => (seen.add(`group:${child}`), visit(child)));
        };
        visit(start);
        return seen.size;
    };
    const holding = Object.values(snapshot.groups).filter(candidate =>
        candidate.accounts.includes(target)
    );
    const smallest = Math.min(...holding.map(candidate => size(candidate.id)));
    const read = holding.find(candidate => filter === `group:${quote(candidate.name)}`);
    return filters.size === 1 && read !== undefined && size(read.id) === smallest
        ? []
        : [
              `${snapshot.accounts[target]?.name ?? target} is not read from the smallest group ` +
                  `holding it: ${[...filters].join(', ')}`,
          ];
}

/** Whether a net result comes from where the Book's groups and accounts say it must. */
function netProblems(report: OneReport, net: ExpectedNet): string[] {
    if (report.intent.root !== NET_RESULT_ROOT) {
        return report.calculated ? ['A report of a group is calculated by Report'] : [];
    }
    switch (net.kind) {
        case 'group':
            return report.root.id === net.id && !report.calculated
                ? []
                : [`The net result is not the group ${net.id} that combines Incoming and Outgoing`];
        case 'calculated':
            return report.root.id === NET_RESULT_ROOT && report.calculated
                ? []
                : ['The net result of simple roots is not calculated by Report'];
        case 'none':
            return ['A net result of a Book that has none'];
    }
}

/**
 * A net result Report calculates: its rows are its roots, Incoming first, and it is the CLI's
 * Incoming roots minus its Outgoing roots, in total, before and in every month, with no
 * account under two roots.
 */
function calculatedProblems(report: OneReport, cli: CliCheck): string[] {
    const problems: string[] = [];
    const { snapshot, current, previous, total, same } = cli;
    const roots = report.breakdown.map(row => snapshot.groups[row.id]);
    if (roots.some(root => root === undefined || !snapshot.roots.includes(root.id))) {
        problems.push('A row of a calculated net result is not a root group');
        return problems;
    }
    const sign = (type: string) => (type === 'INCOMING' ? 1 : type === 'OUTGOING' ? -1 : 0);
    if (roots.some(root => sign(root.type) === 0)) {
        problems.push('A root of a calculated net result is neither Incoming nor Outgoing');
    }
    // Bkper's root totals, as the CLI shows them, each with its sign in the net result. A root
    // without amounts is left out of the rows, so read every activity root of the Book.
    const activity = snapshot.roots
        .map(id => snapshot.groups[id])
        .filter(group => !group.permanent);
    const net = (pick: (group: (typeof activity)[number]) => Amount) =>
        activity.reduce(
            (sum, group) => sum.plus(pick(group).times(sign(group.type))),
            new Amount(0)
        );
    same(
        'net',
        report.answer.amount,
        net(group => total(current, group.name, group))
    );
    if (previous) {
        same(
            'previous net',
            report.answer.previous,
            net(group => total(previous, group.name, group))
        );
    }
    if (cli.byMonth) {
        report.months.forEach((at, i) =>
            same(
                `net ${at}`,
                report.calculated?.months[i],
                net(group => cli.month(group.name, group, at))
            )
        );
    }
    for (const table of [current, previous]) {
        for (const [name, rows] of table ?? []) {
            if (new Set(rows.map(row => row.root)).size > 1) {
                problems.push(`${name} is under two roots of a calculated net result`);
            }
        }
    }
    return problems;
}

/**
 * Every row, at any depth, is Bkper's own balance of its group or account, now, before and in
 * each month; and every group or account the CLI lists with an amount is a row.
 */
function rowProblems(report: OneReport, cli: CliCheck): string[] {
    const problems: string[] = [];
    const { snapshot, current, previous, total, same } = cli;
    const names = new Set<string>();
    const visit = (row: ReportRow) => {
        names.add(row.name);
        if (row.kind !== 'group' && row.kind !== 'account') {
            problems.push(`${row.name}: a row of the kind ${String(row.kind)}`);
        }
        const nature = natureOf(snapshot, row);
        if (!current.has(row.name) && !previous?.has(row.name)) {
            problems.push(`${row.name}: not a row Bkper returns`);
        }
        same(row.name, row.amount, total(current, row.name, nature));
        if (previous) {
            same(`${row.name} previous`, row.previous, total(previous, row.name, nature));
        }
        if (cli.byMonth) {
            report.months.forEach((at, i) =>
                same(`${row.name} ${at}`, row.months[i], cli.month(row.name, nature, at))
            );
        }
        row.children.forEach(visit);
    };
    report.breakdown.forEach(visit);
    const roots = report.calculated
        ? snapshot.roots.map(id => snapshot.groups[id].name)
        : [nodeOf(snapshot, report.root.id)?.name ?? report.root.id];
    // The CLI table of a root lists more than an account under it holds, which is nothing.
    for (const table of cli.own ? [current, previous] : []) {
        for (const [name, rows] of table ?? []) {
            if (!names.has(name) && !roots.includes(name) && !rows[0].total.eq(0)) {
                problems.push(`${name}: Bkper returns it with an amount, but it is not a row`);
            }
        }
    }
    return problems;
}

/**
 * Whether the main chart is one of the charts that fit, drawn as the report's chart, and a
 * preferred chart that does not fit is left out of them, with the main chart marked `fallback`.
 */
function choiceProblems(report: ReportData): string[] {
    const problems: string[] = [];
    const { charts, chart } = report;
    const kinds = charts.views.map(viewKindOf);
    if (new Set(kinds).size !== kinds.length) {
        problems.push(`Repeated views: ${kinds.join(', ')}`);
    }
    const main = charts.views.find(view => viewKindOf(view) === charts.main);
    if (!main || viewKindOf(chart) !== charts.main) {
        problems.push(`The main chart ${charts.main} is not among the views, or not drawn`);
    } else if (
        JSON.stringify({ ...chart, fallback: undefined }) !==
        JSON.stringify({ ...main, fallback: undefined })
    ) {
        problems.push('The main chart is not its view');
    }
    if (charts.unfit && kinds.includes(charts.unfit.kind)) {
        problems.push(`${charts.unfit.kind} is unfit and among the views`);
    }
    if ((chart.fallback === true) !== (charts.unfit !== undefined)) {
        problems.push('A fallback without an unfit preference, or the reverse');
    }
    if (kinds.filter(kind => kind !== 'table').length > 6) {
        problems.push(`More than six charts: ${kinds.join(', ')}`);
    }
    const preferred = report.intent.chart && shownPreference(report.intent.chart);
    if (preferred && preferred !== 'auto' && !charts.unfit && charts.main !== preferred) {
        problems.push(`The preferred ${preferred} fits, but ${charts.main} is drawn`);
    }
    if (preferred === 'waterfall' && charts.unfit?.reason.code !== 'no_bridge') {
        problems.push('A bridge asked for is not unfit as no bridge');
    }
    return problems;
}

/**
 * Cross-checks the data of a chart against the CLI: each month of a chart by month, breakdown
 * parts and their whole, stacked parts in every month and their whole, and compared parts.
 */
function chartProblems(report: OneReport, chart: ReportChart, cli: CliCheck): string[] {
    const problems: string[] = [];
    const { snapshot, current, total, same } = cli;
    const root = report.calculated ? undefined : nodeOf(snapshot, report.root.id);
    const rowOf = (id: string) => report.breakdown.find(row => row.id === id);
    const sum = (values: string[]) =>
        values.reduce<Amount>((result, value) => result.plus(value), new Amount(0));

    if (chart.kind === 'bar' || chart.kind === 'line' || chart.kind === 'area') {
        for (const series of chart.series) {
            if (series.id === NET_RESULT_ROOT) {
                if (series.amounts.join() !== report.calculated?.months.join()) {
                    problems.push('The net result series is not the calculated net result');
                }
                continue;
            }
            const node = nodeOf(snapshot, series.id);
            if (!node) {
                problems.push(`${series.id}: a series of nothing in the map`);
            } else if (cli.byMonth) {
                report.months.forEach((at, i) =>
                    same(`${series.name} ${at}`, series.amounts[i], cli.month(node.name, node, at))
                );
            }
        }
    }
    if (chart.kind === 'ranked-bar' || chart.kind === 'donut') {
        const drawn = report.breakdown.filter(row => !new Amount(row.amount).eq(0));
        if (chart.rows.join() !== drawn.map(row => row.id).join()) {
            problems.push('Does not draw exactly the parts with an amount, in order');
        }
        if (chart.kind !== 'ranked-bar') {
            if (!root) {
                problems.push('Slices of a net result');
            } else {
                for (const id of chart.rows) {
                    if (!new Amount(rowOf(id)?.amount ?? 0).gt(0)) {
                        problems.push(`Draws ${id}, not a positive part`);
                    }
                }
                same(
                    'whole of the slices',
                    sum(chart.rows.map(id => rowOf(id)?.amount ?? '0')).toFixed(),
                    total(current, root.name, root)
                );
            }
        }
    }
    if (chart.kind === 'stacked') {
        if (!root || report.months.length < 2) {
            problems.push('Stacked bars of a net result or of one month');
        } else {
            if (chart.series.length > MAX_STACKED_PARTS) {
                problems.push(`${chart.series.length} stacked parts`);
            }
            if (chart.series.some(series => rowOf(series.id) === undefined)) {
                problems.push('A stacked part is not a top row');
            }
            if (cli.byMonth) {
                report.months.forEach((at, i) => {
                    for (const series of chart.series) {
                        const row = rowOf(series.id);
                        if (row) {
                            same(
                                `stacked ${series.name} ${at}`,
                                series.amounts[i],
                                cli.month(row.name, natureOf(snapshot, row), at)
                            );
                        }
                    }
                    same(
                        `stacked whole ${at}`,
                        sum(chart.series.map(series => series.amounts[i])).toFixed(),
                        cli.month(root.name, root, at)
                    );
                });
            }
        }
    }
    if (chart.kind === 'compare') {
        if (!cli.previous) {
            problems.push('A comparison without a previous period');
        }
        for (const id of chart.rows) {
            const row = rowOf(id);
            if (!row) {
                problems.push(`The comparison draws ${id}, not a row`);
            } else if (new Amount(row.amount).eq(0) && new Amount(row.previous ?? 0).eq(0)) {
                problems.push(`The comparison draws ${id}, a row without an amount`);
            }
        }
    }
    return problems;
}

/** CLI amounts by month of the report: activity in each month, or the position at its end. */
function cliSeries(
    report: ReportData,
    months: Map<string, Amount>,
    cumulative: boolean
): Map<string, Amount> {
    if (!cumulative) {
        return new Map(report.months.map(month => [month, months.get(month) ?? new Amount(0)]));
    }
    // The CLI lists positions only for months with movements; a position carries forward.
    const series = new Map<string, Amount>();
    let last: Amount | undefined;
    const known = [...months.keys()].sort();
    for (const month of report.months) {
        for (const key of known.filter(key => key <= month)) {
            last = months.get(key);
        }
        if (last !== undefined) {
            series.set(month, last);
        }
    }
    return series;
}

function countRows(rows: ReportRow[]): number {
    return rows.reduce((count, row) => count + 1 + countRows(row.children), 0);
}

async function verifyBook(
    bkper: Bkper,
    cli: Cli,
    bookId: string,
    now: () => Date,
    hashtags: string[],
    only: string[]
): Promise<void> {
    const timing = new ServerTiming();
    const snapshot = await loadSnapshot(bookId, {
        userId: await currentUserId(bkper, timing),
        bkper,
        kv: new MemoryStore(),
        timing,
        now,
    });
    const book = await bkper.getBook(bookId);
    const net = await expectedNet(cli, bookId, snapshot);
    const checked =
        only.length === 0
            ? snapshot.roots
            : snapshot.roots.filter(
                  id => only.includes(id) || only.includes(snapshot.groups[id].name)
              );
    if (checked.length === 0) {
        throw new Error(`No root group of the Book is ${only.join(' or ')}`);
    }
    const history = await bookHistory(cli, bookId, snapshot, checked);
    console.log(
        `Book "${snapshot.book.name}" today ${snapshot.today}, data ${history.range?.firstMonth}..${history.range?.lastMonth}, net result: ${net.kind}` +
            (checked === snapshot.roots
                ? ''
                : `; only ${checked.map(id => snapshot.groups[id].name).join(', ')}`)
    );
    const queryTimes: number[] = [];
    const computeTimes: number[] = [];
    let queryCount = 0;
    const reports: { label: string; report: ReportData }[] = [];
    // One at a time, so the times are of the calculation alone.
    for (const intent of intentsFor(snapshot, history, hashtags, checked)) {
        const target = intent.target === undefined ? undefined : nodeOf(snapshot, intent.target);
        const alongside = (intent.alongside ?? []).map(
            subject => nodeOf(snapshot, subject.target ?? subject.root)?.name ?? subject.root
        );
        const label =
            `${nodeOf(snapshot, intent.root)?.name ?? intent.root}` +
            (target ? ` › ${target.name}` : '') +
            alongside.map(name => ` | ${name}`).join('') +
            ` ${periodText(intent)}` +
            (intent.monthly ? ' monthly' : '') +
            (intent.chart ? ` ${intent.chart}` : '') +
            (intent.hashtags ? ` #${intent.hashtags.join(' #')}` : '');
        try {
            const { report, computeMs, queriesMs, queries } = await computeReport(
                intent,
                snapshot,
                book
            );
            computeTimes.push(computeMs);
            queryTimes.push(queriesMs);
            queryCount += queries;
            reports.push({ label, report });
        } catch (error) {
            // Bkper does not find some accounts of older Books by their name: a report of
            // one in no group fails rather than show zero, and the CLI finds nothing either.
            const ungrouped = subjectsOf(intent, snapshot)
                .filter(subject => subject.target === undefined)
                .map(subject => snapshot.ungrouped[subject.root])
                .filter(account => account !== undefined);
            if (error instanceof MissingBalancesError && ungrouped.length > 0) {
                const found = await Promise.all(
                    ungrouped.map(async account => {
                        const own = `account:${quote(account.name)} before:${addDays(snapshot.today, 1)}`;
                        return cliRows(await cli.balances(bookId, own), true).has(account.name);
                    })
                );
                check(
                    found.includes(false),
                    `${label}: no report, as Bkper does not find ${ungrouped.map(account => account.name).join(' or ')} by its name`
                );
                continue;
            }
            // A Book whose groups give no net result has none, and says so.
            if (
                error instanceof ReportError &&
                error.reason === 'no_net_result' &&
                intent.root === NET_RESULT_ROOT
            ) {
                check(net.kind === 'none', `${label}: no net result, as the Book's groups say`);
                continue;
            }
            // A group whose accounts with transactions hold balances and activity has no report.
            if (error instanceof ReportError && error.problem?.code === 'mixed_group') {
                check(
                    true,
                    `${label}: no report, as ${error.problem.group} mixes balances with activity`
                );
                continue;
            }
            check(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    reports.push(...(await defaultPeriodReports(snapshot, history, net, book, checked)));
    const mixed = mixedOf(snapshot);
    if (mixed) {
        let reason: string | undefined;
        try {
            planReport(mixed, snapshot);
        } catch (error) {
            reason = error instanceof ReportError ? error.reason : String(error);
        }
        check(
            reason === 'mixed_targets',
            `${nodeOf(snapshot, mixed.root)?.name} | ${nodeOf(snapshot, mixed.alongside?.[0].root ?? '')?.name}: positions and activity side by side are ${reason ?? 'a report'}`
        );
    }
    await Promise.all(
        reports.map(({ label, report }) => verifyReport(cli, bookId, snapshot, report, label, net))
    );
    const median = (values: number[]) =>
        values.length
            ? Math.round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)])
            : 0;
    const max = (values: number[]) => Math.round(Math.max(0, ...values) * 10) / 10;
    console.log(
        `  ${reports.length} reports; compute median ${median(computeTimes)} ms, max ${max(computeTimes)} ms; ` +
            `${queryCount} balances queries, each report's in parallel: median ${median(queryTimes)} ms, max ${Math.round(max(queryTimes))} ms`
    );
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const option = (name: string) =>
        args.filter(arg => arg.startsWith(`--${name}=`)).map(arg => arg.slice(name.length + 3));
    const [today] = option('today');
    fixedToday = today;
    const hashtags = option('hashtag');
    const only = option('root');
    const bookIds = args.filter(arg => !arg.startsWith('--'));
    if (bookIds.length === 0 || (today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(today))) {
        console.error(
            'Usage: npx tsx scripts/verify-report.ts [--today=YYYY-MM-DD] [--hashtag=<tag>] [--root=<id or name>] <bookId> [<bookId> ...]'
        );
        process.exit(2);
    }
    // Midday UTC is the same calendar day in every Book time zone within ±11 hours.
    const now = today ? () => new Date(`${today}T12:00:00Z`) : () => new Date();
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    const cli = new Cli();
    for (const bookId of bookIds) {
        await verifyBook(bkper, cli, bookId, now, hashtags, only);
    }
    console.log(
        failures === 0 ? `All ${checks} checks passed.` : `${failures} of ${checks} checks failed.`
    );
    process.exit(failures === 0 ? 0 : 1);
}

await main();
