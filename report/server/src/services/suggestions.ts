/**
 * Suggested reports: a few example requests for a Book, each with the intent it stands for,
 * so picking one builds the report without asking the decision model.
 *
 * They are chosen by fixed rules from the snapshot (the Book's map, which holds no amounts),
 * among the reports the Book supports: roots without movements are left out, and periods are
 * anchored to the data, so a Book whose movements are years old suggests its last year with
 * movements.
 */
import { t, type StringKey } from 'report-shared/strings';
import { addDays, defaultPeriod, resolvePeriod, type IsoMonth } from './periods.js';
import { netResultOf } from './report.js';
import { NET_RESULT_ROOT, type ReportIntent } from './report-intent.js';
import { lastActiveMonth, type NodeType, type Snapshot, type SnapshotGroup } from './snapshot.js';

export interface Suggestion {
    /** The request as a person would type it, in the requested language. */
    text: string;
    intent: ReportIntent;
}

/** How many suggestions are shown, when the Book supports that many. */
export const SUGGESTION_COUNT = 3;

/**
 * Up to {@link SUGGESTION_COUNT} suggestions, in this order of preference: the net result,
 * when the Book has one, the busiest Outgoing root by month, the busiest Asset (or other
 * permanent) root's position, the busiest Incoming root, then the other roots, busiest first.
 * Each root is suggested once: the group that combines Incoming and Outgoing as the net result.
 */
export function buildSuggestions(snapshot: Snapshot, lang: string): Suggestion[] {
    const roots = snapshot.roots
        .map(id => snapshot.groups[id])
        .flatMap((group): ActiveRoot[] => {
            const last = lastActiveMonth([group]);
            return last === undefined ? [] : [{ group, last }];
        });
    const activity = roots
        .filter(root => !root.group.permanent)
        .map(root => activityRoot(snapshot, root));
    const positions = roots
        .filter(root => root.group.permanent)
        .map(root => positionRoot(snapshot, root));

    const sized = (roots: SuggestedRoot[], type: NodeType) =>
        [...roots].sort(
            (a, b) =>
                Number(b.group.type === type) - Number(a.group.type === type) || b.size - a.size
        );
    const ordered: { root: SuggestedRoot; monthly: boolean }[] = [
        ...sized(activity, 'OUTGOING')
            .slice(0, 1)
            .map(root => ({ root, monthly: true })),
        ...sized(positions, 'ASSET')
            .slice(0, 1)
            .map(root => ({ root, monthly: false })),
        ...sized(activity, 'INCOMING').map(root => ({ root, monthly: false })),
        ...sized(positions, 'ASSET').map(root => ({ root, monthly: false })),
    ];

    const suggestions: Suggestion[] = [];
    const suggested = new Set<string>();
    const net = netResult(snapshot);
    if (net) {
        suggestions.push(netSuggestion(net, lang));
        net.roots.forEach(group => suggested.add(group.id));
    }
    for (const { root, monthly } of ordered) {
        if (!suggested.has(root.group.id)) {
            suggested.add(root.group.id);
            suggestions.push(rootSuggestion(root, monthly, lang));
        }
    }
    return suggestions.slice(0, SUGGESTION_COUNT);
}

interface SuggestedRoot {
    group: SnapshotGroup;
    /** `today`, `this_year` or a year `YYYY`. */
    period: string;
    /**
     * How busy the root is in the period: its accounts' months with movements, to rank roots
     * of the same kind without reading amounts.
     */
    size: number;
}

interface ActiveRoot {
    group: SnapshotGroup;
    /** The last month it had movements. */
    last: IsoMonth;
}

/** This year, or its last year with movements. */
function activityRoot(snapshot: Snapshot, { group, last }: ActiveRoot): SuggestedRoot {
    const today = snapshot.today;
    const period = defaultPeriod({
        nature: 'activity',
        trend: false,
        today,
        lastActiveMonth: last,
    });
    const range = resolvePeriod(period, { today });
    const from = range?.after?.slice(0, 7) ?? '';
    const to = addDays(range?.before ?? today, -1).slice(0, 7);
    return { group, period, size: busyMonths(snapshot, group, from, to) };
}

/** Today when the root moved this year; otherwise the end of its last year with movements. */
function positionRoot(snapshot: Snapshot, { group, last }: ActiveRoot): SuggestedRoot {
    const today = snapshot.today;
    const year = last.slice(0, 4);
    const period = year === today.slice(0, 4) ? 'today' : year;
    const before = resolvePeriod(period, { today })?.before ?? today;
    return {
        group,
        period,
        size: busyMonths(snapshot, group, '', addDays(before, -1).slice(0, 7)),
    };
}

/** The months with movements of each account under a group, from `first` to `last`, counted. */
function busyMonths(
    snapshot: Snapshot,
    group: SnapshotGroup,
    first: IsoMonth,
    last: IsoMonth
): number {
    const accounts = new Set<string>();
    const collect = (node: SnapshotGroup): void => {
        node.accounts.forEach(id => accounts.add(id));
        node.groups.forEach(id => collect(snapshot.groups[id]));
    };
    collect(group);
    return [...accounts]
        .flatMap(id => snapshot.accounts[id].activeMonths)
        .filter(month => month >= first && month <= last).length;
}

function rootSuggestion(root: SuggestedRoot, monthly: boolean, lang: string): Suggestion {
    const { group, period } = root;
    const key: StringKey = group.permanent
        ? period === 'today'
            ? 'suggestion_position_today'
            : 'suggestion_position_year_end'
        : monthly
          ? period === 'this_year'
              ? 'suggestion_monthly_this_year'
              : 'suggestion_monthly_year'
          : period === 'this_year'
            ? 'suggestion_breakdown_this_year'
            : 'suggestion_breakdown_year';
    return {
        text: t(key, lang, { root: group.name, year: period }),
        intent: { root: group.id, period, monthly },
    };
}

/**
 * The period of the Book's net result, and its group that combines Incoming and Outgoing,
 * when it has one and it holds both Incoming and Outgoing accounts with movements; otherwise
 * there is nothing to net.
 */
function netResult(snapshot: Snapshot): { period: string; roots: SnapshotGroup[] } | undefined {
    const net = netResultOf(snapshot);
    if (net.kind === 'none') {
        return undefined;
    }
    const activity = (net.kind === 'group' ? [net.group] : [...net.incoming, ...net.outgoing]).map(
        id => snapshot.groups[id]
    );
    const types = new Set<NodeType>();
    const collect = (group: SnapshotGroup): void => {
        group.accounts
            .map(id => snapshot.accounts[id])
            .filter(account => lastActiveMonth([account]) !== undefined)
            .forEach(account => types.add(account.type));
        group.groups.forEach(id => collect(snapshot.groups[id]));
    };
    activity.forEach(collect);
    if (!types.has('INCOMING') || !types.has('OUTGOING')) {
        return undefined;
    }
    const period = defaultPeriod({
        nature: 'activity',
        trend: false,
        today: snapshot.today,
        lastActiveMonth: lastActiveMonth(activity),
    });
    return { period, roots: net.kind === 'group' ? activity : [] };
}

function netSuggestion({ period }: { period: string }, lang: string): Suggestion {
    const key: StringKey =
        period === 'this_year' ? 'suggestion_net_result_this_year' : 'suggestion_net_result_year';
    return {
        text: t(key, lang, { year: period }),
        intent: { root: NET_RESULT_ROOT, period, monthly: false },
    };
}
