/**
 * Suggested reports: a few example requests for a Book, each with the intent it stands for,
 * so picking one builds the report without asking the decision model.
 *
 * They are chosen by fixed rules from the snapshot (the Book's map, its structure alone, which
 * holds no amounts or dates), among the reports the Book supports: roots without accounts are
 * left out and roots of a kind are ranked by how many accounts they hold. Their periods follow
 * the rule of a request that names none (`default-period.ts`): activity this year, or, when this
 * year has no movements, the last year with them, which the suggestion's text then names; a
 * position today.
 */
import { t, type StringKey } from 'report-shared/strings';
import type { QueryBalances } from './balances.js';
import { bookProblem, type BookProblem } from './book-problems.js';
import { readReport } from './default-period.js';
import { netResultOf } from './report.js';
import { NET_RESULT_ROOT, type ReportIntent } from './report-intent.js';
import type { NodeType, Snapshot, SnapshotGroup } from './snapshot.js';
import type { Timing } from './timing.js';

export interface Suggestion {
    /** The request as a person would type it, in the requested language. */
    text: string;
    intent: ReportIntent;
}

/** How many suggestions are shown, when the Book supports that many. */
export const SUGGESTION_COUNT = 3;

interface SuggestionOptions {
    loadBalances: (queries: string[]) => Promise<QueryBalances[]>;
    timing: Timing;
}

/**
 * What a Book offers when Report opens: its suggestions ({@link readSuggestions}), or, when it
 * has no reports at all (empty, or with nothing to report on), none and its problem, with no
 * balances read.
 */
export async function readOpening(
    snapshot: Snapshot,
    lang: string,
    options: SuggestionOptions
): Promise<{ suggestions: Suggestion[]; problem?: BookProblem }> {
    const problem = bookProblem(snapshot);
    if (problem) {
        return { suggestions: [], problem };
    }
    return { suggestions: await readSuggestions(snapshot, lang, options) };
}

/**
 * The suggestions of {@link buildSuggestions}, each with the period a request for it that names
 * none reads (`readReport`): this year when it has movements, else the last year with them,
 * after one query of the history of the suggested root (none for a position today, which never
 * moves). The report's own queries are the ones its intent then reads, so they are cached for it.
 * A suggestion whose balances cannot be read keeps its default period: its report tells.
 */
export async function readSuggestions(
    snapshot: Snapshot,
    lang: string,
    options: SuggestionOptions
): Promise<Suggestion[]> {
    const suggestions = await options.timing.measure('compute', async () =>
        buildSuggestions(snapshot, lang)
    );
    return Promise.all(
        suggestions.map(async suggestion => {
            if (suggestion.intent.period === 'today') {
                return suggestion;
            }
            try {
                const { intent } = await readReport(suggestion.intent, snapshot, {
                    loadBalances: options.loadBalances,
                    defaultPeriod: true,
                });
                return { text: suggestionText(snapshot, intent, lang), intent };
            } catch {
                return suggestion;
            }
        })
    );
}

/**
 * Up to {@link SUGGESTION_COUNT} suggestions, at the default periods (activity this year, a
 * position today), in this order of preference: the net result,
 * when the Book has one, the largest Outgoing root by month, the largest Asset (or other
 * permanent) root's position, the largest Incoming root, then the other roots, largest first.
 * Each root is suggested once: the group that combines Incoming and Outgoing as the net result.
 */
export function buildSuggestions(snapshot: Snapshot, lang: string): Suggestion[] {
    const roots = snapshot.roots
        .map(id => snapshot.groups[id])
        .map(group => ({ group, size: accountCount(snapshot, group) }))
        .filter(root => root.size > 0);
    const activity = roots.filter(root => !root.group.permanent);
    const positions = roots.filter(root => root.group.permanent);

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
        suggestions.push(netSuggestion(lang));
        net.roots.forEach(group => suggested.add(group.id));
    }
    for (const { root, monthly } of ordered) {
        if (!suggested.has(root.group.id)) {
            suggested.add(root.group.id);
            suggestions.push(rootSuggestion(root.group, monthly, lang));
        }
    }
    return suggestions.slice(0, SUGGESTION_COUNT);
}

interface SuggestedRoot {
    group: SnapshotGroup;
    /**
     * How large the root is: the accounts under it that are not archived, to rank roots of the
     * same kind without reading amounts.
     */
    size: number;
}

/** The accounts under a group, at any depth, each once, that are not archived. */
function accountCount(snapshot: Snapshot, group: SnapshotGroup): number {
    return [...accountsUnder(snapshot, group)].filter(id => !snapshot.accounts[id].archived).length;
}

function accountsUnder(snapshot: Snapshot, group: SnapshotGroup): Set<string> {
    const accounts = new Set<string>();
    const collect = (node: SnapshotGroup): void => {
        node.accounts.forEach(id => accounts.add(id));
        node.groups.forEach(id => collect(snapshot.groups[id]));
    };
    collect(group);
    return accounts;
}

/** Activity this year, by month or not, or a position today. */
function rootSuggestion(group: SnapshotGroup, monthly: boolean, lang: string): Suggestion {
    const intent = { root: group.id, period: group.permanent ? 'today' : 'this_year', monthly };
    return { text: textOf(group, intent, lang), intent };
}

/** The request a person would type for a suggestion's intent, naming its period. */
function suggestionText(snapshot: Snapshot, intent: ReportIntent, lang: string): string {
    return intent.root === NET_RESULT_ROOT
        ? netText(intent.period, lang)
        : textOf(snapshot.groups[intent.root], intent, lang);
}

/** A root's activity this year or in a year `YYYY`, by month or not, or its position today. */
function textOf(group: SnapshotGroup, { period, monthly }: ReportIntent, lang: string): string {
    const thisYear = period === 'this_year';
    const key: StringKey = group.permanent
        ? 'suggestion_position_today'
        : monthly
          ? thisYear
              ? 'suggestion_monthly_this_year'
              : 'suggestion_monthly_year'
          : thisYear
            ? 'suggestion_breakdown_this_year'
            : 'suggestion_breakdown_year';
    return t(key, lang, { root: group.name, year: period });
}

/**
 * The Book's net result, and its group that combines Incoming and Outgoing, when it has one
 * and it holds both Incoming and Outgoing accounts that are not archived; otherwise there is
 * nothing to net.
 */
function netResult(snapshot: Snapshot): { roots: SnapshotGroup[] } | undefined {
    const net = netResultOf(snapshot);
    if (net.kind === 'none') {
        return undefined;
    }
    const activity = (net.kind === 'group' ? [net.group] : [...net.incoming, ...net.outgoing]).map(
        id => snapshot.groups[id]
    );
    const types = new Set(
        activity
            .flatMap(group => [...accountsUnder(snapshot, group)])
            .map(id => snapshot.accounts[id])
            .filter(account => !account.archived)
            .map(account => account.type)
    );
    if (!types.has('INCOMING') || !types.has('OUTGOING')) {
        return undefined;
    }
    return { roots: net.kind === 'group' ? activity : [] };
}

function netSuggestion(lang: string): Suggestion {
    return {
        text: netText('this_year', lang),
        intent: { root: NET_RESULT_ROOT, period: 'this_year', monthly: false },
    };
}

/** The net result this year or in a year `YYYY`. */
function netText(period: string, lang: string): string {
    return period === 'this_year'
        ? t('suggestion_net_result_this_year', lang)
        : t('suggestion_net_result_year', lang, { year: period });
}
