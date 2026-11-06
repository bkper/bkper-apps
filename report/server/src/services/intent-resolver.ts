/**
 * Intent resolution: a report request, in any language, becomes a {@link ReportIntent} with one
 * decision request. The model makes judgments: it chooses the root, the period, the chart word
 * and the language among the options of {@link buildIntentRequest}, and answers whether the
 * request asks about change over time, a composition, a comparison with an earlier period or a
 * bridge. This code makes the decisions: it applies the thresholds, decides how to show the
 * report with the rule table {@link SHOW_RULES}, picks the default period when the request
 * names none, and reads hashtags from the request text itself. Which charts fit the numbers is
 * decided afterwards, by `buildReport`, from the facts of the report.
 */
import { decide, type DecisionClient } from './decision-client.js';
import {
    CHART_WORDS,
    buildIntentRequest,
    NO_ROOT,
    THRESHOLDS,
    UNSPECIFIED,
    type ChartWord,
} from './intent-questions.js';
import { defaultPeriod, isPeriodId, type ReportNature } from './periods.js';
import {
    NET_RESULT_ROOT,
    ReportIntentSchema,
    type ChartPreference,
    type ReportIntent,
    type ReportView,
} from './report-intent.js';
import { lastActiveMonth, type Snapshot } from './snapshot.js';
import type { Timing } from './timing.js';

export type IntentResolution =
    /** `language` is present only when the model is sure of it. */
    | { recognized: true; intent: ReportIntent; language?: string; trace: IntentTrace }
    | { recognized: false; language?: string };

interface ChoiceAnswer {
    choice: string;
    confidence: number;
}

interface NoulAnswer {
    noul: number;
}

/** The answers {@link readIntent} needs, as the decision model returns them. */
export interface IntentAnswers {
    root: ChoiceAnswer;
    period: ChoiceAnswer;
    over_time: NoulAnswer;
    composition: NoulAnswer;
    versus_earlier: NoulAnswer;
    bridge: NoulAnswer;
    chart_named: ChoiceAnswer;
    language: ChoiceAnswer;
}

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
    // A donut or a pie of the parts, chosen by the report's facts, else ranked bars.
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

/** Charts drawn by month, which read a trend's default period. */
const CHARTS_BY_MONTH: readonly ChartPreference[] = ['bar', 'line', 'area', 'stacked'];

/** An answer of the model and how sure it is: its confidence, or the probability of yes. */
export interface JudgmentTrace<T> {
    answer: T;
    score: number;
}

/** How the intent was decided: each answer of the model, and the rule that chose the chart. */
export interface IntentTrace {
    judgments: {
        root: JudgmentTrace<string>;
        period: JudgmentTrace<string>;
        over_time: JudgmentTrace<boolean>;
        composition: JudgmentTrace<boolean>;
        versus_earlier: JudgmentTrace<boolean>;
        bridge: JudgmentTrace<boolean>;
        chart_named: JudgmentTrace<string>;
        language: JudgmentTrace<string>;
    };
    rule: ShowRule;
}

const MAX_HASHTAGS = 10;
const MAX_HASHTAG_CHARACTERS = 100;
/** Letters, marks, digits, `_` and `-` after `#`; punctuation ends a hashtag. */
const HASHTAG = /#([\p{L}\p{M}\p{N}_-]+)/gu;

/** The `#hashtags` of a request, without `#`, each once, in order. */
export function extractHashtags(prompt: string): string[] {
    const hashtags = [...prompt.matchAll(HASHTAG)]
        .map(match => match[1])
        .filter(tag => tag.length <= MAX_HASHTAG_CHARACTERS);
    return [...new Set(hashtags)].slice(0, MAX_HASHTAGS);
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
    const { request, roots } = buildIntentRequest(prompt, snapshot);
    const result = await options.timing.measure('jev', () =>
        decide(options.client, request, options.signal)
    );
    return readIntent(result.answers, roots, snapshot, extractHashtags(prompt));
}

/**
 * Turns answers into an intent, or into no report when the request names no root of the
 * Book confidently enough.
 *
 * @param roots What each root option stands for, from {@link buildIntentRequest}.
 */
export function readIntent(
    answers: IntentAnswers,
    roots: Record<string, string>,
    snapshot: Snapshot,
    hashtags: string[]
): IntentResolution {
    const language =
        answers.language.confidence >= THRESHOLDS.language ? answers.language.choice : undefined;
    const languageField = language ? { language } : {};
    const root = Object.hasOwn(roots, answers.root.choice) ? roots[answers.root.choice] : NO_ROOT;
    if (root === NO_ROOT || answers.root.confidence < THRESHOLDS.root) {
        return { recognized: false, ...languageField };
    }

    const judgments = readJudgments(answers);
    const { rule, chart, view } = decideShown(judgments);
    // Over time, the report shows the months, whichever rule chose its chart.
    const monthly = judgments.overTime;
    const trend = monthly || (chart !== undefined && CHARTS_BY_MONTH.includes(chart));
    const intent = ReportIntentSchema.parse({
        root,
        period: readPeriod(answers.period, root, trend, snapshot),
        monthly,
        ...(view ? { view } : {}),
        ...(chart ? { chart } : {}),
        ...(hashtags.length > 0 ? { hashtags } : {}),
    });
    return {
        recognized: true,
        intent,
        ...languageField,
        trace: { judgments: traceJudgments(answers), rule },
    };
}

function readJudgments(answers: IntentAnswers): Judgments {
    const yes = (question: 'over_time' | 'composition' | 'versus_earlier' | 'bridge') =>
        answers[question].noul >= THRESHOLDS[question];
    const word = CHART_WORDS.find(id => id === answers.chart_named.choice);
    return {
        overTime: yes('over_time'),
        composition: yes('composition'),
        versusEarlier: yes('versus_earlier'),
        bridge: yes('bridge'),
        ...(word && answers.chart_named.confidence >= THRESHOLDS.chart_named
            ? { chartNamed: word }
            : {}),
    };
}

function traceJudgments(answers: IntentAnswers): IntentTrace['judgments'] {
    const choice = ({ choice, confidence }: ChoiceAnswer) => ({
        answer: choice,
        score: confidence,
    });
    const noul = (question: 'over_time' | 'composition' | 'versus_earlier' | 'bridge') => ({
        answer: answers[question].noul >= THRESHOLDS[question],
        score: answers[question].noul,
    });
    return {
        root: choice(answers.root),
        period: choice(answers.period),
        over_time: noul('over_time'),
        composition: noul('composition'),
        versus_earlier: noul('versus_earlier'),
        bridge: noul('bridge'),
        chart_named: choice(answers.chart_named),
        language: choice(answers.language),
    };
}

function readPeriod(answer: ChoiceAnswer, root: string, trend: boolean, snapshot: Snapshot) {
    if (
        answer.choice !== UNSPECIFIED &&
        answer.confidence >= THRESHOLDS.period &&
        isPeriodId(answer.choice)
    ) {
        return answer.choice;
    }
    const net = root === NET_RESULT_ROOT;
    const groups = net
        ? snapshot.roots.map(id => snapshot.groups[id]).filter(group => !group.permanent)
        : [snapshot.groups[root]];
    const nature: ReportNature = !net && groups[0].permanent ? 'position' : 'activity';
    return defaultPeriod({
        nature,
        trend,
        today: snapshot.today,
        lastActiveMonth: lastActiveMonth(groups),
    });
}
