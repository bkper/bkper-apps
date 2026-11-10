/**
 * What the decision model is asked to order a Book's suggestions: ONE choice among the reports
 * the Book offers (`suggestionCandidates`), whose probabilities rank them all, so the report a
 * person most wants comes first. The model sees the Book's name and, for each report, how much
 * of the Book it holds (its share of the accounts with transactions posted, first, so a small
 * group reads as small whatever its name), its group's name, where the group sits, its nature and
 * how the report shows it: never an amount. Code chooses the candidates and what to do with the ranking.
 */
import type { ChoiceQuestion, SystemOneRequest } from '@typesafe-ai/sdk';
import { descendantNames, natureDescription, uniqueLabel } from './intent-questions.js';
import { NET_RESULT_ROOT, type ReportIntent } from './report-intent.js';
import type { Snapshot, SnapshotGroup } from './snapshot.js';

/** A report the Book offers as a suggestion: of a group, or the net result Report calculates. */
export interface SuggestionCandidate {
    /** The group's id, or {@link NET_RESULT_ROOT}. */
    id: string;
    /** The group; absent for the net result. */
    group?: SnapshotGroup;
    intent: ReportIntent;
    /** The accounts under it, at any depth, with transactions posted and not archived. */
    accounts: readonly string[];
}

const FIRST_INSTRUCTIONS =
    'Which of these reports is the main one of the Book `book`, the one the people keeping it check first to see how they are doing?';

const NET_RESULT_DESCRIPTION =
    'Income versus expenses: the net result of the Book, how much was earned minus how much was spent.';

/** Names of what a group contains, told so the model knows what it holds. */
const MAX_CONTENTS = 8;

type Criteria = Record<string, string>;

export type SuggestionQuestions = { first: ChoiceQuestion<Criteria> };

export interface SuggestionRequest {
    request: SystemOneRequest<SuggestionQuestions>;
    /** Each option's label and the candidate it stands for, in the order offered. */
    options: { label: string; id: string }[];
}

/** The decision request that ranks the candidates of a Book, offered in their order. */
export function buildSuggestionRequest(
    snapshot: Snapshot,
    candidates: SuggestionCandidate[]
): SuggestionRequest {
    const taken = new Set<string>();
    const total = bookAccounts(snapshot);
    const options = candidates.map(candidate => ({
        label: uniqueLabel(candidate.group?.name ?? 'Net result', taken),
        id: candidate.id,
        description: describe(snapshot, candidate, total),
    }));
    return {
        request: {
            state: { book: snapshot.book.name },
            questions: {
                first: {
                    type: 'choice',
                    instructions: FIRST_INSTRUCTIONS,
                    criteria: Object.fromEntries(
                        options.map(option => [option.label, option.description])
                    ),
                },
            },
        },
        options: options.map(({ label, id }) => ({ label, id })),
    };
}

/** The Book's accounts with transactions posted that are not archived, in groups or not. */
function bookAccounts(snapshot: Snapshot): number {
    return [...Object.values(snapshot.accounts), ...Object.values(snapshot.ungrouped)].filter(
        account => account.posted && !account.archived
    ).length;
}

/** What a candidate is: how much it holds, its nature, where it sits and how it is shown. */
function describe(
    snapshot: Snapshot,
    { group, intent, accounts }: SuggestionCandidate,
    total: number
): string {
    const share = `Holds ${Math.max(1, Math.round((100 * accounts.length) / Math.max(1, total)))}% of the Book's accounts.`;
    if (!group || intent.root === NET_RESULT_ROOT) {
        return `${share} ${NET_RESULT_DESCRIPTION} Its total this year.`;
    }
    const parent = group.parent === undefined ? undefined : snapshot.groups[group.parent];
    const place = parent ? `Part of ${parent.name}.` : 'A top-level group.';
    const shown =
        intent.period.span === 'now'
            ? 'Its balance today'
            : intent.monthly
              ? 'Its amounts by month this year'
              : 'Its total this year';
    const contents = descendantNames(group, snapshot).slice(0, MAX_CONTENTS);
    return [
        share,
        natureDescription(group),
        place,
        `${shown}.`,
        ...(contents.length > 0 ? [`Contains: ${contents.join(', ')}.`] : []),
    ].join(' ');
}
