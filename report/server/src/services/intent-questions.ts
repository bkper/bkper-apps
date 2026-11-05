/**
 * What the decision model is asked about a report request, and how sure it must be.
 *
 * Every question, criterion and threshold of intent resolution lives here, so they can be
 * reviewed and tuned together. The model only chooses among options this code offers (the
 * Book's root groups, the periods within its data, the views, the languages); it never sees
 * amounts, computes dates or writes queries. Question ids are not sent to the model, so each
 * instruction stands alone and refers to the state fields in backticks.
 */
import type { ChoiceQuestion, NoulQuestion, SystemOneRequest } from '@typesafe-ai/sdk';
import { LANGUAGES } from 'report-shared/languages';
import { buildPeriodOptions } from './periods.js';
import { NET_RESULT_ROOT, type ReportView } from './report-intent.js';
import type { Snapshot, SnapshotGroup } from './snapshot.js';

/** How sure the model must be before an answer is used. */
export const THRESHOLDS = {
    /** Below it, or on `none`, the request is not a report of this Book. */
    root: 0.5,
    /** Below it, the request reads the default period. */
    period: 0.5,
    /** The probability of yes from which the report shows months. */
    monthly: 0.5,
    /** Below it, the report picks its layout by rules. */
    view: 0.5,
    /** Below it, the detected language is not used. */
    language: 0.8,
} as const;

/** Longest request text sent to the model. */
export const MAX_REQUEST_CHARACTERS = 500;
/**
 * Names of subgroups and accounts described to the model: up to 60 per root, fewer when the
 * Book has many roots, so the request stays well within the model's input limit.
 */
const MAX_NAMES_PER_ROOT = 60;
const MAX_NAMES = 1_500;
const MAX_NAME_CHARACTERS = 60;
/** A choice offers at most 255 options, including the special ones (`none`, `unspecified`, …). */
const MAX_CHOICE_OPTIONS = 255;

/** The root answer for a request that is not a report of this Book. */
export const NO_ROOT = 'none';
/** The period and view answer for a request that names none. */
export const UNSPECIFIED = 'unspecified';

const NET_RESULT_CRITERION =
    'Income versus expenses: profit or loss, the net result, the bottom line, how much was earned minus how much was spent.';

const NO_ROOT_CRITERION =
    'None of these: `request` is not asking about money in this Book, or names something not listed.';

const ROOT_INSTRUCTIONS =
    'Which group of the Book does `request` ask a financial report about? `request` may be in any language: match by meaning, against a group or anything it contains. Words starting with # in `request` are filters; ignore them here.';

const PERIOD_INSTRUCTIONS =
    'Which period of time does `request` ask about? `today` is the current date. Choose `unspecified` when `request` names no date, year, month, quarter or period; words such as monthly, by month or over time say how to show the amounts, not which period.';

const UNSPECIFIED_PERIOD_CRITERION = '`request` names no date, year, month, quarter or period.';

const MONTHLY_INSTRUCTIONS =
    'Does `request` ask to see the amounts month by month, or how they evolve over time?';

const VIEW_INSTRUCTIONS =
    'How does `request` explicitly ask to see the amounts? Choose `unspecified` when `request` only says what and when, without asking how to show it.';

export const VIEW_CRITERIA = {
    trend: 'Over time: `request` asks for monthly amounts, month by month, their evolution, a history or a timeline.',
    breakdown:
        'Broken down: `request` asks what makes them up, by category, account or item, the biggest items, a ranking or the share of each.',
    total: 'One total: `request` is a question answered by a single number, such as how much in all or what the balance is.',
    [UNSPECIFIED]: '`request` does not say how to show the amounts.',
} as const satisfies Record<ReportView | typeof UNSPECIFIED, string>;

const LANGUAGE_INSTRUCTIONS = 'In which language is `request` written?';

const LANGUAGE_CRITERIA: Record<string, string> = Object.fromEntries(
    LANGUAGES.map(language => [
        language.code,
        language.name === language.english
            ? language.english
            : `${language.english} (${language.name})`,
    ])
);

/** How each group nature reads to a person asking for a report. */
const NATURE_DESCRIPTIONS = {
    ASSET: 'Assets: what is owned, such as the balances of bank accounts, cash, receivables and investments.',
    LIABILITY:
        'Liabilities: what is owed, such as debts, loans, credit cards, payables and capital from investors.',
    INCOMING: 'Incoming: money received, such as revenue, income, sales and earnings.',
    OUTGOING: 'Outgoing: money spent, such as expenses, costs, payments and spending.',
    MIXED_PERMANENT: 'Assets and liabilities together, such as equity or net worth.',
    MIXED_ACTIVITY: 'Money received and spent together, such as net income or profit.',
} as const;

type Criteria = Record<string, string>;

export type IntentQuestions = {
    root: ChoiceQuestion<Criteria>;
    period: ChoiceQuestion<Criteria>;
    monthly: NoulQuestion;
    view: ChoiceQuestion<typeof VIEW_CRITERIA>;
    language: ChoiceQuestion<Criteria>;
};

export interface IntentRequest {
    request: SystemOneRequest<IntentQuestions>;
    /** What each root option stands for: a root group id, {@link NET_RESULT_ROOT} or {@link NO_ROOT}. */
    roots: Record<string, string>;
}

/** The decision request of a report request against a Book snapshot. */
export function buildIntentRequest(prompt: string, snapshot: Snapshot): IntentRequest {
    const roots = rootOptions(snapshot);
    return {
        request: {
            state: { request: prompt.slice(0, MAX_REQUEST_CHARACTERS), today: snapshot.today },
            questions: {
                root: {
                    type: 'choice',
                    instructions: ROOT_INSTRUCTIONS,
                    criteria: Object.fromEntries(
                        roots.map(option => [option.label, option.description])
                    ),
                },
                period: {
                    type: 'choice',
                    instructions: PERIOD_INSTRUCTIONS,
                    criteria: periodCriteria(snapshot),
                },
                monthly: { type: 'noul', instructions: MONTHLY_INSTRUCTIONS },
                view: { type: 'choice', instructions: VIEW_INSTRUCTIONS, criteria: VIEW_CRITERIA },
                language: {
                    type: 'choice',
                    instructions: LANGUAGE_INSTRUCTIONS,
                    criteria: LANGUAGE_CRITERIA,
                },
            },
        },
        roots: Object.fromEntries(roots.map(option => [option.label, option.target])),
    };
}

interface RootOption {
    label: string;
    target: string;
    description: string;
}

function rootOptions(snapshot: Snapshot): RootOption[] {
    const groups = snapshot.roots.map(id => snapshot.groups[id]);
    const special: RootOption[] = [
        { label: NO_ROOT, target: NO_ROOT, description: NO_ROOT_CRITERION },
    ];
    if (groups.some(group => !group.permanent)) {
        special.unshift({
            label: NET_RESULT_ROOT,
            target: NET_RESULT_ROOT,
            description: NET_RESULT_CRITERION,
        });
    }
    // Labels must be unique: a group may be named like a special option, or two long names
    // may truncate alike.
    const taken = new Set(special.map(option => option.label.toLowerCase()));
    const names = Math.min(MAX_NAMES_PER_ROOT, Math.floor(MAX_NAMES / Math.max(1, groups.length)));
    const options = groups.slice(0, MAX_CHOICE_OPTIONS - special.length).map(group => {
        const name = truncate(group.name);
        let label = name;
        for (let n = 2; taken.has(label.toLowerCase()); n++) {
            label = `${name} (${n})`;
        }
        taken.add(label.toLowerCase());
        return { label, target: group.id, description: describeRoot(group, snapshot, names) };
    });
    return [...options, ...special];
}

function describeRoot(root: SnapshotGroup, snapshot: Snapshot, limit: number): string {
    const names = descendantNames(root, snapshot).slice(0, limit);
    const contents = names.length > 0 ? ` Contains: ${names.join(', ')}.` : '';
    return `${natureDescription(root)}${contents}`;
}

function natureDescription(group: SnapshotGroup): string {
    if (group.type === 'MIXED') {
        return group.permanent
            ? NATURE_DESCRIPTIONS.MIXED_PERMANENT
            : NATURE_DESCRIPTIONS.MIXED_ACTIVITY;
    }
    return NATURE_DESCRIPTIONS[group.type];
}

/** Subgroups before accounts, level by level, each name once. */
function descendantNames(root: SnapshotGroup, snapshot: Snapshot): string[] {
    const names = new Set<string>();
    const queue = [root];
    for (let group = queue.shift(); group; group = queue.shift()) {
        for (const id of group.groups) {
            const child = snapshot.groups[id];
            if (child) {
                names.add(truncate(child.name));
                queue.push(child);
            }
        }
        for (const id of group.accounts) {
            const account = snapshot.accounts[id];
            if (account) {
                names.add(truncate(account.name));
            }
        }
    }
    return [...names];
}

function periodCriteria(snapshot: Snapshot): Criteria {
    const { today, dataRange } = snapshot;
    const options = buildPeriodOptions({ today, dataRange }).slice(0, MAX_CHOICE_OPTIONS - 1);
    return {
        ...Object.fromEntries(options.map(option => [option.id, option.description])),
        [UNSPECIFIED]: UNSPECIFIED_PERIOD_CRITERION,
    };
}

function truncate(name: string): string {
    return name.slice(0, MAX_NAME_CHARACTERS);
}
