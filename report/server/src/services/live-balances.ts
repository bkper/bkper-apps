/**
 * Live balances: the one balances query a report runs when the snapshot cannot answer it.
 *
 * Hashtag reports read every root group with the hashtags, by day, over the full history up
 * to today. That query depends only on the snapshot and the hashtags, so it can start before
 * the rest of the request is understood. Reports over periods the snapshot's months cannot
 * answer, such as today's activity, read their roots by day within the report's range.
 *
 * Amounts have the sign Bkper shows, like the snapshot: bkper-js representative balances.
 */
import { Amount, type BalancesContainer, type BalancesReport } from 'bkper-js';
import { addDays, type DateRange, type IsoDate } from './periods.js';
import { quote, type Snapshot, type SnapshotGroup, type SnapshotNode } from './snapshot.js';

/** A live balances query and the dates it covers: `after` (if any) inclusive, `before` exclusive. */
export interface LiveQuery {
    query: string;
    after?: IsoDate;
    before: IsoDate;
    /** The hashtags it filters by; empty for an unfiltered query. */
    hashtags: string[];
}

/** Activity of one day that had movements. */
export interface DayBalance {
    date: IsoDate;
    period: string;
}

/** The result of a {@link LiveQuery}, by day, for the groups and accounts of the snapshot. */
export interface LiveBalances extends LiveQuery {
    /** When the balances were read, as an ISO instant. */
    dataAt: string;
    groups: Record<string, DayBalance[]>;
    accounts: Record<string, DayBalance[]>;
}

/** Every root with all the hashtags, by day, from the beginning up to today. */
export function hashtagQuery(snapshot: Snapshot, hashtags: string[]): LiveQuery {
    const before = addDays(snapshot.today, 1);
    const tags = hashtags.map(tag => `#${tag}`).join(' ');
    return {
        query: `${groupsFilter(snapshot, snapshot.roots)} ${tags} before:${before} by:d`,
        before,
        hashtags,
    };
}

/** The given roots, by day, within a range. */
export function rangeQuery(
    snapshot: Snapshot,
    roots: string[],
    range: Required<DateRange>
): LiveQuery {
    return {
        query: `${groupsFilter(snapshot, roots)} after:${range.after} before:${range.before} by:d`,
        after: range.after,
        before: range.before,
        hashtags: [],
    };
}

/** A query filter for transactions in any of the groups. */
export function groupsFilter(snapshot: Snapshot, groupIds: string[]): string {
    const filters = groupIds.map(id => `group:${quote(snapshot.groups[id].name)}`);
    return filters.length === 1 ? filters[0] : `(${filters.join(' OR ')})`;
}

/** Normalizes the result of a {@link LiveQuery} onto the groups and accounts of the snapshot. */
export function readLiveBalances(
    query: LiveQuery,
    report: BalancesReport,
    snapshot: Snapshot,
    dataAt: Date
): LiveBalances {
    const groupIds = idsByName(Object.values(snapshot.groups));
    const accountIds = idsByName(Object.values(snapshot.accounts));
    const live: LiveBalances = { ...query, dataAt: dataAt.toISOString(), groups: {}, accounts: {} };

    const read = (container: BalancesContainer): void => {
        const account = container.isFromAccount();
        const id = (account ? accountIds : groupIds).get(container.getName());
        if (id === undefined) {
            throw new Error(
                `${account ? 'Account' : 'Group'} not in the snapshot: ${container.getName()}`
            );
        }
        const days = account ? live.accounts : live.groups;
        // An account in several groups comes with the same balances under each.
        days[id] ??= container
            .getBalances()
            .filter(balance => !balance.getPeriodBalance().eq(0))
            .map(balance => ({
                date: `${balance.getYear()}-${pad(balance.getMonth())}-${pad(balance.getDay())}`,
                period: balance.getPeriodBalance().toFixed(),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
        container.getBalancesContainers().forEach(read);
    };
    report.getBalancesContainers().forEach(read);
    return live;
}

/** Activity of a node within a range, or `undefined` when the live query does not cover it. */
export function livePeriodAmount(
    live: LiveBalances,
    node: SnapshotNode,
    range: DateRange
): Amount | undefined {
    const covered =
        range.before <= live.before &&
        (live.after === undefined || (range.after !== undefined && range.after >= live.after));
    if (!covered) {
        return undefined;
    }
    return sumDays(
        live,
        node,
        day => (range.after === undefined || day.date >= range.after) && day.date < range.before
    );
}

/** Position of a node at the start of `before`, when the live query holds the full history. */
export function livePositionAmount(
    live: LiveBalances,
    node: SnapshotNode,
    before: IsoDate
): Amount | undefined {
    if (live.after !== undefined || before > live.before) {
        return undefined;
    }
    return sumDays(live, node, day => day.date < before);
}

function sumDays(
    live: LiveBalances,
    node: SnapshotNode,
    include: (day: DayBalance) => boolean
): Amount {
    const days = (isGroup(node) ? live.groups : live.accounts)[node.id] ?? [];
    return days.filter(include).reduce((total, day) => total.plus(day.period), new Amount(0));
}

export function isGroup(node: SnapshotNode): node is SnapshotGroup {
    return 'accounts' in node;
}

function idsByName(nodes: SnapshotNode[]): Map<string, string> {
    return new Map(nodes.map(node => [node.name, node.id]));
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}
