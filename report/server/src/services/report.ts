/**
 * Report calculation: an intent and a Book snapshot become the numbers of a report.
 *
 * Every amount is a decimal string computed here from Bkper balances, with the sign Bkper
 * charts show (Outgoing and Liability positive). Rows are expressed in their root's sense:
 * a child whose credit nature differs from the root's counts with the opposite sign, as in
 * mixed groups, so every breakdown adds up to its parent. When Bkper leaves accounts out of
 * a group's balances, a remainder row (`kind: 'other'`) keeps the breakdown adding up. A net
 * result breaks down into its Incoming and Outgoing sides, both positive as Bkper shows them,
 * and Incoming minus Outgoing is the net result. Rows without an amount in the period stay in
 * the breakdown, last, but charts leave them out.
 *
 * A report reads the snapshot, except when it filters by hashtags or the snapshot cannot
 * answer its period: then {@link buildReport} asks for one live balances query instead, and
 * computes the report once its result is passed back.
 */
import { Amount } from 'bkper-js';
import {
    groupsFilter,
    hashtagQuery,
    livePeriodAmount,
    livePositionAmount,
    rangeQuery,
    type LiveBalances,
    type LiveQuery,
} from './live-balances.js';
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
import { NET_RESULT_ROOT, type ChartPreference, type ReportIntent } from './report-intent.js';
import {
    periodAmount,
    positionAmount,
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
    chart: ReportChart;
    breakdown: ReportRow[];
    /** The Bkper query of exactly these transactions and dates. */
    query: string;
    /** The query in Bkper. */
    url: string;
    /** When the balances were read, as an ISO instant. */
    dataAt: string;
}

/** A report, or the one live balances query it needs first. */
export type ReportStep = { report: ReportData } | { liveQuery: LiveQuery };

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

/**
 * Computes the report of an intent from a snapshot, or returns the live query it needs.
 *
 * Pass the result of that query as `live` to compute the report. With hashtags, the live
 * query is {@link hashtagQuery}, which a caller may start as soon as it knows the hashtags.
 */
export function buildReport(
    intent: ReportIntent,
    snapshot: Snapshot,
    live?: LiveBalances
): ReportStep {
    const net = intent.root === NET_RESULT_ROOT;
    const roots = reportRoots(intent.root, snapshot);
    const nature: ReportNature =
        !net && snapshot.groups[roots[0]].permanent ? 'position' : 'activity';
    const period = reportPeriod(intent.period, nature, snapshot.today);
    const hashtags = intent.hashtags ?? [];
    if (live && !sameHashtags(live.hashtags, hashtags)) {
        throw new Error('The live balances were read for other hashtags');
    }
    if (hashtags.length > 0 && !live) {
        return { liveQuery: hashtagQuery(snapshot, hashtags) };
    }

    const amounts = new Amounts(snapshot, live, hashtags.length > 0);
    const months = reportMonths(period.range, snapshot);
    const measure = measurer(amounts, nature, period, months);
    const report = net
        ? netResultReport(snapshot, roots, measure)
        : rootReport(snapshot, snapshot.groups[roots[0]], measure);

    const { after, before } = period.range;
    if (amounts.missing) {
        if (live || nature === 'position' || after === undefined) {
            throw new Error('The balances read cannot answer this report');
        }
        return {
            liveQuery: rangeQuery(snapshot, roots, {
                after: period.previous?.after ?? after,
                before,
            }),
        };
    }

    const filter = [groupsFilter(snapshot, roots), ...hashtags.map(tag => `#${tag}`)].join(' ');
    const dates =
        nature === 'position' || after === undefined
            ? `before:${before}`
            : `after:${after} before:${before}`;
    const query = `${filter} ${dates}`;
    const view = intent.view ?? (intent.monthly ? 'trend' : 'breakdown');
    return {
        report: {
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
            chart: reportChart(intent.chart ?? 'auto', view, {
                nature,
                root: report.root,
                total: reportAmounts(report.total),
                net: report.net,
                rows: report.rows,
                series: report.series,
                months,
            }),
            breakdown: report.rows,
            query,
            url: `https://bkper.app/books/${encodeURIComponent(snapshot.book.id)}/transactions?query=${encodeURIComponent(query)}`,
            // Hashtag reports read only live balances; others may also read the snapshot's.
            dataAt: hashtags.length > 0 && live ? live.dataAt : snapshot.dataAt,
        },
    };
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

interface ReportPeriod {
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

/** Reads amounts from the live balances or the snapshot, noting what neither can answer. */
class Amounts {
    missing = false;

    constructor(
        private readonly snapshot: Snapshot,
        private readonly live: LiveBalances | undefined,
        /** Hashtag reports read only the live balances: the snapshot has no hashtags. */
        private readonly liveOnly: boolean
    ) {}

    period(node: SnapshotNode, range: DateRange): Amount {
        const snapshot = this.liveOnly ? undefined : periodAmount(node, range, this.snapshot);
        return this.found(snapshot ?? (this.live && livePeriodAmount(this.live, node, range)));
    }

    position(node: SnapshotNode, before: IsoDate): Amount {
        const snapshot = this.liveOnly ? undefined : positionAmount(node, before, this.snapshot);
        return this.found(snapshot ?? (this.live && livePositionAmount(this.live, node, before)));
    }

    private found(amount: Amount | undefined): Amount {
        if (!amount) {
            this.missing = true;
        }
        return amount ?? new Amount(0);
    }
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

function measurer(
    amounts: Amounts,
    nature: ReportNature,
    period: ReportPeriod,
    months: IsoMonth[]
): Measurer {
    const { range, previous } = period;
    const segments = months.map(month => ({
        after: maxDate(range.after, `${month}-01`),
        before: minDate(range.before, `${nextMonth(month)}-01`),
    }));
    const of = (node: SnapshotNode, sign: Sign): Measure => {
        const measure: Measure =
            nature === 'activity'
                ? {
                      amount: amounts.period(node, range),
                      ...(previous ? { previous: amounts.period(node, previous) } : {}),
                      months: segments.map(segment => amounts.period(node, segment)),
                  }
                : {
                      amount: amounts.position(node, range.before),
                      ...(previous ? { previous: amounts.position(node, previous.before) } : {}),
                      months: segments.map(segment => amounts.position(node, segment.before)),
                  };
        return sign === 1 ? measure : scale(measure, -1);
    };
    const zero = (): Measure => ({
        amount: new Amount(0),
        ...(previous ? { previous: new Amount(0) } : {}),
        months: months.map(() => new Amount(0)),
    });
    return { of, zero };
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

/** The chart the person prefers when it fits the report, else the chart of the rules. */
function reportChart(
    preference: ChartPreference,
    view: 'trend' | 'breakdown' | 'total',
    input: ChartInput
): ReportChart {
    const byRules = (): ReportChart => chooseChart(view, input);
    if (preference === 'auto') {
        return byRules();
    }
    return preferredChart(preference, input) ?? { ...byRules(), fallback: true };
}

function chooseChart(view: 'trend' | 'breakdown' | 'total', input: ChartInput): ReportChart {
    const { nature, root, rows, series, months } = input;
    if (view === 'trend' && months.length > 0) {
        // A chart whose every value is zero shows nothing, as charts leave out empty rows.
        return hasValues(series)
            ? { kind: nature === 'activity' ? 'bar' : 'line', series }
            : { kind: 'none' };
    }
    // Charts draw only rows with an amount in the period.
    const drawn = rows.filter(hasAmount);
    if (view === 'breakdown' && drawn.length >= 2) {
        // Like Bkper charts: a donut only shows parts of one type that add up to a whole.
        const donut = drawn.length <= MAX_DONUT_ROWS && isComposition(drawn, root.type);
        return { kind: donut ? 'donut' : 'ranked-bar', rows: drawn.map(row => row.id) };
    }
    return { kind: 'none' };
}

/** The preferred chart, or `undefined` when it does not fit the report. */
function preferredChart(
    preference: Exclude<ChartPreference, 'auto'>,
    input: ChartInput
): ReportChart | undefined {
    const { nature, root, total, net, rows, series, months } = input;
    switch (preference) {
        case 'table':
            return { kind: 'none' };
        case 'pie': {
            const drawn = rows.filter(hasAmount);
            return drawn.length >= 2 && isComposition(drawn, root.type)
                ? { kind: 'pie', rows: drawn.map(row => row.id) }
                : undefined;
        }
        case 'area':
            return months.length >= 2 && hasValues(series) ? { kind: 'area', series } : undefined;
        case 'stacked':
            // The sides of a net result are each in their own sense, so they do not stack up to it.
            return !net && months.length >= 2 && rows.filter(hasAmount).length >= 2
                ? { kind: 'stacked', series: stackedSeries(input) }
                : undefined;
        case 'compare': {
            const compared = rows.filter(
                row => hasAmount(row) || !new Amount(row.previous ?? 0).eq(0)
            );
            return total.previous !== undefined && compared.length > 0
                ? { kind: 'compare', rows: compared.map(row => row.id) }
                : undefined;
        }
        case 'waterfall': {
            if (net) {
                // Incoming, minus each Outgoing account, is the net result.
                const outgoing = rows.find(row => row.kind === 'outgoing')?.children ?? [];
                const steps = outgoing.map(row => ({
                    row,
                    amount: new Amount(row.amount).times(-1),
                }));
                return bridge(net.incoming.amount, steps, total.amount, 'OUTGOING');
            }
            if (nature === 'position' && total.previous !== undefined) {
                // The previous position, plus each part's change, is the position.
                const steps = rows.map(row => ({
                    row,
                    amount: new Amount(row.amount).minus(row.previous ?? 0),
                }));
                return bridge(total.previous, steps, total.amount, root.type);
            }
            return undefined;
        }
    }
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

function sameHashtags(a: string[], b: string[]): boolean {
    return [...a].sort().join(' ') === [...b].sort().join(' ');
}

function maxDate(a: IsoDate | undefined, b: IsoDate): IsoDate {
    return a !== undefined && a > b ? a : b;
}

function minDate(a: IsoDate, b: IsoDate): IsoDate {
    return a < b ? a : b;
}
