/**
 * What the decision model is asked about a report request, and how sure it must be.
 *
 * Every question, criterion and threshold of intent resolution lives here, but those of the
 * period, which `period-questions.ts` asks as small judgments of their own, so they can be
 * reviewed and tuned together. The model only chooses among options this code offers (the
 * Book's groups, never its accounts, the chart words, the languages) and answers yes or no to
 * small recognition questions about how the request asks to see the amounts; it never sees
 * amounts, computes dates or writes queries. Each question stands alone: none
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
import type { Snapshot, SnapshotGroup } from './snapshot.js';

/** How sure the model must be before an answer is used. */
export const THRESHOLDS = {
    /**
     * The probability of a root group and everything below it from which the report is of it;
     * below it, or on `none`, the request is not a report of this Book. Also of the net result.
     */
    root: 0.5,
    /**
     * The probability of a group below a root and everything below it from which the report is
     * of it; below it, the report is of the closest group above it that is that sure, else of
     * its root: a broader report that holds what was meant is better than a narrow wrong one.
     */
    group: 0.7,
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
 * Names of accounts described to the model: up to 60 per group, fewer when the Book has many
 * groups, so the request stays well within the model's input limit.
 */
const MAX_NAMES_PER_GROUP = 60;
const MAX_NAMES = 1_500;
const MAX_NAME_CHARACTERS = 60;
/** A choice offers at most 255 options, including the special ones (`none`, `unspecified`, …). */
const MAX_CHOICE_OPTIONS = 255;

/** The answer for a request that is not a report of this Book. */
export const NO_ROOT = 'none';
export { UNSPECIFIED };

const NET_RESULT_CRITERION =
    'Income versus expenses: profit or loss, the net result, the bottom line, how much was earned minus how much was spent.';

const NO_ROOT_CRITERION =
    'None of these: `request` is not asking about money in this Book, or names something not listed.';

const GROUP_INSTRUCTIONS =
    'Which group of the Book does `request` ask a financial report about? Choose the smallest group that holds everything `request` asks about, by its name or by what it holds, such as a kind of expense, the clients, the debts or the banks; a whole group when `request` asks about all of it. `request` may be in any language: match by meaning, as words of money mean in bookkeeping, such as receitas, ingresos, Einnahmen, 収入 or إيرادات for money received, and despesas, gastos, Ausgaben, 費用 or مصروفات for money spent. Words starting with # in `request` are filters; ignore them here.';

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

type Criteria = Record<string, string>;

export type IntentQuestions = {
    group: ChoiceQuestion<Criteria>;
    over_time: NoulQuestion;
    composition: NoulQuestion;
    versus_earlier: NoulQuestion;
    year_earlier: NoulQuestion;
    bridge: NoulQuestion;
    chart_named: ChoiceQuestion<typeof CHART_NAMED_CRITERIA>;
    language: ChoiceQuestion<Criteria>;
} & PeriodQuestions;

/** What a group option stands for, to read the answer. */
export interface GroupOption {
    /** A group id, or {@link NET_RESULT_ROOT}. */
    id: string;
    /** The root group holding it, the group itself for a root; {@link NET_RESULT_ROOT} for it. */
    root: string;
    /** The label of the group option it is in; absent for a root and the net result. */
    parent?: string;
}

/** What the options of the subject's question stand for, to read its answer. */
export interface IntentOptions {
    /** What each group option stands for; {@link NO_ROOT} stands for no report, and is absent. */
    groups: Record<string, GroupOption>;
}

export interface IntentRequest extends IntentOptions {
    request: SystemOneRequest<IntentQuestions>;
}

/**
 * The decision request of a report request against a Book snapshot: what it is about and how to
 * show it, then its period, asked as the questions of `period-questions.ts`.
 */
export function buildIntentRequest(prompt: string, snapshot: Snapshot): IntentRequest {
    const options = groupOptions(snapshot);
    return {
        request: {
            state: { request: prompt.slice(0, MAX_REQUEST_CHARACTERS), today: snapshot.today },
            questions: {
                group: {
                    type: 'choice',
                    instructions: GROUP_INSTRUCTIONS,
                    criteria: Object.fromEntries(
                        options.map(option => [option.label, option.description])
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
        groups: Object.fromEntries(
            options.flatMap(option => (option.group ? [[option.label, option.group]] : []))
        ),
    };
}

interface GroupChoice {
    label: string;
    description: string;
    /** Absent for {@link NO_ROOT}. */
    group?: GroupOption;
}

/** A group the Book shows, offered as an option, and where it is. */
interface OfferedGroup {
    group: SnapshotGroup;
    root: string;
    depth: number;
    /** The offered group it is in; absent for a root. */
    parent?: OfferedGroup;
    /** The accounts it holds, at any depth, with transactions posted and not archived. */
    accounts: Set<string>;
}

/**
 * The options of the subject's question: the root groups the Book shows, in Book order, each
 * followed by the groups below it, at any depth, that hold an account with transactions posted
 * and not archived (each before its own subgroups), then the net result and no report. Never a
 * group the Book hides, nor one under it, and never an account: a request means a group, and an
 * account it means but does not write is a row of the group holding it. At most
 * {@link MAX_CHOICE_OPTIONS}: the deepest groups are left out first, then roots past the limit.
 *
 * Each option is described by its nature and the names of the accounts it holds that no smaller
 * option holds, so every name of the Book is written once in the whole request: a group's own
 * name is its label, and an account is named in the smallest group holding it.
 */
function groupOptions(snapshot: Snapshot): GroupChoice[] {
    const roots = shownRoots(snapshot);
    const special: GroupChoice[] = [{ label: NO_ROOT, description: NO_ROOT_CRITERION }];
    if (roots.some(group => !group.permanent)) {
        special.unshift({
            label: NET_RESULT_ROOT,
            description: NET_RESULT_CRITERION,
            group: { id: NET_RESULT_ROOT, root: NET_RESULT_ROOT },
        });
    }
    const offered = offeredGroups(snapshot, roots, MAX_CHOICE_OPTIONS - special.length);
    const taken = new Set(special.map(option => option.label.toLowerCase()));
    const labels = new Map(offered.map(entry => [entry, uniqueLabel(entry.group.name, taken)]));
    const names = namesOf(offered, snapshot, taken);
    const options = offered.map(entry => {
        const contents = names.get(entry) ?? [];
        const parent = entry.parent && labels.get(entry.parent);
        return {
            label: labels.get(entry) ?? entry.group.name,
            description: `${natureDescription(entry.group)}${contents.length > 0 ? ` Contains: ${contents.join(', ')}.` : ''}`,
            group: {
                id: entry.group.id,
                root: entry.root,
                ...(parent === undefined ? {} : { parent }),
            },
        };
    });
    return [...options, ...special];
}

/** The root groups the Book shows, in Book order. */
function shownRoots(snapshot: Snapshot): SnapshotGroup[] {
    return snapshot.roots.map(id => snapshot.groups[id]).filter(group => !group.hidden);
}

/**
 * The groups offered, in Book order (each root followed by its subgroups, each before its own),
 * at most `limit`: roots first, then the groups one level deeper, and so on, so a group's parent
 * is always offered.
 */
function offeredGroups(snapshot: Snapshot, roots: SnapshotGroup[], limit: number): OfferedGroup[] {
    const all: OfferedGroup[] = [];
    const visit = (group: SnapshotGroup, root: string, parent?: OfferedGroup): OfferedGroup => {
        const entry: OfferedGroup = {
            group,
            root,
            depth: parent ? parent.depth + 1 : 0,
            ...(parent ? { parent } : {}),
            accounts: new Set(),
        };
        all.push(entry);
        for (const id of group.groups) {
            const child = snapshot.groups[id];
            if (child && !child.hidden) {
                for (const account of visit(child, root, entry).accounts) {
                    entry.accounts.add(account);
                }
            }
        }
        for (const id of group.accounts) {
            const account = snapshot.accounts[id];
            if (account?.posted && !account.archived) {
                entry.accounts.add(id);
            }
        }
        return entry;
    };
    for (const root of roots) {
        visit(root, root.id);
    }
    // Roots always, as before; a group below one only when it holds an account to report.
    const candidates = all.filter(entry => entry.depth === 0 || entry.accounts.size > 0);
    // Sorting is stable: within a depth, Book order.
    const kept = new Set([...candidates].sort((a, b) => a.depth - b.depth).slice(0, limit));
    return candidates.filter(entry => kept.has(entry));
}

/**
 * The names each offered group is described with: each account with transactions posted and
 * not archived, named once, in the smallest offered group holding it (the fewest such accounts,
 * the first in Book order on a tie), and never a name already `taken` by a label, ignoring case.
 * Up to {@link MAX_NAMES_PER_GROUP} each, fewer when many groups are offered.
 */
function namesOf(
    offered: OfferedGroup[],
    snapshot: Snapshot,
    taken: Set<string>
): Map<OfferedGroup, string[]> {
    const smallest = new Map<string, OfferedGroup>();
    for (const entry of offered) {
        for (const id of entry.accounts) {
            const known = smallest.get(id);
            if (!known || entry.accounts.size < known.accounts.size) {
                smallest.set(id, entry);
            }
        }
    }
    const limit = Math.min(
        MAX_NAMES_PER_GROUP,
        Math.floor(MAX_NAMES / Math.max(1, offered.length))
    );
    const written = new Set(taken);
    const names = new Map<OfferedGroup, string[]>();
    for (const entry of offered) {
        const list: string[] = [];
        for (const id of entry.accounts) {
            if (list.length >= limit) {
                break;
            }
            const name = truncate(snapshot.accounts[id].name);
            if (smallest.get(id) === entry && !written.has(name.toLowerCase())) {
                written.add(name.toLowerCase());
                list.push(name);
            }
        }
        names.set(entry, list);
    }
    return names;
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

/** How a group's nature reads to a person asking for a report. */
export function natureDescription(group: Pick<SnapshotGroup, 'type' | 'permanent'>): string {
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
