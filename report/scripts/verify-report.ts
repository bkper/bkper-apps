/**
 * Read-only cross-check of report calculations against the bkper CLI on live Books.
 *
 *     npx tsx scripts/verify-report.ts [--today=YYYY-MM-DD] [--hashtag=<tag>] <bookId> [<bookId> ...]
 *
 * For each Book it loads the snapshot (as of `--today`, when given, so Books with old data also
 * exercise current periods and today's activity), builds reports for several intents within the
 * Book's data range from the balances of each report's own queries (its period and the previous
 * one, per root, in parallel, as the Worker runs them), and compares every amount shown to the
 * cent with `bkper balance list` over the report's exact query and its previous period:
 *
 * - the answer, as Bkper's balance of the root; for a net result Report calculates, the
 *   Incoming roots minus the Outgoing roots of the CLI, in total, before and in every month;
 * - every row of the breakdown, at any depth, as Bkper's own balance of its group or account,
 *   now, before and in each month: no sign changed, no remainder; and that every group or
 *   account the CLI lists with an amount is a row, so nothing Bkper returns is hidden;
 * - where the net result comes from, against the Book's groups and accounts as the CLI lists
 *   them: the root group that combines Incoming and Outgoing, else simple activity roots that
 *   share no account (and the CLI table shows none twice), else none (`no_net_result`);
 * - every chart that fits each report, the main one and every other one a renderer may switch
 *   to: each month of a chart by month; the parts of a breakdown chart, exactly the rows with an
 *   amount, positive in a pie or donut and adding up to the root's CLI total; each stacked part
 *   in every month (at most six) and their sum against the root; each compared row; that no
 *   bridge is ever drawn and a bridge asked for is unfit (`no_bridge`); that the main chart is
 *   among them, and a preferred chart that does not fit is not, with its reason. Each line shows
 *   the preference, the main chart, the rule and the reason.
 *
 * The CLI shows raw balances (credit minus debit), negated for permanent accounts, so Liability
 * and Outgoing come out negative; reports show them as Bkper charts do, by credit nature. A CLI
 * amount is flipped when its row's `credit` equals its `permanent`. Uses your `bkper auth token`;
 * never writes to a Book.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { Amount, Bkper, type Book } from 'bkper-js';
import { readQueryBalances } from '../server/src/services/balances.ts';
import type { DateRange } from '../server/src/services/periods.ts';
import {
    ReportError,
    buildReport,
    planQueries,
    planReport,
    viewKindOf,
    type ReportChart,
    type ReportData,
    type ReportRow,
} from '../server/src/services/report.ts';
import {
    NET_RESULT_ROOT,
    REPORT_CHARTS,
    type ReportIntent,
} from '../server/src/services/report-intent.ts';
import type { Snapshot } from '../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../server/src/services/timing.ts';

const CLI_CONCURRENCY = 6;
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

/** A CLI amount in the sign reports show for the node. */
function shown(nature: Nature, cli: Amount): Amount {
    return nature.credit === nature.permanent ? cli.times(-1) : cli;
}

/** A row's nature: its group's or account's in the map, else that of its type. */
function natureOf(snapshot: Snapshot, row: { id: string; type: string }): Nature {
    const node = snapshot.groups[row.id] ?? snapshot.accounts[row.id];
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

function intentsFor(snapshot: Snapshot, hashtags: string[]): ReportIntent[] {
    const range = snapshot.dataRange;
    if (!range) {
        return [];
    }
    const firstYear = range.firstMonth.slice(0, 4);
    const lastYear = range.lastMonth.slice(0, 4);
    const quarter = `${lastYear}-Q${Math.ceil(Number(range.lastMonth.slice(5)) / 3)}`;
    const roots = [...snapshot.roots, NET_RESULT_ROOT];
    const charts = REPORT_CHARTS.filter(chart => chart !== 'auto');
    const intents: ReportIntent[] = roots.flatMap(root => [
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
    for (const hashtag of hashtags) {
        for (const root of roots) {
            intents.push({ root, period: 'all', monthly: false, hashtags: [hashtag] });
            intents.push({ root, period: lastYear, monthly: true, hashtags: [hashtag] });
        }
    }
    return intents;
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
        // Bkper leaves archived accounts at zero out of balances, so the map does too.
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
            return readQueryBalances(query, await book.getBalancesReport(query), asked);
        })
    );
    const queriesMs = performance.now() - start;
    start = performance.now();
    const report = buildReport(intent, snapshot, balances);
    return { report, computeMs: performance.now() - start, queriesMs, queries: queries.length };
}

function withDates(report: ReportData, range: DateRange): string {
    const filter = report.query.replace(/ (after:\S+ )?before:\S+$/, '');
    return report.nature === 'position' || range.after === undefined
        ? `${filter} before:${range.before}`
        : `${filter} after:${range.after} before:${range.before}`;
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
    const read = async (query: string) =>
        cliRows(await cli.balances(bookId, query), !query.includes('after:'));
    const cumulative = !report.query.includes('after:');
    const [current, previous] = await Promise.all([
        read(report.query),
        report.previous ? read(withDates(report, report.previous)) : Promise.resolve(undefined),
    ]);
    const problems: string[] = [];
    const same = (what: string, actual: string | undefined, expected: Amount) => {
        if (actual === undefined || !new Amount(actual).eq(expected)) {
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
        total,
        month,
        same,
    };

    problems.push(...netProblems(report, net));
    if (report.calculated) {
        problems.push(...calculatedProblems(report, cliCheck));
    } else {
        const root = snapshot.groups[report.root.id];
        same('answer', report.answer.amount, total(current, root.name, root));
        if (previous) {
            same('previous', report.answer.previous, total(previous, root.name, root));
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

/** Whether a net result comes from where the Book's groups and accounts say it must. */
function netProblems(report: ReportData, net: ExpectedNet): string[] {
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
function calculatedProblems(report: ReportData, cli: CliCheck): string[] {
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
function rowProblems(report: ReportData, cli: CliCheck): string[] {
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
        : [snapshot.groups[report.root.id].name];
    for (const table of [current, previous]) {
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
 * preferred chart that does not fit is left out of them, with the main chart marked `fallback`;
 * and a bridge is never drawn.
 */
function choiceProblems(report: ReportData): string[] {
    const problems: string[] = [];
    const { charts, chart } = report;
    const kinds = charts.views.map(viewKindOf);
    if (new Set(kinds).size !== kinds.length) {
        problems.push(`Repeated views: ${kinds.join(', ')}`);
    }
    if (kinds.includes('waterfall')) {
        problems.push('A bridge is among the views');
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
    const preferred = report.intent.chart;
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
function chartProblems(report: ReportData, chart: ReportChart, cli: CliCheck): string[] {
    const problems: string[] = [];
    const { snapshot, current, total, same } = cli;
    const root = report.calculated ? undefined : snapshot.groups[report.root.id];
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
            const node = snapshot.groups[series.id];
            if (!node) {
                problems.push(`${series.id}: a series of no root group`);
            } else if (cli.byMonth) {
                report.months.forEach((at, i) =>
                    same(`${series.name} ${at}`, series.amounts[i], cli.month(node.name, node, at))
                );
            }
        }
    }
    if (chart.kind === 'ranked-bar' || chart.kind === 'donut' || chart.kind === 'pie') {
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
    hashtags: string[]
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
    console.log(
        `Book "${snapshot.book.name}" today ${snapshot.today}, data ${snapshot.dataRange?.firstMonth}..${snapshot.dataRange?.lastMonth}, net result: ${net.kind}`
    );
    const queryTimes: number[] = [];
    const computeTimes: number[] = [];
    let queryCount = 0;
    const reports: { label: string; report: ReportData }[] = [];
    // One at a time, so the times are of the calculation alone.
    for (const intent of intentsFor(snapshot, hashtags)) {
        const label =
            `${snapshot.groups[intent.root]?.name ?? intent.root} ${intent.period}` +
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
            // A Book whose groups give no net result has none, and says so.
            if (
                error instanceof ReportError &&
                error.reason === 'no_net_result' &&
                intent.root === NET_RESULT_ROOT
            ) {
                check(net.kind === 'none', `${label}: no net result, as the Book's groups say`);
                continue;
            }
            check(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
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
    const hashtags = option('hashtag');
    const bookIds = args.filter(arg => !arg.startsWith('--'));
    if (bookIds.length === 0 || (today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(today))) {
        console.error(
            'Usage: npx tsx scripts/verify-report.ts [--today=YYYY-MM-DD] [--hashtag=<tag>] <bookId> [<bookId> ...]'
        );
        process.exit(2);
    }
    // Midday UTC is the same calendar day in every Book time zone within ±11 hours.
    const now = today ? () => new Date(`${today}T12:00:00Z`) : () => new Date();
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    const cli = new Cli();
    for (const bookId of bookIds) {
        await verifyBook(bkper, cli, bookId, now, hashtags);
    }
    console.log(
        failures === 0 ? `All ${checks} checks passed.` : `${failures} of ${checks} checks failed.`
    );
    process.exit(failures === 0 ? 0 : 1);
}

await main();
