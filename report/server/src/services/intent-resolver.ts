/**
 * Intent resolution: a report request, in any language, becomes a {@link ReportIntent} with one
 * decision request. The model chooses the root, the period, whether to show months, the view
 * and the language among the options of {@link buildIntentRequest}; this code applies the
 * thresholds, picks the default period when the request names none, and reads hashtags from
 * the request text itself.
 */
import { decide, type DecisionClient } from './decision-client.js';
import { buildIntentRequest, NO_ROOT, THRESHOLDS, UNSPECIFIED } from './intent-questions.js';
import { defaultPeriod, isPeriodId, type IsoMonth, type ReportNature } from './periods.js';
import {
    NET_RESULT_ROOT,
    REPORT_VIEWS,
    ReportIntentSchema,
    type ReportIntent,
    type ReportView,
} from './report-intent.js';
import type { Snapshot } from './snapshot.js';
import type { Timing } from './timing.js';

export type IntentResolution =
    /** `language` is present only when the model is sure of it. */
    | { recognized: true; intent: ReportIntent; language?: string }
    | { recognized: false; language?: string };

interface ChoiceAnswer {
    choice: string;
    confidence: number;
}

/** The answers {@link readIntent} needs, as the decision model returns them. */
export interface IntentAnswers {
    root: ChoiceAnswer;
    period: ChoiceAnswer;
    monthly: { noul: number };
    view: ChoiceAnswer;
    language: ChoiceAnswer;
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

    const monthly = answers.monthly.noul >= THRESHOLDS.monthly;
    const view = readView(answers.view);
    const intent = ReportIntentSchema.parse({
        root,
        period: readPeriod(answers.period, root, monthly || view === 'trend', snapshot),
        monthly,
        ...(view ? { view } : {}),
        ...(hashtags.length > 0 ? { hashtags } : {}),
    });
    return { recognized: true, intent, ...languageField };
}

function readView(answer: ChoiceAnswer): ReportView | undefined {
    const view = REPORT_VIEWS.find(id => id === answer.choice);
    return view && answer.confidence >= THRESHOLDS.view ? view : undefined;
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
        lastActiveMonth: lastActiveMonth(groups.flatMap(group => group.months)),
    });
}

function lastActiveMonth(months: { month: IsoMonth; period: string }[]): IsoMonth | undefined {
    return months
        .filter(month => month.period !== '0')
        .map(month => month.month)
        .sort()
        .at(-1);
}
