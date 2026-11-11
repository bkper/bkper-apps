/**
 * Intent resolution: a report request, in any language, becomes a {@link ReportIntent} with one
 * decision request. The model makes judgments: it chooses the group the request is about (a
 * root or a group below one, never an account), the chart word and the language among the
 * options of {@link buildIntentRequest}, the parts of the period (its span,
 * year, month and quarter, and those of the period it compares with, `period-questions.ts`),
 * and answers whether the request asks about change over time, a composition, a comparison with
 * an earlier period or a bridge. This code makes the decisions: it applies the thresholds, reads
 * the period's parts (`readPeriod`), decides how to show the report with the rule table
 * {@link SHOW_RULES}, picks the default period when the request names none, and reads from the
 * request text itself its first hashtag and the exact names of the
 * Book's groups and accounts (`prompt-names.ts`), which the report is of whenever the request
 * writes any: the model's group is read only when it writes none, by the rules of
 * {@link TARGET_RULE_NAMES}. Which charts fit the numbers
 * is decided afterwards, by `buildReport`, from the facts of the report.
 */
import { decide, type DecisionClient } from './decision-client.js';
import {
    CHART_WORDS,
    buildIntentRequest,
    NO_ROOT,
    THRESHOLDS,
    type ChartWord,
    type IntentOptions,
} from './intent-questions.js';
import {
    readPeriod,
    type PeriodAnswers,
    type PeriodPartTrace,
    type PeriodRule,
    type PeriodTrace,
} from './period-questions.js';
import { defaultPeriod, type ReportNature } from './periods.js';
import { ReportError } from './report.js';
import {
    NET_RESULT_ROOT,
    ReportIntentSchema,
    reportIntentOf,
    type ChartPreference,
    type ReportIntent,
    type ReportView,
} from './report-intent.js';
import { HASHTAG, findPromptNames, type PromptName } from './prompt-names.js';
import { MAX_HASHTAGS, MAX_HASHTAG_LENGTH } from 'report-shared/report-intent';
import type { Snapshot } from './snapshot.js';
import type { Timing } from './timing.js';

export type IntentResolution =
    /**
     * `language` is present only when the model is sure of it. `defaultPeriod` when the request
     * names no period (or the model is unsure of it), so the intent's period is the default one,
     * which the report moves to the last year with movements when it has none.
     */
    | {
          recognized: true;
          intent: ReportIntent;
          language?: string;
          trace: IntentTrace;
          defaultPeriod?: true;
      }
    | { recognized: false; language?: string };

interface ChoiceAnswer {
    choice: string;
    confidence: number;
    /** The probability of each option; the choice alone has its confidence when absent. */
    probabilities?: Readonly<Record<string, number>>;
}

interface NoulAnswer {
    noul: number;
}

/** The answers {@link readIntent} needs, as the decision model returns them. */
export type IntentAnswers = PeriodAnswers & {
    group: ChoiceAnswer;
    over_time: NoulAnswer;
    composition: NoulAnswer;
    versus_earlier: NoulAnswer;
    bridge: NoulAnswer;
    chart_named: ChoiceAnswer;
    language: ChoiceAnswer;
};

/** The judgments of a request, after their thresholds. */
export interface Judgments {
    overTime: boolean;
    composition: boolean;
    versusEarlier: boolean;
    bridge: boolean;
    /** The chart word the request uses, when sure. */
    chartNamed?: ChartWord;
}

/** How the report is shown, as the intent's chart preference and view. */
export interface Shown {
    chart?: ChartPreference;
    view?: ReportView;
}

/** The rules of {@link SHOW_RULES}, by name. */
export const SHOW_RULE_NAMES = [
    'named',
    'bridge',
    'versus_earlier',
    'over_time_composition',
    'over_time',
    'composition',
    'auto',
] as const;

export type ShowRule = (typeof SHOW_RULE_NAMES)[number];

/** The chart preference of each chart word. */
function namedChart(word: ChartWord, judgments: Judgments): ChartPreference {
    switch (word) {
        case 'bars':
            // Bars of months, of a period against an earlier one, or of the parts.
            return judgments.overTime ? 'bar' : judgments.versusEarlier ? 'compare' : 'ranked-bar';
        case 'pie':
            // A pie is drawn as a donut, the one round chart.
            return 'donut';
        case 'line':
        case 'area':
        case 'stacked':
        case 'waterfall':
        case 'table':
            return word;
    }
}

/**
 * How to show the report: the first rule that applies, in order. Each says what the intent
 * prefers; whether that chart fits the numbers is decided later, from the report's facts.
 */
export const SHOW_RULES: readonly {
    rule: ShowRule;
    applies: (judgments: Judgments) => boolean;
    shows: (judgments: Judgments) => Shown;
}[] = [
    {
        rule: 'named',
        applies: j => j.chartNamed !== undefined,
        shows: j => (j.chartNamed ? { chart: namedChart(j.chartNamed, j) } : {}),
    },
    { rule: 'bridge', applies: j => j.bridge, shows: () => ({ chart: 'waterfall' }) },
    { rule: 'versus_earlier', applies: j => j.versusEarlier, shows: () => ({ chart: 'compare' }) },
    {
        rule: 'over_time_composition',
        applies: j => j.overTime && j.composition,
        shows: () => ({ chart: 'stacked' }),
    },
    { rule: 'over_time', applies: j => j.overTime, shows: () => ({ view: 'trend' }) },
    // A donut of the parts when the report's facts allow it, else ranked bars.
    { rule: 'composition', applies: j => j.composition, shows: () => ({ view: 'breakdown' }) },
    { rule: 'auto', applies: () => true, shows: () => ({}) },
];

/** The first rule of {@link SHOW_RULES} that applies, and what it shows. */
export function decideShown(judgments: Judgments): Shown & { rule: ShowRule } {
    const match = SHOW_RULES.find(entry => entry.applies(judgments));
    if (!match) {
        throw new Error('No rule shows the report');
    }
    return { rule: match.rule, ...match.shows(judgments) };
}

/**
 * How the subject of a report is chosen, the first that applies, in order:
 *
 * - `written`: the request writes names of the Book, and the report is of them, whatever the
 *   model chose.
 * - `net_result`: the model is sure of the net result, which stays whole.
 * - `group`: a group below a root: the one the model chose when it is sure of it and the groups
 *   below it together, else the closest group above it that is that sure.
 * - `root`: the root holding the group the model chose, when no group below it is sure enough
 *   and the model is sure of the root and the groups below it together.
 *
 * Anything else (`none`, or a root the model is unsure of) is no report.
 */
export const TARGET_RULE_NAMES = ['written', 'net_result', 'group', 'root'] as const;

export type TargetRule = (typeof TARGET_RULE_NAMES)[number];

interface Subject {
    root: string;
    target?: string;
}

/**
 * The subject the model's answer means, by the rules of {@link TARGET_RULE_NAMES} but
 * `written`, or undefined when it is no report of the Book. How sure the model is of a group is
 * the probability of it and of every group below it, so a request split between groups of one
 * parent is of the parent.
 */
function judgedSubject(
    answer: ChoiceAnswer,
    options: IntentOptions
): (Subject & { rule: TargetRule }) | undefined {
    if (!Object.hasOwn(options.groups, answer.choice)) {
        return undefined;
    }
    const probabilities = answer.probabilities ?? { [answer.choice]: answer.confidence };
    const sure = new Map<string, number>();
    for (const [label, probability] of Object.entries(probabilities)) {
        for (
            let at: string | undefined = label;
            at !== undefined && Object.hasOwn(options.groups, at);
            at = options.groups[at].parent
        ) {
            sure.set(at, (sure.get(at) ?? 0) + probability);
        }
    }
    let label = answer.choice;
    let option = options.groups[label];
    while (option.parent !== undefined && (sure.get(label) ?? 0) < THRESHOLDS.group) {
        label = option.parent;
        option = options.groups[label];
    }
    if (option.parent !== undefined) {
        return { root: option.root, target: option.id, rule: 'group' };
    }
    if ((sure.get(label) ?? 0) < THRESHOLDS.root) {
        return undefined;
    }
    return option.id === NET_RESULT_ROOT
        ? { root: NET_RESULT_ROOT, rule: 'net_result' }
        : { root: option.id, rule: 'root' };
}

/** Charts drawn by month, which read a trend's default period. */
const CHARTS_BY_MONTH: readonly ChartPreference[] = ['bar', 'line', 'area', 'stacked'];

/** An answer of the model and how sure it is: its confidence, or the probability of yes. */
export interface JudgmentTrace<T> {
    answer: T;
    score: number;
}

/**
 * How the intent was decided: each answer of the model, and the rule that chose the chart. Each
 * part of the period has its answer, score and the value read, if any; `period` is its span.
 */
export interface IntentTrace {
    judgments: {
        group: JudgmentTrace<string>;
        period: PeriodPartTrace;
        year: PeriodPartTrace;
        month: PeriodPartTrace;
        quarter: PeriodPartTrace;
        compared_year: PeriodPartTrace;
        compared_month: PeriodPartTrace;
        compared_quarter: PeriodPartTrace;
        over_time: JudgmentTrace<boolean>;
        composition: JudgmentTrace<boolean>;
        versus_earlier: JudgmentTrace<boolean>;
        year_earlier: JudgmentTrace<boolean>;
        bridge: JudgmentTrace<boolean>;
        chart_named: JudgmentTrace<string>;
        language: JudgmentTrace<string>;
    };
    rule: ShowRule;
    /** The rule that chose the report's subject, of {@link TARGET_RULE_NAMES}. */
    targetRule: TargetRule;
    /** The rules of `readPeriod` that changed the period's parts, when any did. */
    periodRules?: PeriodRule[];
    /** The Book's names the request writes, which the report is of instead of the group judgment. */
    names?: string[];
}

/**
 * The first `#hashtag` of a request, without `#`: Bkper's balances filter by a hashtag only
 * when a query has exactly one, so the others are left out.
 */
export function extractHashtags(prompt: string): string[] {
    return [...prompt.matchAll(HASHTAG)]
        .map(match => match[1])
        .filter(tag => tag.length <= MAX_HASHTAG_LENGTH)
        .slice(0, MAX_HASHTAGS);
}

export interface ResolveIntentOptions {
    client: DecisionClient;
    timing: Timing;
    signal?: AbortSignal;
}

/** Resolves a request against a Book snapshot with one decision request, measured as `jev`. */
export async function resolveIntent(
    prompt: string,
    snapshot: Snapshot,
    options: ResolveIntentOptions
): Promise<IntentResolution> {
    const { request, ...meanings } = buildIntentRequest(prompt, snapshot);
    const result = await options.timing.measure('jev', () =>
        decide(options.client, request, options.signal)
    );
    return readIntent(
        result.answers,
        meanings,
        snapshot,
        extractHashtags(prompt),
        findPromptNames(prompt, snapshot)
    );
}

/**
 * Turns answers into an intent, or into no report when the request names no group of the Book
 * confidently enough. When the request writes names of the Book (`names`), the report is of
 * them, side by side when several, whatever the group judgment. A request for
 * the next year, month or quarter is a report whose period has not started: `ReportError`
 * `future_period`.
 *
 * @param options What each group option stands for, from {@link buildIntentRequest}.
 * @param names The Book's groups and accounts the request writes, from `findPromptNames`.
 */
export function readIntent(
    answers: IntentAnswers,
    options: IntentOptions,
    snapshot: Snapshot,
    hashtags: string[],
    names: PromptName[] = []
): IntentResolution {
    const language =
        answers.language.confidence >= THRESHOLDS.language ? answers.language.choice : undefined;
    const languageField = language ? { language } : {};
    const judged = names.length === 0 ? judgedSubject(answers.group, options) : undefined;
    if (names.length === 0 && !judged) {
        return { recognized: false, ...languageField };
    }

    const reading = readPeriod(answers);
    if (reading.reason === 'future_period') {
        throw new ReportError('future_period', 'The period has not started');
    }
    const judgments = readJudgments(answers);
    if (names.length > 1) {
        // Names side by side are each their own amount, not parts of one: no composition.
        judgments.composition = false;
    }
    const { rule, chart, view } = decideShown(judgments);
    // Over time, the report shows the months, whichever rule chose its chart.
    const monthly = judgments.overTime;
    const trend = monthly || (chart !== undefined && CHARTS_BY_MONTH.includes(chart));
    const [first, ...alongside] = names.map(({ root, target }) => ({
        root,
        ...(target === undefined ? {} : { target }),
    }));
    const subject: Subject = first ?? {
        root: judged?.root ?? NO_ROOT,
        ...(judged?.target === undefined ? {} : { target: judged.target }),
    };
    const named = reading.request;
    // Whatever chart shows it, the period is compared with the one the request names, or, for
    // the default period, the same one a year earlier when the request asks so.
    const compareWith = named
        ? named.compareWith
        : reading.trace.year_earlier.answer
          ? 'year_earlier'
          : undefined;
    const intent = reportIntentOf(
        ReportIntentSchema.parse({
            ...subject,
            ...(alongside.length > 0 ? { alongside } : {}),
            period:
                named?.period ??
                defaultPeriod({
                    nature: periodNature(subject, snapshot),
                    trend,
                    today: snapshot.today,
                }),
            ...(named?.compared ? { compared: named.compared } : {}),
            monthly,
            ...(compareWith ? { compareWith } : {}),
            ...(view ? { view } : {}),
            ...(chart ? { chart } : {}),
            ...(hashtags.length > 0 ? { hashtags } : {}),
        })
    );
    const trace: IntentTrace = {
        judgments: traceJudgments(answers, reading.trace),
        rule,
        targetRule: judged?.rule ?? 'written',
        ...(reading.trace.rules.length > 0 ? { periodRules: reading.trace.rules } : {}),
    };
    if (names.length > 0) {
        trace.names = names.map(({ name }) => name);
    }
    return {
        recognized: true,
        intent,
        ...languageField,
        trace,
        ...(named === undefined ? { defaultPeriod: true as const } : {}),
    };
}

/**
 * The nature of a default period: of the subject, the first name written or the target, else
 * the root (a position for a permanent group or account; a net result is activity).
 */
function periodNature({ root, target }: Subject, snapshot: Snapshot): ReportNature {
    const id = target ?? root;
    const node =
        id === NET_RESULT_ROOT
            ? undefined
            : (snapshot.groups[id] ?? snapshot.accounts[id] ?? snapshot.ungrouped[id]);
    return node?.permanent ? 'position' : 'activity';
}

type NoulQuestionId = 'over_time' | 'composition' | 'versus_earlier' | 'bridge';

/** Whether the model answered yes to a yes or no question, from its threshold. */
function yes(answers: IntentAnswers, question: NoulQuestionId): boolean {
    return answers[question].noul >= THRESHOLDS[question];
}

function readJudgments(answers: IntentAnswers): Judgments {
    const word = CHART_WORDS.find(id => id === answers.chart_named.choice);
    return {
        overTime: yes(answers, 'over_time'),
        composition: yes(answers, 'composition'),
        versusEarlier: yes(answers, 'versus_earlier'),
        bridge: yes(answers, 'bridge'),
        ...(word && answers.chart_named.confidence >= THRESHOLDS.chart_named
            ? { chartNamed: word }
            : {}),
    };
}

function traceJudgments(answers: IntentAnswers, period: PeriodTrace): IntentTrace['judgments'] {
    const choice = ({ choice, confidence }: ChoiceAnswer) => ({
        answer: choice,
        score: confidence,
    });
    const noul = (question: NoulQuestionId) => ({
        answer: yes(answers, question),
        score: answers[question].noul,
    });
    return {
        group: choice(answers.group),
        period: period.span,
        year: period.year,
        month: period.month,
        quarter: period.quarter,
        compared_year: period.compared_year,
        compared_month: period.compared_month,
        compared_quarter: period.compared_quarter,
        over_time: noul('over_time'),
        composition: noul('composition'),
        versus_earlier: noul('versus_earlier'),
        year_earlier: period.year_earlier,
        bridge: noul('bridge'),
        chart_named: choice(answers.chart_named),
        language: choice(answers.language),
    };
}
