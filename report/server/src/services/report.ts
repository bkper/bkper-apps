/**
 * Report calculation: an intent, a Book snapshot (the Book's map) and the balances of the
 * report's own Bkper queries become the numbers of a report.
 *
 * {@link planReport} names the queries a report reads: for each group it reads from, one of the
 * period, `group:'<group>' <dates>`, and one of the period it is compared with, the same way,
 * their dates written by the period query builder (`period-query.ts`) and ending with `by:m`,
 * so the query read is the query shown and opened in Bkper, and Bkper resolves its dates.
 * Their caller runs them, in parallel, and {@link buildReport} reads every amount from their
 * responses: totals from a group's or account's period balance (activity) or cumulative balance
 * (position), months from its monthly balances. Months are never added up into totals. A group, a root or a target under one, is read from its own queries; an account
 * under a root from the queries of the smallest group holding it ({@link sourceOf}), never with
 * `account:'<name>'`, which Bkper does not find for some names; an account in no group is a
 * root of its own, read with `account:'<name>' …`. Several targets show side by side, each
 * with its own amount, read from the queries of their groups, one per group: never added up,
 * with no total and no shares.
 *
 * Every amount is a Bkper balance of one group or account, as Bkper returns it, with the sign
 * Bkper shows (Outgoing and Liability positive): no sign is changed and nothing is added up
 * across groups or accounts. The breakdown holds only the rows Bkper returns, so a mixed group's
 * rows need not add up to it. The one exception is {@link calculatedNetResult}.
 */
import { Amount } from 'bkper-js';
import { VIEW_KINDS, type ViewKind } from 'report-shared/catalog';
import {
    bookProblem,
    mixedGroupProblem,
    noNetResultProblem,
    type BookProblem,
} from './book-problems.js';
import {
    accountBalances,
    groupBalances,
    monthPeriod,
    monthPosition,
    type GroupNodeBalances,
    type NodeBalances,
    type QueryBalances,
} from './balances.js';
import { readDays, type ReadDays } from './bkper-dates.js';
import {
    buildPeriodQuery,
    resolveQueryDates,
    type ComparisonError,
    type PeriodDates,
    type PeriodSpan,
} from './period-query.js';
import {
    isoMonth,
    isPlausibleYear,
    type IsoDate,
    type IsoMonth,
    type ReportNature,
} from './periods.js';
import {
    NET_RESULT_ROOT,
    type ChartPreference,
    type ReportIntent,
    type ReportSubjectData,
    type ReportView,
} from './report-intent.js';
import {
    quote,
    type NodeType,
    type Snapshot,
    type SnapshotGroup,
    type UngroupedAccount,
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

/** A group or an account, as Bkper returns it. */
export type RowKind = 'group' | 'account';

export interface ReportRow extends ReportAmounts {
    /**
     * Group or account id; `group:<name>` or `account:<name>` for one Bkper returns that the
     * Book's map lacks, such as an account archived at zero.
     */
    id: string;
    kind: RowKind;
    /** The Bkper name, verbatim. */
    name: string;
    type: NodeType;
    color: TypeColor;
    /** Ratio of the parent's amount, to 4 decimal places; absent under a mixed or zero parent. */
    share?: string;
    /** Amount in each of the report's {@link ReportData.months}. */
    months: string[];
    /**
     * The rows Bkper returns under it, sorted by size, then rows without an amount in the
     * period, which charts leave out. Rows without amounts in any period or month are left out.
     */
    children: ReportRow[];
}

export interface ChartSeries {
    /** The root, a breakdown row, or a net result Report calculates (`net-result`). */
    id: string;
    name?: string;
    type: NodeType;
    color: TypeColor;
    /** Drawn as a line over the bars, as the net result over its Incoming and Outgoing. */
    line?: true;
    /** Amount in each of the report's {@link ReportData.months}. */
    amounts: string[];
}

/**
 * Every chart kind of the API's contract; `none` for no chart. Reports no longer draw a
 * `waterfall`, which stays in the contract for the clients that know it.
 */
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
] as const satisfies readonly (ReportChart['kind'] | 'waterfall')[];

export type ReportChart = (
    | { kind: 'none' }
    /** By month: bars for activity, a line for positions, or areas. */
    | { kind: 'bar' | 'line' | 'area'; series: ChartSeries[] }
    /** By month, a series for each top breakdown row, stacked: in every month they make the root. */
    | { kind: 'stacked'; series: ChartSeries[] }
    /** The top breakdown rows with an amount, by id, in breakdown order. */
    | { kind: 'ranked-bar' | 'donut' | 'pie'; rows: string[] }
    /** The top breakdown rows with an amount in the period or the previous one, by id. */
    | { kind: 'compare'; rows: string[] }
) & {
    /** The intent preferred a chart that does not fit the report, so the rules chose this one. */
    fallback?: true;
};

export { VIEW_KINDS, type ViewKind };

/**
 * Every reason code of the API's contract. Since reports draw no bridge, `not_a_bridge` and
 * `no_change` are no longer given; they stay in the contract for the clients that know them.
 */
export const UNFIT_REASON_CODES = [
    'net_result',
    'negative_part',
    'mixed_parts',
    'few_parts',
    'too_many_parts',
    'few_months',
    'no_amounts',
    'no_previous',
    'not_a_whole',
    'no_bridge',
    'side_by_side',
    'not_a_bridge',
    'no_change',
] as const satisfies readonly (UnfitReason['code'] | 'not_a_bridge' | 'no_change')[];

export const CHART_RULES = [
    'preference',
    'closest',
    'rules',
] as const satisfies readonly ChartRule[];

/** Why a chart does not fit a report, from its facts. */
export type UnfitReason =
    /** A pie or donut of a net result, or its parts stacked. */
    | { code: 'net_result' }
    /** A part below zero cannot be a slice. */
    | { code: 'negative_part'; rowId: string }
    /** Parts of another type than the root's, or under a mixed root, are no slices of one whole. */
    | { code: 'mixed_parts' }
    /** Fewer than two parts with an amount. */
    | { code: 'few_parts' }
    /** More parts than a donut shows, or than stacked bars draw. */
    | { code: 'too_many_parts' }
    /** Fewer months than the chart needs: two over time, one for a chart by month. */
    | { code: 'few_months' }
    /** Every value the chart would draw is zero. */
    | { code: 'no_amounts' }
    /** Nothing to compare with, as for all time. */
    | { code: 'no_previous' }
    /** The parts Bkper returns do not make the root's amount, so they are no slices of it. */
    | { code: 'not_a_whole' }
    /** A bridge would show amounts that are no Bkper balances: reports draw none. */
    | { code: 'no_bridge' }
    /** Targets side by side are no parts of one whole: no slices, and nothing stacked. */
    | { code: 'side_by_side' };

/** The facts of a report that decide which charts fit it. */
export interface ChartFacts {
    /** Top-level breakdown rows with an amount in the period. */
    rows: number;
    /** Of those, the ones below zero, as Bkper shows them. */
    negative: number;
    /** Whether any of those is of another type than the root, or the root is mixed. */
    mixed: boolean;
    /** Months of the period. */
    months: number;
    /** Whether there is a previous period to compare with. */
    previous: boolean;
    /** A net result: of a group that combines Incoming and Outgoing, or calculated. */
    net: boolean;
    /** A position of a permanent root (Asset, Liability). */
    permanent: boolean;
    /** Targets side by side, which the rows are: no parts of one whole. */
    sideBySide?: true;
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

/** What a report is of, by id, name and type. */
export interface ReportRoot {
    id: string;
    name?: string;
    type: NodeType;
    color: TypeColor;
}

/**
 * What a report is of: one group or account, with its amount; or several side by side, each
 * with its own amount and none for them together.
 */
export type ReportData = ReportBase &
    (
        | {
              /**
               * The root group, the intent's target under it, an account in no group, the
               * group that combines Incoming and Outgoing for a net result, or a net result
               * Report calculates (`net-result`, without a name).
               */
              root: ReportRoot;
              /** The root's amount, as Bkper returns it; for a net result Report calculates, that net result. */
              answer: ReportAmounts;
              /** The report is of an account, which has no parts: its breakdown is empty. */
              account?: true;
              targets?: never;
          }
        | {
              root?: never;
              answer?: never;
              account?: never;
              /**
               * The targets side by side, in the order asked for, each a row with its own Bkper
               * balance and the rows Bkper lists under it; they are also the breakdown. Never
               * added up: no total, and no share of one.
               */
              targets: ReportRow[];
          }
    );

export interface ReportBase {
    book: { id: string; name: string; timeZone?: string; fractionDigits?: number };
    intent: ReportIntent;
    /** Activity within a period (Incoming, Outgoing, net result), or a position at its end (Asset, Liability). */
    nature: ReportNature;
    /**
     * The period read: whole months, through the end of the current month when it is running.
     * `dates` is the date part of its queries, and `after` and `before` the days Bkper says its
     * answer read (see {@link readDays}): all time and a position have no `after`, and a
     * position is measured at `before`, the end of its last month, or tomorrow when running.
     */
    period: ReadDays & { dates: string; kind: PeriodSpan };
    /** The period compared with, the same way; a position compares with the position at its `before`. */
    previous?: ReadDays & { dates: string; kind: PeriodSpan };
    /**
     * Why the comparison the intent asks for cannot be made: the report then compares with the
     * previous period instead (all time with nothing), and says so.
     */
    comparisonError?: ComparisonError;
    /**
     * A net result Report calculates, as no group of the Book combines Incoming and Outgoing
     * ({@link calculatedNetResult}): its amount in each of the {@link ReportData.months}. Its
     * breakdown is its roots, Incoming first.
     */
    calculated?: { months: string[] };
    /** The months of the period, in order. */
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

export type ReportErrorReason =
    | 'unknown_root'
    /** The intent's target is no group or account under its root group. */
    | 'unknown_target'
    /** Targets side by side are of both kinds: positions and activity. */
    | 'mixed_targets'
    | 'future_period'
    | 'no_activity_roots'
    /** No group combines Incoming and Outgoing, and the activity roots are not simple. */
    | 'no_net_result'
    /** No account has transactions posted. */
    | 'empty_book'
    /** No root groups, or most accounts with transactions posted are in no group. */
    | 'nothing_to_report'
    /** The group read holds balances and activity. */
    | 'mixed_group';

/**
 * The intent asks for a report this Book cannot have; with the Book's problem (see
 * `book-problems.ts`) when organizing its groups would let it have the report.
 */
export class ReportError extends Error {
    constructor(
        readonly reason: ReportErrorReason,
        message: string,
        readonly problem?: BookProblem
    ) {
        super(message);
        this.name = 'ReportError';
    }
}

/** The error of a Book's problem: the problem's code is its reason. */
export function bookProblemError(problem: BookProblem): ReportError {
    const messages: Record<BookProblem['code'], string> = {
        empty_book: 'No account of the Book has transactions posted',
        nothing_to_report: 'The Book has no groups to report on',
        no_net_result: 'No group of the Book combines Incoming and Outgoing',
        mixed_group: 'The group holds balances and activity',
    };
    return new ReportError(problem.code, messages[problem.code], problem);
}

/** Rejects a report of a Book that has none: empty, or with nothing to report on. */
export function assertReportable(snapshot: Snapshot): void {
    const problem = bookProblem(snapshot);
    if (problem) {
        throw bookProblemError(problem);
    }
}

/**
 * Bkper's answer lacks what it must hold, so the report would show a wrong amount: Bkper answers
 * a query of an account it does not find by its name with no balances at all, as it does for
 * some accounts of older Books.
 */
export class MissingBalancesError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MissingBalancesError';
    }
}

const MAX_DONUT_ROWS = 6;

/** Parts of stacked bars, each drawn, so the chart stays readable. */
const MAX_STACKED_PARTS = 6;

/**
 * The balances queries of one group, or account in no group, a report reads from: of the
 * report's period, and of the previous one.
 */
export interface SourceQueries {
    source: string;
    current: string;
    previous?: string;
}

/** A group or an account of the Book, as a report reads it. */
export interface ReportNode {
    id: string;
    kind: RowKind;
    name: string;
    type: NodeType;
    /** Position to a date (Asset, Liability) rather than activity in a period. */
    permanent: boolean;
}

/** A net result Report calculates: its Incoming and its Outgoing roots. */
export interface CalculatedRoots {
    incoming: string[];
    outgoing: string[];
}

/** A group or account a report is of, and the group or account whose responses it is read from. */
export interface SideBySideTarget {
    node: ReportNode;
    source: string;
}

/**
 * The groups (or accounts in no group) a report reads from, by id, each once: the node's own
 * ({@link sourceOf}), each root of a net result Report calculates, or those of targets side by
 * side; and what the report is of: a node (a root, the intent's target under it, an account in
 * no group, or the group that combines Incoming and Outgoing for a net result), a net result
 * Report calculates, or several targets side by side.
 */
export type ReportSubject = { sources: string[] } & (
    | { node: ReportNode; calculated?: never; targets?: never }
    | { node?: never; calculated: CalculatedRoots; targets?: never }
    | { node?: never; calculated?: never; targets: SideBySideTarget[] }
);

/** What a report reads: its nature, its period, and the queries that answer it. */
export type ReportPlan = ReportSubject & {
    nature: ReportNature;
    period: ReportPeriod;
    hashtags: string[];
    /** One entry per group read from: never several groups in one query. */
    queries: SourceQueries[];
};

/**
 * The balances queries a report reads, or a {@link ReportError} when the Book cannot have it.
 * Hashtags filter every query. A position reads from the start of the data, never with
 * `after:`: under `after:`, Bkper's cumulative balance with hashtags starts from the balance of
 * every movement, with the hashtags or not.
 */
export function planReport(intent: ReportIntent, snapshot: Snapshot): ReportPlan {
    const subject = reportSubject(intent, snapshot);
    rejectMixedGroups(subject, snapshot);
    const nature: ReportNature = (subject.node ?? subject.targets?.[0].node)?.permanent
        ? 'position'
        : 'activity';
    const period = reportPeriod(intent, nature, snapshot.today);
    const hashtags = intent.hashtags ?? [];
    const queries = subject.sources.map(source => {
        const filter = [nodeFilter(sourceNode(snapshot, source)), ...tags(hashtags)].join(' ');
        return {
            source,
            current: `${filter} ${period.read.dates}`,
            ...(period.comparison ? { previous: `${filter} ${period.comparison.dates}` } : {}),
        };
    });
    return { ...subject, nature, period, hashtags, queries };
}

/** The query filter of a group's or an account's transactions. */
function nodeFilter(node: Pick<ReportNode, 'kind' | 'name'>): string {
    return `${node.kind}:${quote(node.name)}`;
}

/** Every query of a plan, each once, in order. */
export function planQueries(plan: ReportPlan): string[] {
    return [
        ...new Set(
            plan.queries.flatMap(({ current, previous }) => [current, previous ?? []].flat())
        ),
    ];
}

/**
 * The one query of a report's history: the group its first subject is read from, over its whole
 * history by month, through the current month (all time's activity), with the report's
 * hashtags, where it finds the last month it had movements. A target is read from that group's
 * answer, as the report reads it; never several groups in one query, as unbounded multi-group
 * queries are slow and can fail.
 */
export function historyQuery(plan: ReportPlan, snapshot: Snapshot): string {
    const [{ source }] = planSubjects(plan, snapshot);
    const history = buildPeriodQuery(
        { period: { span: 'all_time' } },
        { today: snapshot.today, nature: 'activity' }
    );
    if (!history.ok) {
        throw new Error(`No history: ${history.reason}`);
    }
    return [
        nodeFilter(sourceNode(snapshot, source)),
        ...tags(plan.hashtags),
        history.period.dates,
    ].join(' ');
}

/**
 * The groups and accounts a report is of, each with the group whose answers hold it: its node,
 * its targets side by side, or the roots of a net result Report calculates.
 */
export function planSubjects(plan: ReportPlan, snapshot: Snapshot): SideBySideTarget[] {
    if (plan.targets) {
        return plan.targets;
    }
    if (plan.node) {
        return [{ node: plan.node, source: plan.sources[0] }];
    }
    return plan.sources.map(source => ({ node: sourceNode(snapshot, source), source }));
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
    const { nature, period, hashtags } = plan;
    const byQuery = new Map(balances.map(entry => [entry.query, entry]));
    const read = (query: string): QueryBalances => {
        const entry = byQuery.get(query);
        if (!entry) {
            throw new Error(`The balances of a report query were not read: ${query}`);
        }
        return entry;
    };
    const sources = new Map(
        plan.queries.map(({ source, current, previous }) => [
            source,
            { current: read(current), ...(previous ? { previous: read(previous) } : {}) },
        ])
    );
    assertAccountsRead(snapshot, plan, sources);
    const months = reportMonths(period.read, [...sources.values()]);
    const reader = new RowReader(snapshot, nature, period, months);
    const view = intent.view ?? (intent.monthly ? 'trend' : undefined);
    // Every query of a period has the same dates, so the first source's answers say what each read.
    const [answers] = sources.values();
    const days = (dates: PeriodDates, answer: QueryBalances | undefined) => ({
        ...readDaysOf(dates, answer, snapshot),
        dates: dates.dates,
        kind: dates.kind,
    });
    const base = (filter: string): Omit<ReportBase, 'chart' | 'charts' | 'breakdown'> => {
        // The dates of the queries read, so the link shows exactly what was read.
        const query = `${[filter, ...tags(hashtags)].join(' ')} ${period.read.dates}`;
        return {
            book: {
                id: snapshot.book.id,
                name: snapshot.book.name,
                timeZone: snapshot.book.timeZone,
                fractionDigits: snapshot.book.fractionDigits,
            },
            intent,
            nature,
            period: days(period.read, answers?.current),
            ...(period.comparison ? { previous: days(period.comparison, answers?.previous) } : {}),
            ...(period.comparisonError ? { comparisonError: period.comparisonError } : {}),
            months,
            query,
            url: `https://bkper.app/books/${encodeURIComponent(snapshot.book.id)}/transactions?query=${encodeURIComponent(query)}`,
            // The oldest of the balances read: none is older than this.
            dataAt: [...sources.values()]
                .flatMap(source => [source.current, source.previous ?? []].flat())
                .map(entry => entry.dataAt)
                .sort()[0],
        };
    };

    if (plan.targets) {
        const lines = plan.targets.map(({ node, source }) =>
            nodeLine(node, balancesOf(sources, source), reader)
        );
        const targets = lines.map(line => toRow(line, undefined));
        const types = new Set(lines.map(line => line.type));
        const charts = reportCharts(intent.chart ?? 'auto', view, {
            nature,
            type: types.size === 1 ? lines[0].type : 'MIXED',
            previous: period.comparison !== undefined,
            net: false,
            sideBySide: true,
            rows: targets,
            series: lines.map(lineSeries),
            months,
        });
        return {
            ...base(`(${plan.targets.map(({ node }) => nodeFilter(node)).join(' OR ')})`),
            targets,
            chart: charts.chart,
            charts: charts.charts,
            breakdown: targets,
        };
    }

    const report = plan.node
        ? nodeReport(plan.node, balancesOf(sources, plan.sources[0]), reader)
        : calculatedNetResult(snapshot, plan.calculated, sources, reader);
    const total = reportAmounts(report.total);
    const charts = reportCharts(intent.chart ?? 'auto', view, {
        nature,
        type: report.root.type,
        total,
        previous: total.previous !== undefined,
        net:
            plan.calculated !== undefined ||
            (report.root.type === 'MIXED' && nature === 'activity'),
        sideBySide: false,
        rows: report.rows,
        series: report.series,
        months,
    });
    return {
        ...base(plan.node ? nodeFilter(plan.node) : groupsFilter(snapshot, plan.sources)),
        root: report.root,
        ...(plan.node?.kind === 'account' ? { account: true as const } : {}),
        answer: total,
        ...(report.calculated ? { calculated: report.calculated } : {}),
        chart: charts.chart,
        charts: charts.charts,
        breakdown: report.rows,
    };
}

/**
 * An account in no group is read with a query of its own, whose answer holds it whenever Bkper
 * finds it, at zero or not, but for an archived one at zero, which Bkper leaves out.
 */
function assertAccountsRead(
    snapshot: Snapshot,
    plan: ReportPlan,
    sources: ReadonlyMap<string, SourceBalances>
): void {
    const nodes = plan.targets?.map(({ node }) => node) ?? (plan.node ? [plan.node] : []);
    for (const node of nodes) {
        const account = Object.hasOwn(snapshot.ungrouped, node.id)
            ? snapshot.ungrouped[node.id]
            : undefined;
        if (
            account &&
            !account.archived &&
            !accountBalances(balancesOf(sources, account.id).current, account.name)
        ) {
            throw new MissingBalancesError('Bkper did not find the account by its name');
        }
    }
}

/** A query filter for transactions in any of the groups, for the report's link to Bkper. */
function groupsFilter(snapshot: Snapshot, groupIds: string[]): string {
    const filters = groupIds.map(id => `group:${quote(snapshot.groups[id].name)}`);
    return filters.length === 1 ? filters[0] : `(${filters.join(' OR ')})`;
}

/**
 * What a report reads and what it is of: the root, a target under it, an account in no group,
 * a net result, or several of the others side by side.
 */
function reportSubject(intent: ReportIntent, snapshot: Snapshot): ReportSubject {
    const { root, target, alongside } = intent;
    if (alongside !== undefined) {
        return sideBySide([{ root, target }, ...alongside], snapshot);
    }
    if (root === NET_RESULT_ROOT) {
        if (target !== undefined) {
            throw unknownTarget();
        }
        const net = netResultOf(snapshot);
        switch (net.kind) {
            case 'group':
                return { sources: [net.group], node: groupNode(snapshot.groups[net.group]) };
            case 'calculated':
                return {
                    sources: snapshot.roots.filter(
                        id => net.incoming.includes(id) || net.outgoing.includes(id)
                    ),
                    calculated: { incoming: net.incoming, outgoing: net.outgoing },
                };
            case 'none':
                throw net.reason === 'no_activity_roots'
                    ? new ReportError(
                          net.reason,
                          'The Book has no Incoming or Outgoing root groups'
                      )
                    : bookProblemError(noNetResultProblem(snapshot));
        }
    }
    const node = subjectNode({ root, target }, snapshot);
    return { sources: [sourceOf(snapshot, node)], node };
}

/**
 * Rejects a report that reads a group whole whose accounts hold balances and activity: the
 * subject's group, or each group side by side. Accounts are read from their groups' responses,
 * by name, so a target account is never mixed.
 */
function rejectMixedGroups(subject: ReportSubject, snapshot: Snapshot): void {
    const nodes = subject.node ? [subject.node] : (subject.targets ?? []).map(({ node }) => node);
    for (const node of nodes) {
        const problem = node.kind === 'group' ? mixedGroupProblem(snapshot, node.id) : undefined;
        if (problem) {
            throw bookProblemError(problem);
        }
    }
}

/**
 * Several targets side by side, each once, in the order asked for, and the groups they are read
 * from, each once, so targets read from the same group share its queries: all positions or all
 * activity. A target asked for again, even under another root, is the same; one target alone
 * is its own report.
 */
function sideBySide(subjects: ReportSubjectData[], snapshot: Snapshot): ReportSubject {
    const targets: SideBySideTarget[] = [];
    for (const subject of subjects) {
        if (subject.root === NET_RESULT_ROOT) {
            throw unknownTarget();
        }
        const node = subjectNode(subject, snapshot);
        if (!targets.some(known => known.node.id === node.id)) {
            targets.push({ node, source: sourceOf(snapshot, node) });
        }
    }
    if (targets.length === 1) {
        return { sources: [targets[0].source], node: targets[0].node };
    }
    if (new Set(targets.map(({ node }) => node.permanent)).size > 1) {
        throw new ReportError('mixed_targets', 'Positions and activity side by side');
    }
    return { sources: [...new Set(targets.map(({ source }) => source))], targets };
}

/**
 * The group, or account in no group, whose queries a node is read from, by id: a group itself
 * (a root or a target under one), so its query holds no more than it does; an account in no
 * group itself, with `account:'<name>'`; and an account in groups, the smallest group holding
 * it, the one with the fewest groups and accounts at any depth, the first in Book order (roots
 * in order, each with its subgroups) on a tie. Never `account:'<name>'` for an account in a
 * group: Bkper does not find some accounts of older Books by name, yet lists them under their
 * groups. The group's answer lists the account with its own Bkper balance.
 */
function sourceOf(snapshot: Snapshot, node: ReportNode): string {
    if (node.kind === 'group' || Object.hasOwn(snapshot.ungrouped, node.id)) {
        return node.id;
    }
    let smallest: { id: string; size: number } | undefined;
    for (const group of groupsInBookOrder(snapshot)) {
        if (group.accounts.includes(node.id)) {
            const size = sizeOf(snapshot, group);
            if (smallest === undefined || size < smallest.size) {
                smallest = { id: group.id, size };
            }
        }
    }
    if (smallest === undefined) {
        throw new Error(`No group holds the account ${node.id}`);
    }
    return smallest.id;
}

/** The Book's groups in Book order: each root in order, then its subgroups, depth first. */
function groupsInBookOrder(snapshot: Snapshot): SnapshotGroup[] {
    const groups: SnapshotGroup[] = [];
    const visit = (id: string): void => {
        const group = snapshot.groups[id];
        groups.push(group);
        group.groups.forEach(visit);
    };
    snapshot.roots.forEach(visit);
    return groups;
}

/** How many groups and accounts a group holds, at any depth, each once. */
function sizeOf(snapshot: Snapshot, group: SnapshotGroup): number {
    let groups = 0;
    const count = (node: SnapshotGroup): void => {
        groups += node.groups.length;
        node.groups.forEach(id => count(snapshot.groups[id]));
    };
    count(group);
    return groups + accountsOf(snapshot, group).size;
}

/** The group or account a subject names: a root, an account in no group, or a target under a root. */
function subjectNode({ root, target }: ReportSubjectData, snapshot: Snapshot): ReportNode {
    if (Object.hasOwn(snapshot.ungrouped, root)) {
        if (target !== undefined) {
            throw unknownTarget();
        }
        return accountNode(snapshot.ungrouped[root]);
    }
    if (!snapshot.roots.includes(root)) {
        throw new ReportError('unknown_root', 'Not a root group of the Book');
    }
    const group = snapshot.groups[root];
    return target === undefined ? groupNode(group) : targetNode(snapshot, group, target);
}

/** A group or account under a root group, at any depth, or a {@link ReportError}. */
function targetNode(snapshot: Snapshot, root: SnapshotGroup, target: string): ReportNode {
    if (Object.hasOwn(snapshot.groups, target)) {
        // A group has one parent: the target is under the root when the root is its ancestor.
        for (let id = snapshot.groups[target].parent; id !== undefined;) {
            if (id === root.id) {
                return groupNode(snapshot.groups[target]);
            }
            id = snapshot.groups[id]?.parent;
        }
    } else if (Object.hasOwn(snapshot.accounts, target) && accountsOf(snapshot, root).has(target)) {
        return accountNode(snapshot.accounts[target]);
    }
    throw unknownTarget();
}

function unknownTarget(): ReportError {
    return new ReportError('unknown_target', 'Not a group or account under the root group');
}

/** A group or an account in no group a report queries. */
function sourceNode(snapshot: Snapshot, id: string): ReportNode {
    return Object.hasOwn(snapshot.ungrouped, id)
        ? accountNode(snapshot.ungrouped[id])
        : groupNode(snapshot.groups[id]);
}

function groupNode(group: SnapshotGroup): ReportNode {
    const { id, name, type, permanent } = group;
    return { id, kind: 'group', name, type, permanent };
}

function accountNode(account: UngroupedAccount): ReportNode {
    const { id, name, type, permanent } = account;
    return { id, kind: 'account', name, type, permanent };
}

/** Where a Book's net result comes from, or why it has none. */
export type NetResult =
    /** A root group that combines Incoming and Outgoing: Bkper calculates the net result. */
    | { kind: 'group'; group: string }
    /** Simple activity roots, which Report nets: see {@link calculatedNetResult}. */
    | { kind: 'calculated'; incoming: string[]; outgoing: string[] }
    | { kind: 'none'; reason: 'no_activity_roots' | 'no_net_result' };

/**
 * The net result of a Book, from its map: the root group that combines Incoming and Outgoing
 * accounts, the one with the most accounts (the first in Book order on a tie); else, when every
 * activity root is purely Incoming or purely Outgoing, there are both, and no two share an
 * account, those roots, for Report to net; else none.
 */
export function netResultOf(snapshot: Snapshot): NetResult {
    const activity = snapshot.roots
        .map(id => snapshot.groups[id])
        .filter(group => !group.permanent);
    if (activity.length === 0) {
        return { kind: 'none', reason: 'no_activity_roots' };
    }
    const accounts = new Map(activity.map(group => [group.id, accountsOf(snapshot, group)]));
    const types = (group: SnapshotGroup) =>
        new Set([...(accounts.get(group.id) ?? [])].map(id => snapshot.accounts[id].type));
    const combining = activity
        .filter(group => {
            const held = types(group);
            return group.type === 'MIXED' && held.has('INCOMING') && held.has('OUTGOING');
        })
        // A stable sort: the first in Book order on a tie.
        .sort((a, b) => (accounts.get(b.id)?.size ?? 0) - (accounts.get(a.id)?.size ?? 0))[0];
    if (combining) {
        return { kind: 'group', group: combining.id };
    }
    const incoming = activity.filter(group => group.type === 'INCOMING').map(group => group.id);
    const outgoing = activity.filter(group => group.type === 'OUTGOING').map(group => group.id);
    const held = activity.flatMap(group => [...(accounts.get(group.id) ?? [])]);
    const simple =
        incoming.length > 0 &&
        outgoing.length > 0 &&
        incoming.length + outgoing.length === activity.length &&
        new Set(held).size === held.length;
    return simple
        ? { kind: 'calculated', incoming, outgoing }
        : { kind: 'none', reason: 'no_net_result' };
}

/** The ids of the accounts under a group, at any depth, each once. */
function accountsOf(snapshot: Snapshot, group: SnapshotGroup): Set<string> {
    const ids = new Set<string>();
    const collect = (node: SnapshotGroup): void => {
        node.accounts.forEach(id => ids.add(id));
        node.groups.forEach(id => collect(snapshot.groups[id]));
    };
    collect(group);
    return ids;
}

export interface ReportPeriod {
    /** What the period's queries read. */
    read: PeriodDates;
    /** What the queries of the period compared with read; all time has none. */
    comparison?: PeriodDates;
    /** Why the comparison asked for cannot be made, so `comparison` is the default one. */
    comparisonError?: ComparisonError;
}

/**
 * The period of an intent as the period query builder writes it from its parts: whole months,
 * a running period through the end of the current month, compared with the period the intent
 * names, or the same months of the previous period or a year earlier; a position at the end of
 * its period. A comparison that cannot be made (another kind of period, one that is not
 * earlier, or anything before all time) is never left out silently: the report compares with
 * the previous period instead, and keeps why.
 */
function reportPeriod(intent: ReportIntent, nature: ReportNature, today: IsoDate): ReportPeriod {
    const context = { today, nature };
    const built = buildPeriodQuery(
        { period: intent.period, compared: intent.compared, compareWith: intent.compareWith },
        context
    );
    if (!built.ok) {
        if (built.reason === 'future_period') {
            throw new ReportError('future_period', 'The period has not started');
        }
        throw new Error(`No period for ${JSON.stringify(intent.period)}: ${built.reason}`);
    }
    const fallback = built.comparisonError && buildPeriodQuery({ period: intent.period }, context);
    const { period: read, comparison } = fallback?.ok ? fallback : built;
    return {
        read,
        ...(comparison ? { comparison } : {}),
        ...(built.comparisonError ? { comparisonError: built.comparisonError } : {}),
    };
}

/**
 * The days a query read, as Bkper labels its answer in the Book's date format; for an answer
 * without labels Bkper wrote in that format, such as one cached before they were kept, the days
 * its dates resolve to as Bkper resolves them, from the Book's today.
 */
function readDaysOf(
    read: PeriodDates,
    answer: QueryBalances | undefined,
    snapshot: Snapshot
): ReadDays {
    const labelled = answer && readDays(answer, snapshot.book.datePattern);
    if (labelled) {
        return labelled;
    }
    const { first, last, beforeDay } = resolveQueryDates(read.dates, snapshot.today);
    if (last === undefined) {
        throw new Error(`Query dates read up to no month: ${read.dates}`);
    }
    return {
        ...(first === undefined ? {} : { after: `${first}-01` }),
        before: beforeDay ?? `${nextMonth(last)}-01`,
    };
}

/**
 * The months a report shows, those of its period, from its first month (all time: the first
 * month Bkper answers the report's queries with, in a plausible year) to its last. Bkper may
 * also answer a month after them, such as the month of `before:` in a query without `after:`;
 * it is left out.
 */
function reportMonths(read: PeriodDates, sources: SourceBalances[]): IsoMonth[] {
    const first =
        read.first ??
        firstMonth(
            sources.map(source => source.current),
            read.last
        );
    const months: IsoMonth[] = [];
    for (let month = first; month !== undefined && month <= read.last; month = nextMonth(month)) {
        months.push(month);
    }
    return months;
}

/** The first month with a bucket in any of the answers, in a plausible year, up to `last`. */
function firstMonth(answers: QueryBalances[], last: IsoMonth): IsoMonth | undefined {
    return answers
        .flatMap(answer => [...Object.values(answer.groups), ...Object.values(answer.accounts)])
        .flatMap(node => node.months.map(({ month }) => month))
        .filter(month => isPlausibleYear(Number(month.slice(0, 4))) && month <= last)
        .sort()[0];
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

/**
 * The balances a report reads from one group, or account in no group: of the period and of
 * the previous one.
 */
interface SourceBalances {
    current: QueryBalances;
    previous?: QueryBalances;
}

function balancesOf(sources: ReadonlyMap<string, SourceBalances>, id: string): SourceBalances {
    const source = sources.get(id);
    if (!source) {
        throw new Error(`No balances read from ${id}`);
    }
    return source;
}

/**
 * Reads groups, accounts and their rows from the balances of a root, as Bkper returns them. A
 * node Bkper left out of a response has no balance there. Rows are the groups and accounts
 * Bkper lists under a group in either period, never ones from the Book's map alone; the map
 * gives their ids and types, and a node it lacks gets them from its name and its nature.
 */
class RowReader {
    private readonly groups: Map<string, SnapshotGroup>;
    private readonly accounts: Map<string, Snapshot['accounts'][string]>;

    constructor(
        snapshot: Snapshot,
        private readonly nature: ReportNature,
        private readonly period: ReportPeriod,
        private readonly months: IsoMonth[]
    ) {
        this.groups = new Map(Object.values(snapshot.groups).map(group => [group.name, group]));
        this.accounts = new Map(
            Object.values(snapshot.accounts).map(account => [account.name, account])
        );
    }

    /** A group's line, with the rows Bkper returns under it, at any depth. */
    group(name: string, source: SourceBalances): Line {
        const current = groupBalances(source.current, name);
        const previous = source.previous && groupBalances(source.previous, name);
        const listed = (pick: (balances: GroupNodeBalances) => string[]) => [
            ...new Set([current, previous].flatMap(balances => (balances ? pick(balances) : []))),
        ];
        const known = this.groups.get(name);
        return {
            id: known?.id ?? `group:${name}`,
            kind: 'group',
            name,
            type: known?.type ?? nodeType(current ?? previous),
            measure: this.measure(current, previous),
            children: [
                ...listed(balances => balances.groups).map(child => this.group(child, source)),
                ...listed(balances => balances.accounts).map(child => this.account(child, source)),
            ],
        };
    }

    /** An account's line, from a group's responses or from a query of the account alone. */
    account(name: string, source: SourceBalances): Line {
        const current = accountBalances(source.current, name);
        const previous = source.previous && accountBalances(source.previous, name);
        const known = this.accounts.get(name);
        return {
            id: known?.id ?? `account:${name}`,
            kind: 'account',
            name,
            type: known?.type ?? nodeType(current ?? previous),
            measure: this.measure(current, previous),
            children: [],
        };
    }

    private measure(current?: NodeBalances, previous?: NodeBalances): Measure {
        return {
            amount: this.total(current),
            ...(this.period.comparison ? { previous: this.total(previous) } : {}),
            months: this.months.map(month =>
                this.nature === 'activity'
                    ? new Amount(monthPeriod(current, month))
                    : new Amount(monthPosition(current, month))
            ),
        };
    }

    private total(balances: NodeBalances | undefined): Amount {
        return new Amount(
            (this.nature === 'activity' ? balances?.period : balances?.cumulative) ?? 0
        );
    }
}

/** The type of a node from its nature, as Bkper gives it; mixed groups need the map. */
function nodeType(balances: NodeBalances | undefined): Exclude<NodeType, 'MIXED'> {
    if (balances?.permanent) {
        return balances.credit ? 'LIABILITY' : 'ASSET';
    }
    return balances?.credit ? 'INCOMING' : 'OUTGOING';
}

/** A breakdown row before its amounts become decimal strings. */
interface Line {
    id: string;
    kind: RowKind;
    name: string;
    type: NodeType;
    measure: Measure;
    children: Line[];
}

interface ComputedReport {
    root: ReportRoot;
    total: Measure;
    calculated?: ReportData['calculated'];
    rows: ReportRow[];
    series: ChartSeries[];
}

/** The line of a group or an account, read from the responses of its root, by its id. */
function nodeLine(node: ReportNode, source: SourceBalances, reader: RowReader): Line {
    const line =
        node.kind === 'group' ? reader.group(node.name, source) : reader.account(node.name, source);
    return { ...line, id: node.id, type: node.type };
}

/** The series by month of a line. */
function lineSeries(line: Line): ChartSeries {
    return {
        id: line.id,
        name: line.name,
        type: line.type,
        color: TYPE_COLORS[line.type],
        amounts: line.measure.months.map(decimal),
    };
}

/** The report of a group or an account, read from the responses of its root. */
function nodeReport(node: ReportNode, source: SourceBalances, reader: RowReader): ComputedReport {
    const line = nodeLine(node, source, reader);
    return {
        root: { id: node.id, name: node.name, type: node.type, color: TYPE_COLORS[node.type] },
        total: line.measure,
        rows: toRows(line.children, line),
        series: [lineSeries(line)],
    };
}

/**
 * The one amount Report calculates itself, for a Book whose groups give no net result: Bkper's
 * totals of its Incoming roots minus those of its Outgoing roots, in the period, the previous
 * one and each month. {@link netResultOf} allows it only when every activity root is purely
 * Incoming or purely Outgoing and no two share an account, which the responses confirm, so no
 * account counts twice. Its rows are those roots, as Bkper returns them, Incoming first.
 */
function calculatedNetResult(
    snapshot: Snapshot,
    roots: CalculatedRoots,
    sources: ReadonlyMap<string, SourceBalances>,
    reader: RowReader
): ComputedReport {
    const all = [...roots.incoming, ...roots.outgoing];
    const heldBy = new Map(
        all.map(id => {
            const { current, previous } = balancesOf(sources, id);
            const read = [current, previous ?? []].flat();
            return [id, new Set(read.flatMap(balances => Object.keys(balances.accounts)))];
        })
    );
    const shared = all.filter(id =>
        all.some(
            other =>
                other !== id &&
                [...(heldBy.get(id) ?? [])].some(name => heldBy.get(other)?.has(name))
        )
    );
    if (shared.length > 0) {
        throw bookProblemError(
            noNetResultProblem(
                snapshot,
                snapshot.roots.filter(id => shared.includes(id)).map(id => snapshot.groups[id].name)
            )
        );
    }
    const lines = (ids: string[]) =>
        ids.map(id => reader.group(snapshot.groups[id].name, balancesOf(sources, id)));
    const incoming = lines(roots.incoming);
    const outgoing = lines(roots.outgoing);
    const sum = (measures: Measure[]): Measure =>
        measures.reduce((total, measure) => ({
            amount: total.amount.plus(measure.amount),
            ...(total.previous && measure.previous
                ? { previous: total.previous.plus(measure.previous) }
                : {}),
            months: total.months.map((month, i) => month.plus(measure.months[i])),
        }));
    const into = sum(incoming.map(line => line.measure));
    const out = sum(outgoing.map(line => line.measure));
    const total: Measure = {
        amount: into.amount.minus(out.amount),
        ...(into.previous && out.previous ? { previous: into.previous.minus(out.previous) } : {}),
        months: into.months.map((month, i) => month.minus(out.months[i])),
    };
    const net = { type: 'MIXED' as const, measure: total };
    return {
        root: { id: NET_RESULT_ROOT, type: 'MIXED', color: TYPE_COLORS.MIXED },
        total,
        calculated: { months: total.months.map(decimal) },
        rows: [...toRows(incoming, net), ...toRows(outgoing, net)],
        series: [
            ...[...incoming, ...outgoing]
                .filter(line => !line.measure.amount.eq(0))
                .map(lineSeries),
            {
                id: NET_RESULT_ROOT,
                type: 'MIXED',
                color: TYPE_COLORS.MIXED,
                line: true,
                amounts: total.months.map(decimal),
            },
        ],
    };
}

function toRows(lines: Line[], parent: Pick<Line, 'type' | 'measure'>): ReportRow[] {
    const shareable = parent.type !== 'MIXED' && !parent.measure.amount.eq(0);
    return lines
        .filter(line => !isZero(line.measure))
        .sort(byRank)
        .map(line => toRow(line, shareable ? parent.measure.amount : undefined));
}

/** A line as a row, with its share of the parent's amount when it has one. */
function toRow(line: Line, parent: Amount | undefined): ReportRow {
    return {
        id: line.id,
        kind: line.kind,
        name: line.name,
        type: line.type,
        color: TYPE_COLORS[line.type],
        ...reportAmounts(line.measure),
        ...(parent ? { share: ratio(line.measure.amount, parent) } : {}),
        months: line.measure.months.map(decimal),
        children: toRows(line.children, line),
    };
}

/** Largest first, by size whatever the sign; a stable sort keeps the order of a tie. */
function bySize(a: ReportRow, b: ReportRow): number {
    return new Amount(b.amount).abs().cmp(new Amount(a.amount).abs());
}

/** Largest first, by size whatever the sign; then rows without an amount. */
function byRank(a: Line, b: Line): number {
    const zero = Number(a.measure.amount.eq(0)) - Number(b.measure.amount.eq(0));
    return (
        zero || b.measure.amount.abs().cmp(a.measure.amount.abs()) || a.name.localeCompare(b.name)
    );
}

/** What a chart is drawn from. */
interface ChartInput {
    nature: ReportNature;
    /** The root's type; of targets side by side, theirs when they share one, else mixed. */
    type: NodeType;
    /** The root's amounts, which its parts may make; none for targets side by side. */
    total?: ReportAmounts;
    /** Whether there is a previous period to compare with. */
    previous: boolean;
    /** A net result: of a group that combines Incoming and Outgoing, or calculated. */
    net: boolean;
    /** Targets side by side, which the rows are: no parts of one whole. */
    sideBySide: boolean;
    /** The root's parts, or the targets side by side, in the order asked for. */
    rows: ReportRow[];
    /**
     * The series of a chart by month: the root, or the roots of a net result Report calculates
     * and that net result.
     */
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

function chartFacts(input: ChartInput): ChartFacts {
    const { nature, type, net, rows, months, previous, sideBySide } = input;
    const drawn = rows.filter(hasAmount);
    return {
        rows: drawn.length,
        negative: drawn.filter(row => new Amount(row.amount).lt(0)).length,
        mixed: type === 'MIXED' || drawn.some(row => row.type !== type),
        months: months.length,
        previous,
        net,
        permanent: nature === 'position',
        ...(sideBySide ? { sideBySide: true as const } : {}),
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
    const { type, total, net, rows, series, months, sideBySide } = input;
    const drawn = rows.filter(hasAmount);
    // Targets side by side are no slices or stacked parts of one whole.
    if (sideBySide && (kind === 'stacked' || kind === 'donut' || kind === 'pie')) {
        return { reason: { code: 'side_by_side' } };
    }
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
        case 'stacked': {
            const reason = stackedReason(input);
            return reason
                ? { reason }
                : { chart: { kind: 'stacked', series: stackedSeries(input) } };
        }
        case 'ranked-bar':
            // Parts come sorted by size; targets side by side, in the order asked for.
            return drawn.length >= 2
                ? {
                      chart: {
                          kind: 'ranked-bar',
                          rows: ids(sideBySide ? [...drawn].sort(bySize) : drawn),
                      },
                  }
                : { reason: { code: 'few_parts' } };
        case 'donut':
        case 'pie': {
            const reason = compositionReason(drawn, type, net);
            if (reason) {
                return { reason };
            }
            if (
                !total ||
                !isWhole(
                    drawn.map(row => row.amount),
                    total.amount
                )
            ) {
                return { reason: { code: 'not_a_whole' } };
            }
            if (kind === 'donut' && drawn.length > MAX_DONUT_ROWS) {
                return { reason: { code: 'too_many_parts' } };
            }
            return { chart: { kind, rows: ids(drawn) } };
        }
        case 'compare': {
            if (!input.previous) {
                return { reason: { code: 'no_previous' } };
            }
            const compared = rows.filter(
                row => hasAmount(row) || !new Amount(row.previous ?? 0).eq(0)
            );
            return compared.length > 0
                ? { chart: { kind: 'compare', rows: ids(compared) } }
                : { reason: { code: 'no_amounts' } };
        }
        case 'waterfall':
            // Its start, steps and end would be sums of Bkper's balances, not balances.
            return { reason: { code: 'no_bridge' } };
    }
}

/** Why parts are no slices of one whole, or `undefined` when they may be. */
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

/** Parts of one type, each positive, as slices of a whole are. */
function isComposition(rows: ReportRow[], rootType: NodeType): boolean {
    return (
        rootType !== 'MIXED' &&
        rows.every(row => row.type === rootType && new Amount(row.amount).gt(0))
    );
}

/**
 * Whether the parts Bkper returns make the whole it returns. They may not, as when Bkper leaves
 * a node out or subgroups share an account: then no chart may show them as its slices. This
 * compares Bkper's own amounts; it shows no sum.
 */
function isWhole(parts: string[], whole: string): boolean {
    return parts.reduce((sum, part) => sum.plus(part), new Amount(0)).eq(whole);
}

/** The top rows with an amount in any month: the parts stacked bars draw, each of its own. */
function stackedParts({ rows }: ChartInput): ReportRow[] {
    return rows.filter(row => row.months.some(month => !new Amount(month).eq(0)));
}

/** Why the parts do not stack up to the root in every month, or `undefined` when they do. */
function stackedReason(input: ChartInput): UnfitReason | undefined {
    const { type, net, months, series } = input;
    // A net result's parts are each in their own sense, so they do not stack up to it.
    if (net) {
        return { code: 'net_result' };
    }
    if (months.length < 2) {
        return { code: 'few_months' };
    }
    const parts = stackedParts(input);
    if (parts.length < 2) {
        return { code: 'few_parts' };
    }
    if (type === 'MIXED' || parts.some(row => row.type !== type)) {
        return { code: 'mixed_parts' };
    }
    if (parts.length > MAX_STACKED_PARTS) {
        return { code: 'too_many_parts' };
    }
    const whole = months.every((_, i) =>
        isWhole(
            parts.map(row => row.months[i]),
            series[0].amounts[i]
        )
    );
    return whole ? undefined : { code: 'not_a_whole' };
}

/** A series for each part, each as Bkper returns it: in every month they make the root. */
function stackedSeries(input: ChartInput): ChartSeries[] {
    return stackedParts(input).map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        color: row.color,
        amounts: row.months,
    }));
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
