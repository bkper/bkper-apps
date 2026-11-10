/**
 * What the decision model is asked about a report request, and how sure it must be.
 *
 * Every question, criterion and threshold of intent resolution lives here, but those of the
 * period, which `period-questions.ts` asks as small judgments of their own, so they can be
 * reviewed and tuned together. The model only chooses among options this code offers (the
 * Book's root groups, the groups and accounts below them, the chart words, the languages) and
 * answers
 * yes or no to small recognition questions about how the request asks to see the amounts; it
 * never sees amounts, computes dates or writes queries. Each question stands alone: none
 * refers to another or says when not to answer yes, since code combines the answers
 * (`intent-resolver.ts`). Question ids are not sent to the model, so each instruction refers to
 * the state fields in backticks.
 *
 * Groups the Book hides, and everything under them, are never offered: the people who keep the
 * Book hide closing or working groups, which are no report they mean. A request that writes a
 * hidden group's name still finds it (`prompt-names.ts`).
 */
import type { ChoiceQuestion, NoulQuestion, SystemOneRequest } from '@typesafe-ai/sdk';
import { LANGUAGES } from 'report-shared/languages';
import {
    UNSPECIFIED,
    YEAR_EARLIER_QUESTION,
    buildPeriodQuestions,
    type PeriodQuestions,
} from './period-questions.js';
import { NET_RESULT_ROOT } from './report-intent.js';
import type { Snapshot, SnapshotAccount, SnapshotGroup } from './snapshot.js';

/** How sure the model must be before an answer is used. */
export const THRESHOLDS = {
    /** Below it, or on `none`, the request is not a report of this Book. */
    root: 0.5,
    /**
     * Below it, or on `whole`, the report is of the root, not of a group or account below it.
     * Between the two in the intent evaluation: the targets requests single out scored 0.83 or
     * more, and those Jev chose for a request of a whole root 0.54 or less.
     */
    target: 0.7,
    /** The probability of yes from which the request asks how amounts change over time. */
    over_time: 0.5,
    /** The probability of yes from which the request asks what makes up the amount. */
    composition: 0.5,
    /** The probability of yes from which the request compares with an earlier period. */
    versus_earlier: 0.5,
    /** The probability of yes from which the request asks how one amount leads to another. */
    bridge: 0.5,
    /** Below it, the request names no chart. */
    chart_named: 0.5,
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
/** The target answer for a request of a root as a whole, or of nothing below one. */
export const WHOLE = 'whole';
export { UNSPECIFIED };

const NET_RESULT_CRITERION =
    'Income versus expenses: profit or loss, the net result, the bottom line, how much was earned minus how much was spent.';

const NO_ROOT_CRITERION =
    'None of these: `request` is not asking about money in this Book, or names something not listed.';

const ROOT_INSTRUCTIONS =
    'Which group of the Book does `request` ask a financial report about? `request` may be in any language: match by meaning, against a group or anything it contains. Words starting with # in `request` are filters; ignore them here.';

const TARGET_INSTRUCTIONS =
    'Which group or account inside a larger group of the Book does `request` single out, by its name or by what it is, such as a kind of expense, a client, a supplier or a bank? `request` may be in any language: match by meaning, as words of money mean in bookkeeping, such as receitas, ingresos, Einnahmen, 収入 or إيرادات for money received, and despesas, gastos, Ausgaben, 費用 or مصروفات for money spent. Words starting with # in `request` are filters; ignore them here.';

const WHOLE_CRITERION =
    'None of these: `request` asks about a top-level group as a whole, by its name or by what it holds, such as all revenue, all expenses, all debts, all investors or all employees, the profit or the net result, or singles out nothing listed here.';

const OVER_TIME_INSTRUCTIONS =
    'Does `request` ask to see the amounts month by month, such as monthly amounts, how they evolve or a timeline?';

const COMPOSITION_INSTRUCTIONS =
    'Does `request` ask for the amount broken down into its parts, such as by category or by client, the share of each or the biggest items?';

const VERSUS_EARLIER_INSTRUCTIONS =
    'Does `request` ask to compare the amounts with an earlier period it names, such as last year, the year before or the previous month?';

const BRIDGE_INSTRUCTIONS =
    'Does `request` ask how one amount leads to another, step by step, such as from revenue through each expense to profit, or from an opening to a closing balance?';

const CHART_NAMED_INSTRUCTIONS = 'Which kind of chart does `request` name, in any language?';

/** The answer for a request that names no chart. */
export const NO_CHART = 'none';

/** The chart words a request may use, each standing for a kind of chart. */
export const CHART_WORDS = [
    'pie',
    'bars',
    'line',
    'area',
    'stacked',
    'waterfall',
    'table',
] as const;

export type ChartWord = (typeof CHART_WORDS)[number];

export const CHART_NAMED_CRITERIA = {
    pie: 'A pie or donut chart, drawn as slices. Such as "pie", "as a pie", "pizza", "em pizza", "gráfico de tarta", "Tortendiagramm", "en camembert", "円グラフ", "饼图", "دائري", "donut".',
    bars: 'A bar or column chart. Such as "in bars", "em barras", "en barras", "als Balken", "en barres", "棒グラフ", "柱状图", "أعمدة".',
    line: 'A line chart. Such as "as a line", "em linha", "gráfico de líneas", "Liniendiagramm", "en courbe", "折れ線グラフ", "折线图", "خطي".',
    area: 'An area chart, drawn as a filled area. Such as "as an area chart", "gráfico de área", "Flächendiagramm", "en aires", "面グラフ", "面积图", "مساحي".',
    stacked:
        'Stacked bars or columns, the parts piled on each other. Such as "stacked", "empilhadas", "apiladas", "gestapelt", "empilées", "積み上げ", "堆积", "مكدسة".',
    waterfall:
        'A waterfall or bridge chart. Such as "waterfall", "bridge", "em cascata", "en cascada", "Wasserfalldiagramm", "en cascade", "ウォーターフォール", "瀑布图", "شلالي".',
    table: 'No chart, only the numbers: a table or a list. Such as "just the numbers", "só a tabela", "sin gráfico", "nur die Zahlen", "表だけ", "只要表格", "الأرقام فقط".',
    [NO_CHART]: '`request` names no kind of chart and does not ask for the numbers alone.',
} as const satisfies Record<ChartWord | typeof NO_CHART, string>;

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

/** How each nature reads in a target's description, short as targets are many. */
const SHORT_NATURES = {
    ASSET: 'Asset: owned.',
    LIABILITY: 'Liability: owed.',
    INCOMING: 'Incoming: money received.',
    OUTGOING: 'Outgoing: money spent.',
    MIXED_PERMANENT: 'Assets and liabilities together.',
    MIXED_ACTIVITY: 'Money received and spent together.',
} as const;

type Criteria = Record<string, string>;

export type IntentQuestions = {
    root: ChoiceQuestion<Criteria>;
    target: ChoiceQuestion<Criteria>;
    over_time: NoulQuestion;
    composition: NoulQuestion;
    versus_earlier: NoulQuestion;
    year_earlier: NoulQuestion;
    bridge: NoulQuestion;
    chart_named: ChoiceQuestion<typeof CHART_NAMED_CRITERIA>;
    language: ChoiceQuestion<Criteria>;
} & PeriodQuestions;

/** What a target option stands for: a group or account, and the root groups holding it. */
export interface TargetOption {
    id: string;
    /** The root groups the Book shows that hold it, at any depth, in Book order. */
    roots: string[];
}

/** What the options of the subject's questions stand for, to read their answers. */
export interface IntentOptions {
    /** What each root option stands for: a root group id, {@link NET_RESULT_ROOT} or {@link NO_ROOT}. */
    roots: Record<string, string>;
    /** What each target option stands for; {@link WHOLE} stands for none. */
    targets: Record<string, TargetOption>;
}

export interface IntentRequest extends IntentOptions {
    request: SystemOneRequest<IntentQuestions>;
}

/**
 * The decision request of a report request against a Book snapshot: what it is about and how to
 * show it, then its period, asked as the questions of `period-questions.ts`.
 */
export function buildIntentRequest(prompt: string, snapshot: Snapshot): IntentRequest {
    const roots = rootOptions(snapshot);
    const targets = targetOptions(snapshot);
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
                target: {
                    type: 'choice',
                    instructions: TARGET_INSTRUCTIONS,
                    criteria: Object.fromEntries(
                        targets.map(option => [option.label, option.description])
                    ),
                },
                over_time: { type: 'noul', instructions: OVER_TIME_INSTRUCTIONS },
                composition: { type: 'noul', instructions: COMPOSITION_INSTRUCTIONS },
                versus_earlier: { type: 'noul', instructions: VERSUS_EARLIER_INSTRUCTIONS },
                year_earlier: YEAR_EARLIER_QUESTION,
                bridge: { type: 'noul', instructions: BRIDGE_INSTRUCTIONS },
                chart_named: {
                    type: 'choice',
                    instructions: CHART_NAMED_INSTRUCTIONS,
                    criteria: CHART_NAMED_CRITERIA,
                },
                language: {
                    type: 'choice',
                    instructions: LANGUAGE_INSTRUCTIONS,
                    criteria: LANGUAGE_CRITERIA,
                },
                ...buildPeriodQuestions(prompt),
            },
        },
        roots: Object.fromEntries(roots.map(option => [option.label, option.target])),
        targets: Object.fromEntries(
            targets.flatMap(option => (option.target ? [[option.label, option.target]] : []))
        ),
    };
}

interface RootOption {
    label: string;
    target: string;
    description: string;
}

/** The root groups the Book shows, in Book order. */
function shownRoots(snapshot: Snapshot): SnapshotGroup[] {
    return snapshot.roots.map(id => snapshot.groups[id]).filter(group => !group.hidden);
}

function rootOptions(snapshot: Snapshot): RootOption[] {
    const groups = shownRoots(snapshot);
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
    const taken = new Set(special.map(option => option.label.toLowerCase()));
    const names = Math.min(MAX_NAMES_PER_ROOT, Math.floor(MAX_NAMES / Math.max(1, groups.length)));
    const options = groups.slice(0, MAX_CHOICE_OPTIONS - special.length).map(group => ({
        label: uniqueLabel(group.name, taken),
        target: group.id,
        description: describeRoot(group, snapshot, names),
    }));
    return [...options, ...special];
}

interface TargetChoice {
    label: string;
    description: string;
    /** Absent for {@link WHOLE}. */
    target?: TargetOption;
}

/**
 * The groups and accounts below the root groups, as the person sees them in the Book: none the
 * Book hides, nor under one, and only those with an account with transactions posted and not
 * archived (the accounts themselves, and groups holding one at any depth). Groups first, then
 * accounts, each in Book order (root groups in order, each with its subgroups, then its
 * accounts), each once; at most {@link MAX_CHOICE_OPTIONS} with {@link WHOLE}, last. Accounts in
 * no group are roots of their own and none is offered here: their names, written, find them.
 */
function targetOptions(snapshot: Snapshot): TargetChoice[] {
    const groups: TargetNode[] = [];
    const accounts = new Map<string, TargetNode>();
    for (const root of shownRoots(snapshot)) {
        // Whether the group holds an offered account, at any depth. A group is offered before its
        // subgroups, and taken back when it holds none (its subgroups, holding none, already are).
        const visit = (group: SnapshotGroup, path: string[]): boolean => {
            const inside = [...path, group.name];
            if (group.id !== root.id) {
                groups.push({ id: group.id, kind: 'Group', node: group, path, roots: [root.id] });
            }
            let holds = false;
            for (const id of group.groups) {
                const child = snapshot.groups[id];
                if (child && !child.hidden && visit(child, inside)) {
                    holds = true;
                }
            }
            for (const id of group.accounts) {
                const account = snapshot.accounts[id];
                if (!account?.posted || account.archived) {
                    continue;
                }
                holds = true;
                const known = accounts.get(id);
                if (!known) {
                    accounts.set(id, {
                        id,
                        kind: 'Account',
                        node: account,
                        path: inside,
                        roots: [root.id],
                    });
                } else if (!known.roots.includes(root.id)) {
                    known.roots.push(root.id);
                }
            }
            if (!holds && group.id !== root.id) {
                groups.pop();
            }
            return holds;
        };
        visit(root, []);
    }
    const taken = new Set([WHOLE]);
    const options: TargetChoice[] = [...groups, ...accounts.values()]
        .slice(0, MAX_CHOICE_OPTIONS - 1)
        .map(entry => ({
            label: uniqueLabel(entry.node.name, taken),
            description: `${entry.kind} in ${place(entry.path)}. ${shortNature(entry.node)}`,
            target: { id: entry.id, roots: entry.roots },
        }));
    return [...options, { label: WHOLE, description: WHOLE_CRITERION }];
}

interface TargetNode {
    id: string;
    kind: 'Group' | 'Account';
    node: SnapshotGroup | SnapshotAccount;
    /** The names of the groups it is in, from its root: of the first in Book order. */
    path: string[];
    roots: string[];
}

/**
 * Where a target is: its root and the group it is in, with `…` between them when deeper, so a
 * description stays short however deep the Book's groups go.
 */
function place(path: string[]): string {
    const names = path.map(truncate);
    return (names.length > 2 ? [names[0], '…', names.at(-1)] : names).join(' › ');
}

function shortNature(node: SnapshotGroup | SnapshotAccount): string {
    if (node.type === 'MIXED') {
        return node.permanent ? SHORT_NATURES.MIXED_PERMANENT : SHORT_NATURES.MIXED_ACTIVITY;
    }
    return SHORT_NATURES[node.type];
}

/**
 * A choice label for a name, unique among those `taken` (which it joins), ignoring case: a group
 * may be named like a special option, or two long names may truncate alike.
 */
export function uniqueLabel(name: string, taken: Set<string>): string {
    const truncated = truncate(name);
    let label = truncated;
    for (let n = 2; taken.has(label.toLowerCase()); n++) {
        label = `${truncated} (${n})`;
    }
    taken.add(label.toLowerCase());
    return label;
}

function describeRoot(root: SnapshotGroup, snapshot: Snapshot, limit: number): string {
    const names = descendantNames(root, snapshot).slice(0, limit);
    const contents = names.length > 0 ? ` Contains: ${names.join(', ')}.` : '';
    return `${natureDescription(root)}${contents}`;
}

/** How a group's nature reads to a person asking for a report. */
export function natureDescription(group: SnapshotGroup): string {
    if (group.type === 'MIXED') {
        return group.permanent
            ? NATURE_DESCRIPTIONS.MIXED_PERMANENT
            : NATURE_DESCRIPTIONS.MIXED_ACTIVITY;
    }
    return NATURE_DESCRIPTIONS[group.type];
}

/** Subgroups before accounts, level by level, each name once. */
export function descendantNames(root: SnapshotGroup, snapshot: Snapshot): string[] {
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

function truncate(name: string): string {
    return name.slice(0, MAX_NAME_CHARACTERS);
}
