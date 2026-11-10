/**
 * Suggested reports: a few example requests for a Book, each with the intent it stands for,
 * so a request of exactly a suggestion's text builds its report without asking the decision
 * model (`findSuggestion`).
 *
 * Code offers the candidates from the snapshot (the Book's map, its structure alone, which holds
 * no amounts or dates): the groups the Book shows at its first two levels, each as its natural
 * report, and the net result Report calculates when the Book has no group for it. Jev ranks them
 * with one judgment (`suggestion-questions.ts`), remembered for as long as the map stays the same,
 * and code takes the first three. Their periods follow the rule of a request that names none
 * (`default-period.ts`): activity this year, or, when this year has no movements, the last year
 * with them, which the suggestion's text then names; a position today.
 */
import type { PeriodParts } from 'report-shared/report-intent';
import { t, type StringKey } from 'report-shared/strings';
import type { QueryBalances } from './balances.js';
import { bookProblem, mixedGroupProblem, type BookProblem } from './book-problems.js';
import { decide, type DecisionClient } from './decision-client.js';
import { readReport } from './default-period.js';
import { findWrittenYears } from './period-questions.js';
import { netResultOf } from './report.js';
import { NET_RESULT_ROOT, type ReportIntent } from './report-intent.js';
import type { Snapshot, SnapshotGroup } from './snapshot.js';
import type { SnapshotStore } from './snapshot-loader.js';
import { buildSuggestionRequest, type SuggestionCandidate } from './suggestion-questions.js';
import type { Timing } from './timing.js';

export type { SuggestionCandidate };

export interface Suggestion {
    /** The request as a person would type it, in the requested language. */
    text: string;
    /** What the text stands for: its report is built from it, with no decision. */
    intent: ReportIntent;
}

/** How many suggestions are shown, when the Book offers that many. */
export const SUGGESTION_COUNT = 3;

/** The most candidates offered to Jev: the largest, when a Book has more. */
export const MAX_CANDIDATES = 20;

/** How long Jev's ranking of a map is remembered; a changed map is ranked again at once. */
export const SUGGESTION_ORDER_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The part of Workers KV that remembers rankings. */
export type SuggestionStore = SnapshotStore;

interface SuggestionOptions {
    loadBalances: (queries: string[]) => Promise<QueryBalances[]>;
    timing: Timing;
    decisions: DecisionClient;
    /** Where rankings are remembered; without it, Jev is asked every time. */
    cache?: SuggestionStore;
}

/**
 * What a Book offers when Report opens: its suggestions ({@link readSuggestions}), or, when it
 * has no reports at all (empty, or with nothing to report on), none and its problem, with no
 * balances read and no Jev.
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
 * The suggestions of {@link buildSuggestions}, in Jev's order ({@link suggestionOrder}), each
 * with the period a request for it that names none reads (`readReport`): this year when it has
 * movements, else the last year with them, after one query of the history of the suggested
 * report (none for a position today, which never moves). The report's own queries are the ones
 * its intent then reads, so they are cached for it. A suggestion whose balances cannot be read
 * keeps its default period: its report tells.
 */
export async function readSuggestions(
    snapshot: Snapshot,
    lang: string,
    options: SuggestionOptions
): Promise<Suggestion[]> {
    const order = await suggestionOrder(snapshot, options);
    const suggestions = await options.timing.measure('compute', async () =>
        buildSuggestions(snapshot, lang, order)
    );
    return Promise.all(
        suggestions.map(async suggestion => {
            if (suggestion.intent.period.span === 'now') {
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
 * The suggestion of {@link readSuggestions} in `lang` whose text the request is, whitespace
 * runs as one space and trimmed; case kept, as it tells apart names of the Book written alike
 * but for it (`report-shared/names`). Only a request a candidate could be written as (in the
 * default period, or a year the request writes) reads the suggestions, so any other costs
 * nothing more.
 */
export async function findSuggestion(
    prompt: string,
    snapshot: Snapshot,
    lang: string,
    options: SuggestionOptions
): Promise<Suggestion | undefined> {
    const text = sameText(prompt);
    if (!couldSuggest(text, snapshot, lang)) {
        return undefined;
    }
    const suggestions = await readSuggestions(snapshot, lang, options);
    return suggestions.find(suggestion => sameText(suggestion.text) === text);
}

/** Whether a candidate's text, in its default period or a year `text` writes, is `text`. */
function couldSuggest(text: string, snapshot: Snapshot, lang: string): boolean {
    const years = findWrittenYears(text);
    return suggestionCandidates(snapshot).some(({ intent }) =>
        [
            intent,
            ...years.map(year => ({ ...intent, period: { span: 'year' as const, year } })),
        ].some(each => sameText(suggestionText(snapshot, each, lang)) === text)
    );
}

/** A request by its words, however spaced. */
function sameText(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
}

/**
 * Up to {@link SUGGESTION_COUNT} suggestions, at the default periods (activity this year, a
 * position today): the candidates in `order` (their ids, the most important first), then those
 * it leaves out in Book order, skipping any that would show the same as one already suggested
 * ({@link alike}).
 */
export function buildSuggestions(
    snapshot: Snapshot,
    lang: string,
    order: readonly string[] = []
): Suggestion[] {
    const candidates = suggestionCandidates(snapshot);
    const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const ranked = [
        ...order.map(id => byId.get(id)).filter(candidate => candidate !== undefined),
        ...candidates.filter(candidate => !order.includes(candidate.id)),
    ];
    const chosen: SuggestionCandidate[] = [];
    for (const candidate of ranked) {
        if (chosen.length === SUGGESTION_COUNT) {
            break;
        }
        if (!chosen.some(other => other === candidate || alike(other, candidate))) {
            chosen.push(candidate);
        }
    }
    return chosen.map(({ intent }) => ({ text: suggestionText(snapshot, intent, lang), intent }));
}

/**
 * Whether two candidates would show the same: one group directly under the other, or groups of
 * the same nature sharing accounts. Income and expenses together share accounts with their
 * expenses, but are another report.
 */
function alike(a: SuggestionCandidate, b: SuggestionCandidate): boolean {
    if (a.group?.parent === b.id || b.group?.parent === a.id) {
        return true;
    }
    const nature = (candidate: SuggestionCandidate) =>
        candidate.group ? `${candidate.group.type}:${candidate.group.permanent}` : 'net';
    return nature(a) === nature(b) && a.accounts.some(id => b.accounts.includes(id));
}

/**
 * The reports a Book offers as suggestions, in Book order: each root group and each group
 * directly under it, as the person sees them in the Book, with transactions posted to accounts
 * under them, and the net result Report calculates when no group of the Book combines Incoming
 * and Outgoing. Groups the Book hides, and those under them, are left out, and so are groups
 * whose reports would be refused for mixing balances with activity. At most
 * {@link MAX_CANDIDATES}: the largest, ties in Book order.
 */
export function suggestionCandidates(snapshot: Snapshot): SuggestionCandidate[] {
    const candidates: SuggestionCandidate[] = [];
    const offer = (group: SnapshotGroup, root?: SnapshotGroup): void => {
        const accounts = postedAccounts(snapshot, [group]);
        if (accounts.length > 0 && !mixedGroupProblem(snapshot, group.id)) {
            candidates.push({ id: group.id, group, intent: naturalIntent(group, root), accounts });
        }
    };
    for (const root of snapshot.roots.map(id => snapshot.groups[id])) {
        if (root.hidden) {
            continue;
        }
        offer(root);
        for (const child of root.groups.map(id => snapshot.groups[id])) {
            if (!child.hidden) {
                offer(child, root);
            }
        }
    }
    const net = calculatedNetResult(snapshot);
    if (net) {
        candidates.push(net);
    }
    if (candidates.length <= MAX_CANDIDATES) {
        return candidates;
    }
    const largest = new Set(
        // A stable sort: ties keep Book order.
        [...candidates]
            .sort((a, b) => b.accounts.length - a.accounts.length)
            .slice(0, MAX_CANDIDATES)
    );
    return candidates.filter(candidate => largest.has(candidate));
}

/** This year, relative: it stays this year whenever the suggestion is chosen. */
const THIS_YEAR: PeriodParts = { span: 'year', year: 'current' };

/** A balance now. */
const NOW: PeriodParts = { span: 'now' };

/**
 * How a group is best seen: a position today; income and expenses together (a profit and loss)
 * in total this year; income or expenses alone by month this year.
 */
function naturalIntent(group: SnapshotGroup, root?: SnapshotGroup): ReportIntent {
    const subject = root ? { root: root.id, target: group.id } : { root: group.id };
    if (group.permanent) {
        return { ...subject, period: NOW, monthly: false };
    }
    return { ...subject, period: THIS_YEAR, monthly: group.type !== 'MIXED' };
}

/**
 * The net result Report calculates from separate Incoming and Outgoing roots, when the Book has
 * no group that combines them and holds both sides; a Book's own group stands for it otherwise.
 */
function calculatedNetResult(snapshot: Snapshot): SuggestionCandidate | undefined {
    const net = netResultOf(snapshot);
    if (net.kind !== 'calculated') {
        return undefined;
    }
    const accounts = postedAccounts(
        snapshot,
        [...net.incoming, ...net.outgoing].map(id => snapshot.groups[id])
    );
    const types = new Set(accounts.map(id => snapshot.accounts[id].type));
    if (!types.has('INCOMING') || !types.has('OUTGOING')) {
        return undefined;
    }
    return {
        id: NET_RESULT_ROOT,
        intent: { root: NET_RESULT_ROOT, period: THIS_YEAR, monthly: false },
        accounts,
    };
}

/** The accounts under groups, at any depth, each once, with transactions posted and not archived. */
function postedAccounts(snapshot: Snapshot, groups: SnapshotGroup[]): string[] {
    const accounts = new Set<string>();
    const collect = (node: SnapshotGroup): void => {
        node.accounts.forEach(id => accounts.add(id));
        node.groups.forEach(id => collect(snapshot.groups[id]));
    };
    groups.forEach(collect);
    return [...accounts].filter(id => {
        const account = snapshot.accounts[id];
        return account.posted && !account.archived;
    });
}

/**
 * The candidates' ids, the one the person most wants first, as Jev ranks them; remembered by
 * what Jev is asked, so the same map is ranked once. Undefined when there is nothing to rank or
 * Jev fails: the suggestions then follow Book order, and nothing is remembered.
 */
async function suggestionOrder(
    snapshot: Snapshot,
    options: SuggestionOptions
): Promise<string[] | undefined> {
    const candidates = suggestionCandidates(snapshot);
    if (candidates.length < 2) {
        return undefined;
    }
    const { request, options: offered } = buildSuggestionRequest(snapshot, candidates);
    const { cache, timing } = options;
    const key = `suggestion-order:v1:${await digest(JSON.stringify({ request, offered }))}`;
    const cached = cache ? await timing.measure('kv', () => cache.get(key)) : null;
    const remembered = cached === null ? undefined : idsOf(cached);
    if (remembered) {
        return remembered;
    }
    try {
        const { answers } = await timing.measure('jev', () => decide(options.decisions, request));
        const order = rankedIds(offered, answers.first.probabilities);
        if (cache) {
            await timing.measure('kv', () =>
                cache.put(key, JSON.stringify(order), {
                    expirationTtl: SUGGESTION_ORDER_TTL_SECONDS,
                })
            );
        }
        return order;
    } catch {
        return undefined;
    }
}

/** The offered candidates' ids, the most probable first; ties keep Book order. */
export function rankedIds(
    offered: { label: string; id: string }[],
    probabilities: Readonly<Record<string, number>>
): string[] {
    const chance = (label: string) => probabilities[label] ?? 0;
    // A stable sort.
    return [...offered].sort((a, b) => chance(b.label) - chance(a.label)).map(option => option.id);
}

/** A remembered order, when it is one. */
function idsOf(value: string): string[] | undefined {
    try {
        const ids: unknown = JSON.parse(value);
        return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? ids : undefined;
    } catch {
        return undefined;
    }
}

async function digest(text: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The request a person would type for a suggestion's intent, naming its period. */
function suggestionText(snapshot: Snapshot, intent: ReportIntent, lang: string): string {
    if (intent.root === NET_RESULT_ROOT) {
        return netText(intent.period, lang);
    }
    return textOf(snapshot.groups[intent.target ?? intent.root], intent, lang);
}

/**
 * A group's activity this year or in a written year, by month or not, or its position today: a
 * relative period in relative words, a written year as written.
 */
function textOf(group: SnapshotGroup, { period, monthly }: ReportIntent, lang: string): string {
    const thisYear = period.year === 'current';
    const key: StringKey = group.permanent
        ? 'suggestion_position_today'
        : monthly
          ? thisYear
              ? 'suggestion_monthly_this_year'
              : 'suggestion_monthly_year'
          : thisYear
            ? 'suggestion_breakdown_this_year'
            : 'suggestion_breakdown_year';
    return t(key, lang, { root: group.name, year: String(period.year) });
}

/** The net result this year or in a written year. */
function netText(period: PeriodParts, lang: string): string {
    return period.year === 'current'
        ? t('suggestion_net_result_this_year', lang)
        : t('suggestion_net_result_year', lang, { year: String(period.year) });
}
