/**
 * Report calculation: an intent, a Book snapshot (the Book's map) and the balances of the
 * report's own Bkper queries become the numbers of a report.
 *
 * {@link planReport} names the queries a report reads: for each of its roots, one of the
 * period, `group:'<root>' after:<start> before:<end> by:m`, and one of the previous period,
 * the same way. Their caller runs them, in parallel, and {@link buildReport} reads every amount
 * from their responses: totals from a group's or account's period balance (activity) or
 * cumulative balance (position), months from its monthly balances. Months are never added up
 * into totals.
 *
 * Every amount is a decimal string with the sign Bkper charts show (Outgoing and Liability
 * positive). Rows are expressed in their root's sense: a child whose credit nature differs
 * from the root's counts with the opposite sign, as in mixed groups, so every breakdown adds
 * up to its parent. When Bkper leaves accounts out of a group's balances, a remainder row
 * (`kind: 'other'`) keeps the breakdown adding up. A net result breaks down into its Incoming
 * and Outgoing sides, both positive as Bkper shows them, and Incoming minus Outgoing is the
 * net result. Rows without an amount in the period stay in the breakdown, last, but charts
 * leave them out.
 */
import { Amount } from 'bkper-js';
import { VIEW_KINDS, type ViewKind } from 'report-shared/catalog';
import {
    accountBalances,
    groupBalances,
    monthPeriod,
    monthPosition,
    type NodeBalances,
    type QueryBalances,
} from './balances.js';
import {
    addDays,
    isoMonth,
    previousPeriod,
    resolvePeriod,
    type DateRange,
    type IsoDate,
    type IsoMonth,
    type ReportNature,
} from './periods.js';
import {
    NET_RESULT_ROOT,
    type ChartPreference,
    type ReportIntent,
    type ReportView,
} from './report-intent.js';
import {
    quote,
    type NodeType,
    type Snapshot,
    type SnapshotGroup,
    type SnapshotNode,
} from './snapshot.js';

/** The colors Bkper gives each group and account type. */
export const TYPE_COLORS = {
    ASSET: 'blue',
    LIABILITY: 'yellow',
    INCOMING: 'green',
    OUTGOING: 'red',
    MIXED: 'grey',
} as const satisfies Record<NodeType, string>;

export type TypeColor = (typeof TYPE_COLORS)[NodeType];

/** An amount, the amount of the previous period, and the change between them as a ratio. */
export interface ReportAmounts {
    amount: string;
    /** Absent when there is nothing to compare with, as for all time. */
    previous?: string;
    /** `(amount - previous) / |previous|`, to 4 decimal places; absent when previous is absent or zero. */
    change?: string;
}

/**
 * A group, an account, the remainder Bkper left out of a group (`other`), or the Incoming or
 * Outgoing side of a net result.
 */
export type RowKind = 'group' | 'account' | 'other' | 'incoming' | 'outgoing';

export interface ReportRow extends ReportAmounts {
    /** Group or account id; `<groupId>:other` for a remainder; `incoming` or `outgoing`. */
    id: string;
    kind: RowKind;
    /** The Bkper name, verbatim; absent for rows the report names (`other`, `incoming`, `outgoing`). */
    name?: string;
    type: NodeType;
    color: TypeColor;
    /** Ratio of the parent's amount, to 4 decimal places; absent under a mixed or zero parent. */
    share?: string;
    /** Amount in each of the report's {@link ReportData.months}. */
    months: string[];
    /**
     * Sorted by size; a remainder comes next, then rows without an amount in the period, which
     * charts leave out. Rows without amounts in any period or month are left out.
     */
    children: ReportRow[];
}

export interface ChartSeries {
    /** The root, a side of a net result, the net result, or a breakdown row; `other` for the rest. */
    id: string;
    name?: string;
    type: NodeType;
    color: TypeColor;
    /** Drawn as a line over the bars, as the net result over its Incoming and Outgoing. */
    line?: true;
    /** Amount in each of the report's {@link ReportData.months}. */
    amounts: string[];
}

/** Every chart a report may have; `none` for no chart. */
export const CHART_KINDS = [
    'none',
    'bar',
    'line',
    'area',
    'stacked',
    'ranked-bar',
    'donut',
    'pie',
    'compare',
    'waterfall',
] as const satisfies readonly ReportChart['kind'][];

/** A part of a bridge: the change a breakdown row brings, or the rest of them (`other`). */
export interface WaterfallStep {
    /** The breakdown row's id, at any depth; `other` for the smaller parts together. */
    id: string;
    kind: RowKind;
    name?: string;
    type: NodeType;
    color: TypeColor;
    /** What the part adds to the bar before it: negative when it lowers it. */
    amount: string;
}

export type ReportChart = (
    | { kind: 'none' }
    /** By month: bars for activity, a line for positions, or areas. */
    | { kind: 'bar' | 'line' | 'area'; series: ChartSeries[] }
    /**
     * By month, a series for each of the largest breakdown rows and one for the rest (`other`),
     * stacked: in every month they add up to the root.
     */
    | { kind: 'stacked'; series: ChartSeries[] }
    /** The top breakdown rows with an amount, by id, in breakdown order. */
    | { kind: 'ranked-bar' | 'donut' | 'pie'; rows: string[] }
    /** The top breakdown rows with an amount in the period or the previous one, by id. */
    | { kind: 'compare'; rows: string[] }
    /**
     * A bridge from `start` to `end`, which `start` plus every step makes exactly: Incoming to
     * the net result through each Outgoing account, or the previous position to the position
     * through each part's change.
     */
    | { kind: 'waterfall'; start: string; steps: WaterfallStep[]; end: string }
) & {
    /** The intent preferred a chart that does not fit the report, so the rules chose this one. */
    fallback?: true;
};

export { VIEW_KINDS, type ViewKind };

/** Every reason a chart may not fit a report. */
export const UNFIT_REASON_CODES = [
    'net_result',
    'negative_part',
    'mixed_parts',
    'few_parts',
    'too_many_parts',
    'few_months',
    'no_amounts',
    'no_previous',
    'not_a_bridge',
    'no_change',
] as const satisfies readonly UnfitReason['code'][];

export const CHART_RULES = [
    'preference',
    'closest',
    'rules',
] as const satisfies readonly ChartRule[];

/** Why a chart does not fit a report, from its facts. */
export type UnfitReason =
    /** A pie or donut of a net result, or its sides stacked. */
    | { code: 'net_result' }
    /** A part below zero, in the root's sense, cannot be a slice. */
    | { code: 'negative_part'; rowId: string }
    /** Parts of another type than the root's, or under a mixed root, are no slices of one whole. */
    | { code: 'mixed_parts' }
    /** Fewer than two parts with an amount. */
    | { code: 'few_parts' }
    /** More parts than a donut shows. */
    | { code: 'too_many_parts' }
    /** Fewer months than the chart needs: two over time, one for a chart by month. */
    | { code: 'few_months' }
    /** Every value the chart would draw is zero. */
    | { code: 'no_amounts' }
    /** Nothing to compare with or bridge from, as for all time. */
    | { code: 'no_previous' }
    /** A bridge of activity other than the net result. */
    | { code: 'not_a_bridge' }
    /** A bridge whose every step is zero. */
    | { code: 'no_change' };

/** The facts of a report that decide which charts fit it. */
export interface ChartFacts {
    /** Top-level breakdown rows with an amount in the period. */
    rows: number;
    /** Of those, the ones below zero in the root's sense. */
    negative: number;
    /** Whether any of those is of another type than the root, or the root is mixed. */
    mixed: boolean;
    /** Months of the period. */
    months: number;
    /** Whether there is a previous period to compare with. */
    previous: boolean;
    /** A net result. */
    net: boolean;
    /** A position of a permanent root (Asset, Liability). */
    permanent: boolean;
}

/**
 * How the main chart was chosen: the intent's preference, which fits; the chart closest to a
 * preference that does not fit; or the rules, for `auto` or when nothing close fits.
 */
export type ChartRule = 'preference' | 'closest' | 'rules';

/** Every chart a report can show, and why its main one is the one shown. */
export interface ReportCharts {
    facts: ChartFacts;
    /** Every chart that fits, in {@link VIEW_KINDS} order, the main one among them; `none` is the table. */
    views: ReportChart[];
    main: ViewKind;
    rule: ChartRule;
    /** The preferred chart, when it does not fit, and why. */
    unfit?: { kind: ViewKind; reason: UnfitReason };
}

export interface ReportData {
    book: { id: string; name: string; timeZone?: string; fractionDigits?: number };
    intent: ReportIntent;
    /** Activity within a period (Incoming, Outgoing, net result), or a position at its end (Asset, Liability). */
    nature: ReportNature;
    /** The root group, or the net result (`net-result`, without a name). */
    root: { id: string; name?: string; type: NodeType; color: TypeColor };
    /**
     * The period read. A calendar period that has not ended reads to date, as its current
     * period (the current year as `this_year`). A position is measured at `before`.
     */
    period: { id: string; after?: IsoDate; before: IsoDate };
    /** The period compared with; a position compares with the position at its `before`. */
    previous?: DateRange;
    /** The root's amount; for a net result, Incoming minus Outgoing. */
    answer: ReportAmounts;
    /**
     * Both sides of a net result, each with the sign Bkper shows (Outgoing positive), and the
     * net result (Incoming minus Outgoing) in each of the {@link ReportData.months}. The
     * breakdown has the same two sides, as its `incoming` and `outgoing` rows.
     */
    net?: { incoming: ReportAmounts; outgoing: ReportAmounts; months: string[] };
    /** The months of the period, in order; the first and last may be partial. */
    months: IsoMonth[];
    /** The main chart: `fallback` when the intent preferred another, which does not fit. */
    chart: ReportChart;
    charts: ReportCharts;
    breakdown: ReportRow[];
    /** The Bkper query of exactly these transactions and dates. */
    query: string;
    /** The query in Bkper. */
    url: string;
    /** When the balances were read, as an ISO instant. */
    dataAt: string;
}

export type ReportErrorReason = 'unknown_root' | 'future_period' | 'no_activity_roots';

/** The intent asks for a report this Book cannot have. */
export class ReportError extends Error {
    constructor(
        readonly reason: ReportErrorReason,
        message: string
    ) {
        super(message);
        this.name = 'ReportError';
    }
}

const MAX_DONUT_ROWS = 6;

/** Series of stacked bars, the rest included, so the chart stays readable. */
const MAX_STACKED_SERIES = 6;

/** Steps of a bridge, the rest included. */
const MAX_WATERFALL_STEPS = 8;

/** The id of the part of a chart that holds the smaller parts together. */
export const OTHER_PART = 'other';

/** The balances queries of one root: of the report's period, and of the previous one. */
export interface RootQueries {
    root: string;
    current: string;
    previous?: string;
}

/** What a report reads: its nature, its period, and the queries that answer it. */
export interface ReportPlan {
    nature: ReportNature;
    period: ReportPeriod;
    /** The root group ids: the root, or every activity root of a net result. */
    roots: string[];
    hashtags: string[];
    /** One entry per root: never several roots in one query. */
    queries: RootQueries[];
}

/**
 * The balances queries a report reads, or a {@link ReportError} when the Book cannot have it.
 * Hashtags filter every query. A position with hashtags reads from the start of the data:
 * under `after:`, Bkper's cumulative balance starts from the balance of every movement, with
 * the hashtags or not.
 */
export function planReport(intent: ReportIntent, snapshot: Snapshot): ReportPlan {
    const net = intent.root === NET_RESULT_ROOT;
    const roots = reportRoots(intent.root, snapshot);
    const nature: ReportNature =
        !net && snapshot.groups[roots[0]].permanent ? 'position' : 'activity';
    const period = reportPeriod(intent.period, nature, snapshot.today);
    const hashtags = intent.hashtags ?? [];
    const current =
        nature === 'position' && hashtags.length > 0
            ? { before: period.range.before }
            : period.range;
    const queries = roots.map(root => {
        const filter = [`group:${quote(snapshot.groups[root].name)}`, ...tags(hashtags)].join(' ');
        return {
            root,
            current: balancesQuery(filter, current),
            ...(period.previous ? { previous: balancesQuery(filter, period.previous) } : {}),
        };
    });
    return { nature, period, roots, hashtags, queries };
}

/** Every query of a plan, each once, in order. */
export function planQueries(plan: ReportPlan): string[] {
    return [
        ...new Set(
            plan.queries.flatMap(({ current, previous }) => [current, previous ?? []].flat())
        ),
    ];
}

/** A query of a period by month: activity within it, positions at its end. */
function balancesQuery(filter: string, range: DateRange): string {
    const after = range.after === undefined ? '' : `after:${range.after} `;
    return `${filter} ${after}before:${range.before} by:m`;
}

function tags(hashtags: string[]): string[] {
    return hashtags.map(tag => `#${tag}`);
}

/**
 * Computes the report of an intent from the balances of its {@link planReport} queries, which
 * the caller has read; it throws when one is missing.
 */
export function buildReport(
    intent: ReportIntent,
    snapshot: Snapshot,
    balances: QueryBalances[]
): ReportData {
    const plan = planReport(intent, snapshot);
    const { nature, period, roots, hashtags } = plan;
    const byQuery = new Map(balances.map(entry => [entry.query, entry]));
    const read = (query: string): QueryBalances => {
        const entry = byQuery.get(query);
        if (!entry) {
            throw new Error(`The balances of a report query were not read: ${query}`);
        }
        return entry;
    };
    const sources = plan.queries.map(({ current, previous }) => ({
        current: read(current),
        ...(previous ? { previous: read(previous) } : {}),
    }));
    const months = reportMonths(period.range, snapshot);
    const measure = measurer(sources, nature, period, months);
    const net = intent.root === NET_RESULT_ROOT;
    const report = net
        ? netResultReport(snapshot, roots, measure)
        : rootReport(snapshot, snapshot.groups[roots[0]], measure);

    const { after, before } = period.range;
    const filter = [groupsFilter(snapshot, roots), ...tags(hashtags)].join(' ');
    const dates =
        nature === 'position' || after === undefined
            ? `before:${before}`
            : `after:${after} before:${before}`;
    const query = `${filter} ${dates}`;
    const view = intent.view ?? (intent.monthly ? 'trend' : undefined);
    const charts = reportCharts(intent.chart ?? 'auto', view, {
        nature,
        root: report.root,
        total: reportAmounts(report.total),
        net: report.net,
        rows: report.rows,
        series: report.series,
        months,
    });
    return {
        book: {
            id: snapshot.book.id,
            name: snapshot.book.name,
            timeZone: snapshot.book.timeZone,
            fractionDigits: snapshot.book.fractionDigits,
        },
        intent,
        nature,
        root: report.root,
        period: { id: period.id, ...period.range },
        ...(period.previous ? { previous: period.previous } : {}),
        answer: reportAmounts(report.total),
        ...(report.net ? { net: report.net } : {}),
        months,
        chart: charts.chart,
        charts: charts.charts,
        breakdown: report.rows,
        query,
        url: `https://bkper.app/books/${encodeURIComponent(snapshot.book.id)}/transactions?query=${encodeURIComponent(query)}`,
        // The oldest of the balances read: none is older than this.
        dataAt: sources
            .flatMap(source => [source.current, source.previous ?? []].flat())
            .map(entry => entry.dataAt)
            .sort()[0],
    };
}

/** A query filter for transactions in any of the groups, for the report's link to Bkper. */
function groupsFilter(snapshot: Snapshot, groupIds: string[]): string {
    const filters = groupIds.map(id => `group:${quote(snapshot.groups[id].name)}`);
    return filters.length === 1 ? filters[0] : `(${filters.join(' OR ')})`;
}

/** The root group ids a report reads: the root, or every activity root for a net result. */
function reportRoots(root: string, snapshot: Snapshot): string[] {
    if (root === NET_RESULT_ROOT) {
        const roots = snapshot.roots.filter(id => !snapshot.groups[id].permanent);
        if (roots.length === 0) {
            throw new ReportError(
                'no_activity_roots',
                'The Book has no Incoming or Outgoing root groups'
            );
        }
        return roots;
    }
    if (!snapshot.roots.includes(root)) {
        throw new ReportError('unknown_root', 'Not a root group of the Book');
    }
    return [root];
}

export interface ReportPeriod {
    id: string;
    range: DateRange;
    previous?: DateRange;
}

function reportPeriod(id: string, nature: ReportNature, today: IsoDate): ReportPeriod {
    const context = { today };
    const calendar = resolvePeriod(id, context);
    if (!calendar) {
        throw new Error(`Invalid period id: ${id}`);
    }
    if (calendar.after !== undefined && calendar.after > today) {
        throw new ReportError('future_period', 'The period has not started');
    }
    // Reports leave out future-dated transactions, like the current periods do.
    const effective = calendar.before > addDays(today, 1) ? currentPeriodOf(id) : id;
    const range = resolvePeriod(effective, context);
    if (!range || range.after !== calendar.after) {
        throw new Error(`No current period for ${id}`);
    }
    const previous = previousPeriod(effective, nature, context);
    return { id: effective, range, ...(previous ? { previous } : {}) };
}

/** The current period of a year `YYYY`, a quarter `YYYY-Qn` or a month `YYYY-MM` that contains today. */
function currentPeriodOf(id: string): string {
    if (id.includes('-Q')) {
        return 'this_quarter';
    }
    return id.length === 4 ? 'this_year' : 'this_month';
}

/** Months from the start of the range (or of the data) to its last day. */
function reportMonths(range: DateRange, snapshot: Snapshot): IsoMonth[] {
    const first = range.after?.slice(0, 7) ?? snapshot.dataRange?.firstMonth;
    const last = addDays(range.before, -1).slice(0, 7);
    const months: IsoMonth[] = [];
    for (let month = first; month !== undefined && month <= last; month = nextMonth(month)) {
        months.push(month);
    }
    return months;
}

function nextMonth(month: IsoMonth): IsoMonth {
    const [year, monthOfYear] = month.split('-').map(Number);
    return monthOfYear === 12 ? isoMonth(year + 1, 1) : isoMonth(year, monthOfYear + 1);
}

/** The amounts of a node in the period, the previous period and each month. */
interface Measure {
    amount: Amount;
    previous?: Amount;
    months: Amount[];
}

interface Measurer {
    of(node: SnapshotNode, sign: Sign): Measure;
    /** A measure of nothing, to sum onto. */
    zero(): Measure;
}

/** `1` when a node has its root's credit nature, `-1` when it counts against it. */
type Sign = 1 | -1;

/** The balances a report reads: for each root, of the period and of the previous one. */
interface BalancesSource {
    current: QueryBalances;
    previous?: QueryBalances;
}

/**
 * Measures nodes from the balances read. A node reads its own balances, as Bkper returns them;
 * one Bkper left out of every response has none. An account under several roots of a net
 * result reads the first root's, the same in each.
 */
function measurer(
    sources: BalancesSource[],
    nature: ReportNature,
    period: ReportPeriod,
    months: IsoMonth[]
): Measurer {
    const find = (
        node: SnapshotNode,
        pick: (source: BalancesSource) => QueryBalances | undefined
    ) => {
        for (const source of sources) {
            const balances = pick(source);
            const found =
                balances &&
                (isGroup(node)
                    ? groupBalances(balances, node.name)
                    : accountBalances(balances, node.name));
            if (found) {
                return found;
            }
        }
        return undefined;
    };
    const total = (balances: NodeBalances | undefined): Amount =>
        new Amount((nature === 'activity' ? balances?.period : balances?.cumulative) ?? 0);
    const month = (balances: NodeBalances | undefined, at: IsoMonth): Amount =>
        new Amount(nature === 'activity' ? monthPeriod(balances, at) : monthPosition(balances, at));
    const of = (node: SnapshotNode, sign: Sign): Measure => {
        const current = find(node, source => source.current);
        const measure: Measure = {
            amount: total(current),
            ...(period.previous ? { previous: total(find(node, source => source.previous)) } : {}),
            months: months.map(at => month(current, at)),
        };
        return sign === 1 ? measure : scale(measure, -1);
    };
    const zero = (): Measure => ({
        amount: new Amount(0),
        ...(period.previous ? { previous: new Amount(0) } : {}),
        months: months.map(() => new Amount(0)),
    });
    return { of, zero };
}

function isGroup(node: SnapshotNode): node is SnapshotGroup {
    return 'accounts' in node;
}

function signOf(node: SnapshotNode, rootCredit: boolean): Sign {
    return node.credit === rootCredit ? 1 : -1;
}

/** A breakdown row before its amounts become decimal strings. */
interface Line {
    id: string;
    kind: RowKind;
    name?: string;
    type: NodeType;
    measure: Measure;
    children: Line[];
}

interface ComputedReport {
    root: ReportData['root'];
    total: Measure;
    net?: ReportData['net'];
    rows: ReportRow[];
    series: ChartSeries[];
}

function rootReport(snapshot: Snapshot, root: SnapshotGroup, measure: Measurer): ComputedReport {
    const line = groupLine(snapshot, root, root.credit, measure);
    const color = TYPE_COLORS[root.type];
    return {
        root: { id: root.id, name: root.name, type: root.type, color },
        total: line.measure,
        rows: toRows(line.children, line),
        series: [
            {
                id: root.id,
                name: root.name,
                type: root.type,
                color,
                amounts: line.measure.months.map(decimal),
            },
        ],
    };
}

function groupLine(
    snapshot: Snapshot,
    group: SnapshotGroup,
    rootCredit: boolean,
    measure: Measurer
): Line {
    const own = measure.of(group, signOf(group, rootCredit));
    const children: Line[] = [
        ...group.groups.map(id => groupLine(snapshot, snapshot.groups[id], rootCredit, measure)),
        ...group.accounts.map(id => {
            const account = snapshot.accounts[id];
            return {
                id,
                kind: 'account' as const,
                name: account.name,
                type: account.type,
                measure: measure.of(account, signOf(account, rootCredit)),
                children: [],
            };
        }),
    ];
    const rest = sum([own, ...children.map(child => scale(child.measure, -1))], measure.zero());
    if (!isZero(rest)) {
        children.push({
            id: `${group.id}:other`,
            kind: 'other',
            type: group.type,
            measure: rest,
            children: [],
        });
    }
    return {
        id: group.id,
        kind: 'group',
        name: group.name,
        type: group.type,
        measure: own,
        children,
    };
}

/**
 * Incoming minus Outgoing over the accounts of every activity root. Roots may share accounts,
 * so each account counts once, and root totals are never added.
 */
function netResultReport(snapshot: Snapshot, roots: string[], measure: Measurer): ComputedReport {
    const accounts = new Set<string>();
    const collect = (group: SnapshotGroup): void => {
        group.accounts.forEach(id => accounts.add(id));
        group.groups.forEach(id => collect(snapshot.groups[id]));
    };
    roots.forEach(id => collect(snapshot.groups[id]));

    // Each side in its own sense, as Bkper shows it: Outgoing positive.
    const side = (kind: 'incoming' | 'outgoing'): Line => {
        const type = kind === 'incoming' ? 'INCOMING' : 'OUTGOING';
        const credit = kind === 'incoming';
        const children: Line[] = [...accounts]
            .map(id => snapshot.accounts[id])
            .filter(account => account.type === type)
            .map(account => ({
                id: account.id,
                kind: 'account',
                name: account.name,
                type,
                measure: measure.of(account, signOf(account, credit)),
                children: [],
            }));
        const total = sum(
            children.map(child => child.measure),
            measure.zero()
        );
        return { id: kind, kind, type, measure: total, children };
    };
    const incoming = side('incoming');
    const outgoing = side('outgoing');
    const total = sum([incoming.measure, scale(outgoing.measure, -1)], measure.zero());
    const netLine: Line = {
        id: NET_RESULT_ROOT,
        kind: 'group',
        type: 'MIXED',
        measure: total,
        children: [],
    };
    const series = (line: Line): ChartSeries => ({
        id: line.id,
        type: line.type,
        color: TYPE_COLORS[line.type],
        ...(line === netLine ? { line: true as const } : {}),
        amounts: line.measure.months.map(decimal),
    });
    return {
        root: { id: NET_RESULT_ROOT, type: 'MIXED', color: TYPE_COLORS.MIXED },
        total,
        net: {
            incoming: reportAmounts(incoming.measure),
            outgoing: reportAmounts(outgoing.measure),
            months: total.months.map(decimal),
        },
        rows: toRows([incoming, outgoing], netLine),
        series: [
            ...[incoming, outgoing].filter(line => !line.measure.amount.eq(0)).map(series),
            series(netLine),
        ],
    };
}

function toRows(lines: Line[], parent: Line): ReportRow[] {
    const shareable = parent.type !== 'MIXED' && !parent.measure.amount.eq(0);
    return lines
        .filter(line => !isZero(line.measure))
        .sort(byRank)
        .map(line => ({
            id: line.id,
            kind: line.kind,
            ...(line.name === undefined ? {} : { name: line.name }),
            type: line.type,
            color: TYPE_COLORS[line.type],
            ...reportAmounts(line.measure),
            ...(shareable ? { share: ratio(line.measure.amount, parent.measure.amount) } : {}),
            months: line.measure.months.map(decimal),
            children: toRows(line.children, line),
        }));
}

/** Largest first, by size whatever the sign; then a remainder; then rows without an amount. */
function byRank(a: Line, b: Line): number {
    const zero = Number(a.measure.amount.eq(0)) - Number(b.measure.amount.eq(0));
    const other = Number(a.kind === 'other') - Number(b.kind === 'other');
    return (
        zero ||
        other ||
        b.measure.amount.abs().cmp(a.measure.amount.abs()) ||
        (a.name ?? '').localeCompare(b.name ?? '')
    );
}

/** What a chart is drawn from. */
interface ChartInput {
    nature: ReportNature;
    root: ReportData['root'];
    total: ReportAmounts;
    net?: ReportData['net'];
    rows: ReportRow[];
    /** The series of a chart by month: the root, or the sides of a net result and the net result. */
    series: ChartSeries[];
    months: IsoMonth[];
}

/** The kind of a view: a chart's, or `table` for none. */
export function viewKindOf(chart: ReportChart): ViewKind {
    return chart.kind === 'none' ? 'table' : chart.kind;
}

/** A chart that fits the report, or why it does not. */
type Fit = { chart: ReportChart } | { reason: UnfitReason };

function isFit(fit: Fit | undefined): fit is { chart: ReportChart } {
    return fit !== undefined && 'chart' in fit;
}

/**
 * The fitting charts closest to each preference, in order, when it does not fit: the same
 * parts drawn another way, then the same months.
 */
const CLOSEST: Record<Exclude<ChartPreference, 'auto' | 'table'>, ViewKind[]> = {
    bar: ['line', 'area', 'ranked-bar', 'donut'],
    line: ['bar', 'area', 'ranked-bar', 'donut'],
    'ranked-bar': ['bar', 'line', 'donut'],
    donut: ['pie', 'ranked-bar'],
    pie: ['donut', 'ranked-bar'],
    stacked: ['bar', 'line', 'area', 'donut', 'ranked-bar'],
    area: ['bar', 'line', 'stacked', 'donut', 'ranked-bar'],
    compare: ['ranked-bar', 'donut'],
    waterfall: ['compare', 'ranked-bar', 'donut'],
};

/**
 * Every chart that fits the report, and the main one: the preference when it fits; else the
 * fitting chart closest to it; else, as for `auto`, the rules' chart.
 */
function reportCharts(
    preference: ChartPreference,
    view: ReportView | undefined,
    input: ChartInput
): { chart: ReportChart; charts: ReportCharts } {
    // Each nature has its own chart by month; the other one only when preferred.
    const fits = new Map(
        VIEW_KINDS.filter(kind => kind !== otherByMonth(input.nature) || kind === preference).map(
            kind => [kind, fitChart(kind, input)]
        )
    );
    const fitting = (kind: ViewKind): ReportChart | undefined => {
        const fit = fits.get(kind);
        return isFit(fit) ? fit.chart : undefined;
    };
    const views = VIEW_KINDS.flatMap(kind => fitting(kind) ?? []);
    const chosen = mainChoice(
        preference,
        fits,
        () => rulesKind(view, input, fits),
        input.months.length
    );
    const main = fitting(chosen.main);
    if (!main) {
        throw new Error(`The main chart does not fit: ${chosen.main}`);
    }
    return {
        chart: chosen.unfit ? { ...main, fallback: true } : main,
        charts: {
            facts: chartFacts(input),
            views,
            main: chosen.main,
            rule: chosen.rule,
            ...(chosen.unfit ? { unfit: chosen.unfit } : {}),
        },
    };
}

/** The main chart's kind, the rule that chose it, and the preference when it does not fit. */
function mainChoice(
    preference: ChartPreference,
    fits: ReadonlyMap<ViewKind, Fit>,
    byRules: () => ViewKind,
    months: number
): { main: ViewKind; rule: ChartRule; unfit?: ReportCharts['unfit'] } {
    if (preference === 'auto') {
        return { main: byRules(), rule: 'rules' };
    }
    const fit = fits.get(preference);
    if (!fit || isFit(fit)) {
        return { main: preference, rule: 'preference' };
    }
    const unfit = { kind: preference, reason: fit.reason };
    // A chart by month of one month shows nothing the parts do not.
    const closest =
        preference === 'table'
            ? undefined
            : CLOSEST[preference].find(
                  kind => isFit(fits.get(kind)) && (!isByMonth(kind) || months >= 2)
              );
    return closest
        ? { main: closest, rule: 'closest', unfit }
        : { main: byRules(), rule: 'rules', unfit };
}

/** The chart by month a report of the other nature has: a line for activity, bars for a position. */
function otherByMonth(nature: ReportNature): ViewKind {
    return nature === 'activity' ? 'line' : 'bar';
}

function isByMonth(kind: ViewKind): boolean {
    return kind === 'bar' || kind === 'line';
}

function chartFacts({ nature, root, net, rows, months, total }: ChartInput): ChartFacts {
    const drawn = rows.filter(hasAmount);
    return {
        rows: drawn.length,
        negative: drawn.filter(row => new Amount(row.amount).lt(0)).length,
        mixed: root.type === 'MIXED' || drawn.some(row => row.type !== root.type),
        months: months.length,
        previous: total.previous !== undefined,
        net: net !== undefined,
        permanent: nature === 'position',
    };
}

/**
 * The rules' chart: by month for a trend (bars for activity, a line for positions); else, for a
 * composition asked for, a donut of a few parts, a pie of more, else ranked bars; else, with no
 * view named, a donut of a few parts of one whole, else ranked bars; else the table.
 */
function rulesKind(
    view: ReportView | undefined,
    input: ChartInput,
    fits: ReadonlyMap<ViewKind, Fit>
): ViewKind {
    const { nature, series, months } = input;
    if (view === 'trend' && months.length > 0) {
        // A chart whose every value is zero shows nothing, as charts leave out empty rows.
        if (!hasValues(series)) {
            return 'table';
        }
        return nature === 'activity' ? 'bar' : 'line';
    }
    // Like Bkper charts: a donut or a pie only shows parts of one type that add up to a whole.
    const candidates: ViewKind[] =
        view === 'breakdown'
            ? ['donut', 'pie', 'ranked-bar']
            : view === undefined
              ? ['donut', 'ranked-bar']
              : [];
    return candidates.find(kind => isFit(fits.get(kind))) ?? 'table';
}

/** A chart of the report, or the reason it does not fit. */
function fitChart(kind: ViewKind, input: ChartInput): Fit {
    const { nature, root, total, net, rows, series, months } = input;
    const drawn = rows.filter(hasAmount);
    const ids = (parts: ReportRow[]) => parts.map(row => row.id);
    switch (kind) {
        case 'table':
            return { chart: { kind: 'none' } };
        case 'bar':
        case 'line':
            if (months.length === 0) {
                return { reason: { code: 'few_months' } };
            }
            return hasValues(series)
                ? { chart: { kind, series } }
                : { reason: { code: 'no_amounts' } };
        case 'area':
            if (months.length < 2) {
                return { reason: { code: 'few_months' } };
            }
            return hasValues(series)
                ? { chart: { kind: 'area', series } }
                : { reason: { code: 'no_amounts' } };
        case 'stacked':
            // The sides of a net result are each in their own sense, so they do not stack up to it.
            if (net) {
                return { reason: { code: 'net_result' } };
            }
            if (months.length < 2) {
                return { reason: { code: 'few_months' } };
            }
            return drawn.length >= 2
                ? { chart: { kind: 'stacked', series: stackedSeries(input) } }
                : { reason: { code: 'few_parts' } };
        case 'ranked-bar':
            return drawn.length >= 2
                ? { chart: { kind: 'ranked-bar', rows: ids(drawn) } }
                : { reason: { code: 'few_parts' } };
        case 'donut':
        case 'pie': {
            const reason = compositionReason(drawn, root.type, net !== undefined);
            if (reason) {
                return { reason };
            }
            if (kind === 'donut' && drawn.length > MAX_DONUT_ROWS) {
                return { reason: { code: 'too_many_parts' } };
            }
            return { chart: { kind, rows: ids(drawn) } };
        }
        case 'compare': {
            if (total.previous === undefined) {
                return { reason: { code: 'no_previous' } };
            }
            const compared = rows.filter(
                row => hasAmount(row) || !new Amount(row.previous ?? 0).eq(0)
            );
            return compared.length > 0
                ? { chart: { kind: 'compare', rows: ids(compared) } }
                : { reason: { code: 'no_amounts' } };
        }
        case 'waterfall': {
            let chart: ReportChart | undefined;
            if (net) {
                // Incoming, minus each Outgoing account, is the net result.
                const outgoing = rows.find(row => row.kind === 'outgoing')?.children ?? [];
                const steps = outgoing.map(row => ({
                    row,
                    amount: new Amount(row.amount).times(-1),
                }));
                chart = bridge(net.incoming.amount, steps, total.amount, 'OUTGOING');
            } else if (nature !== 'position') {
                return { reason: { code: 'not_a_bridge' } };
            } else if (total.previous === undefined) {
                return { reason: { code: 'no_previous' } };
            } else {
                // The previous position, plus each part's change, is the position.
                const steps = rows.map(row => ({
                    row,
                    amount: new Amount(row.amount).minus(row.previous ?? 0),
                }));
                chart = bridge(total.previous, steps, total.amount, root.type);
            }
            return chart ? { chart } : { reason: { code: 'no_change' } };
        }
    }
}

/** Why parts are no slices of one whole, or `undefined` when they are. */
function compositionReason(
    drawn: ReportRow[],
    rootType: NodeType,
    net: boolean
): UnfitReason | undefined {
    if (net) {
        return { code: 'net_result' };
    }
    if (drawn.length < 2) {
        return { code: 'few_parts' };
    }
    // Rows are sorted by size, so this is the largest part below zero.
    const negative = drawn.find(row => new Amount(row.amount).lt(0));
    if (negative) {
        return { code: 'negative_part', rowId: negative.id };
    }
    return isComposition(drawn, rootType) ? undefined : { code: 'mixed_parts' };
}

/** Parts of one type, each positive, that add up to a whole. */
function isComposition(rows: ReportRow[], rootType: NodeType): boolean {
    return (
        rootType !== 'MIXED' &&
        rows.every(row => row.type === rootType && new Amount(row.amount).gt(0))
    );
}

/** A series for each of the largest rows, and one for the rest, adding up to the root each month. */
function stackedSeries({ root, rows, months }: ChartInput): ChartSeries[] {
    const sumMonths = (parts: ReportRow[]) =>
        months.map((_, i) => parts.reduce((sum, row) => sum.plus(row.months[i]), new Amount(0)));
    const { top, rest } = largestParts(
        rows.filter(row => row.kind !== 'other' && hasAmount(row)),
        rows,
        MAX_STACKED_SERIES,
        parts => sumMonths(parts).every(month => month.eq(0))
    );
    const series: ChartSeries[] = top.map(row => ({
        id: row.id,
        ...(row.name === undefined ? {} : { name: row.name }),
        type: row.type,
        color: row.color,
        amounts: row.months,
    }));
    const other = sumMonths(rest);
    if (!other.every(month => month.eq(0))) {
        series.push({
            id: OTHER_PART,
            type: root.type,
            color: root.color,
            amounts: other.map(decimal),
        });
    }
    return series;
}

/**
 * A bridge from `start` to `end` through the largest steps and the rest together; `undefined`
 * when nothing changes. The steps of every row make `end` from `start` exactly.
 */
function bridge(
    start: string,
    steps: { row: ReportRow; amount: Amount }[],
    end: string,
    restType: NodeType
): ReportChart | undefined {
    const sumSteps = (parts: typeof steps) =>
        parts.reduce((sum, step) => sum.plus(step.amount), new Amount(0));
    if (!sumSteps(steps).plus(start).eq(end)) {
        throw new Error('The steps of the bridge do not add up to its end');
    }
    const { top, rest } = largestParts(
        steps
            .filter(step => step.row.kind !== 'other' && !step.amount.eq(0))
            .sort((a, b) => b.amount.abs().cmp(a.amount.abs())),
        steps,
        MAX_WATERFALL_STEPS,
        parts => sumSteps(parts).eq(0)
    );
    const bars: WaterfallStep[] = top.map(({ row, amount }) => ({
        id: row.id,
        kind: row.kind,
        ...(row.name === undefined ? {} : { name: row.name }),
        type: row.type,
        color: row.color,
        amount: decimal(amount),
    }));
    const other = sumSteps(rest);
    if (!other.eq(0)) {
        bars.push({
            id: OTHER_PART,
            kind: 'other',
            type: restType,
            color: TYPE_COLORS[restType],
            amount: decimal(other),
        });
    }
    return bars.length > 0 ? { kind: 'waterfall', start, steps: bars, end } : undefined;
}

/**
 * The largest candidates, in their order, each a part of its own, and every other item as the
 * rest: at most `max` parts, the rest counting as one unless it is zero.
 */
function largestParts<T>(
    candidates: T[],
    all: T[],
    max: number,
    isZeroRest: (rest: T[]) => boolean
): { top: T[]; rest: T[] } {
    const restOf = (top: T[]) => all.filter(item => !top.includes(item));
    const fits = candidates.length + (isZeroRest(restOf(candidates)) ? 0 : 1) <= max;
    const top = fits ? candidates : candidates.slice(0, max - 1);
    return { top, rest: restOf(top) };
}

function hasAmount(row: ReportRow): boolean {
    return !new Amount(row.amount).eq(0);
}

/** Whether any series of a chart by month has an amount in any month. */
function hasValues(series: ChartSeries[]): boolean {
    return series.some(entry => entry.amounts.some(amount => !new Amount(amount).eq(0)));
}

function reportAmounts(measure: Measure): ReportAmounts {
    const { amount, previous } = measure;
    if (!previous) {
        return { amount: decimal(amount) };
    }
    return {
        amount: decimal(amount),
        previous: decimal(previous),
        ...(previous.eq(0) ? {} : { change: ratio(amount.minus(previous), previous.abs()) }),
    };
}

function scale(measure: Measure, factor: Sign): Measure {
    return {
        amount: measure.amount.times(factor),
        ...(measure.previous ? { previous: measure.previous.times(factor) } : {}),
        months: measure.months.map(month => month.times(factor)),
    };
}

function sum(measures: Measure[], zero: Measure): Measure {
    return measures.reduce(
        (total, measure) => ({
            amount: total.amount.plus(measure.amount),
            ...(total.previous && measure.previous
                ? { previous: total.previous.plus(measure.previous) }
                : {}),
            months: total.months.map((month, i) => month.plus(measure.months[i])),
        }),
        zero
    );
}

function isZero(measure: Measure): boolean {
    return (
        measure.amount.eq(0) &&
        (measure.previous?.eq(0) ?? true) &&
        measure.months.every(month => month.eq(0))
    );
}

function ratio(numerator: Amount, denominator: Amount): string {
    return decimal(numerator.div(denominator).round(4));
}

/** Plain decimal notation; zero has no sign. */
function decimal(amount: Amount): string {
    return amount.eq(0) ? '0' : amount.toFixed();
}
