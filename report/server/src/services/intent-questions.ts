/**
 * What the decision model is asked about a report request, and how sure it must be.
 *
 * Every question, criterion and threshold of intent resolution lives here, so they can be
 * reviewed and tuned together. The model only chooses among options this code offers (the
 * Book's root groups, the periods within its data, the chart words, the languages) and answers
 * yes or no to small recognition questions about how the request asks to see the amounts; it
 * never sees amounts, computes dates or writes queries. Each question stands alone: none
 * refers to another or says when not to answer yes, since code combines the answers
 * (`intent-resolver.ts`). Question ids are not sent to the model, so each instruction refers to
 * the state fields in backticks.
 */
import type { ChoiceQuestion, NoulQuestion, SystemOneRequest } from '@typesafe-ai/sdk';
import { LANGUAGES } from 'report-shared/languages';
import { buildPeriodOptions } from './periods.js';
import { NET_RESULT_ROOT } from './report-intent.js';
import type { Snapshot, SnapshotGroup } from './snapshot.js';

/** How sure the model must be before an answer is used. */
export const THRESHOLDS = {
    /** Below it, or on `none`, the request is not a report of this Book. */
    root: 0.5,
    /** Below it, the request reads the default period. */
    period: 0.5,
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
/** The period answer for a request that names none. */
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
    root: ChoiceQuestion<Criteria>;
    period: ChoiceQuestion<Criteria>;
    over_time: NoulQuestion;
    composition: NoulQuestion;
    versus_earlier: NoulQuestion;
    bridge: NoulQuestion;
    chart_named: ChoiceQuestion<typeof CHART_NAMED_CRITERIA>;
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
                over_time: { type: 'noul', instructions: OVER_TIME_INSTRUCTIONS },
                composition: { type: 'noul', instructions: COMPOSITION_INSTRUCTIONS },
                versus_earlier: { type: 'noul', instructions: VERSUS_EARLIER_INSTRUCTIONS },
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
