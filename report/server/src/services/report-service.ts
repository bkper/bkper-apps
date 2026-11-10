/**
 * Builds a report of a Book: by intent, or by a request in any language that one decision
 * request, whose options come from the Book snapshot (its map), turns into an intent. A
 * request of exactly one of the Book's suggestions is its intent, with no decision.
 *
 * The intent names the report's balances queries (its period and the previous one, per
 * root), which run in parallel; every amount of the report comes from their responses. A
 * request that names no period reads the default one, and only when that has no movements,
 * one query of the report's history and the report of its last year with them
 * (`default-period.ts`).
 *
 * A Book that has no reports at all (empty, or with nothing to report on: `book-problems.ts`) is
 * answered before anything is asked or read.
 */
import type { ReportSpec } from 'report-shared/catalog';
import { reportText } from 'report-shared/report-state';
import type { DecisionClient } from './decision-client.js';
import type { ComparisonError } from './period-query.js';
import { readReport, type ReadReport } from './default-period.js';
import { resolveIntent, type IntentTrace } from './intent-resolver.js';
import type { QueryBalances } from './balances.js';
import {
    ReportError,
    assertReportable,
    buildReport,
    viewKindOf,
    type ChartFacts,
    type ChartRule,
    type ReportChart,
    type ReportCharts,
    type ReportData,
    type ViewKind,
} from './report.js';
import { reportIntentOf, type ReportIntent, type ReportIntentInput } from './report-intent.js';
import { buildReportSpec } from './report-spec.js';
import type { Snapshot } from './snapshot.js';
import { findSuggestion, readSuggestions, type SuggestionStore } from './suggestions.js';
import type { Timing } from './timing.js';

/** The language of reports whose request names none and whose caller prefers none. */
export const DEFAULT_LANGUAGE = 'en';

/**
 * A report request: a text in any language, or an intent, such as a suggestion's, its period
 * as parts or as a period id of older intents.
 */
export type ReportRequest = { prompt: string } | { intent: ReportIntentInput };

/** Languages the caller prefers, each already one of the Bkper languages. */
export interface ReportLanguages {
    /** Asked for explicitly: it wins over the language of the request. */
    requested?: string;
    /** Preferred in general (`Accept-Language`): used when the request's language is unsure. */
    accepted?: string;
}

export interface ReportServiceOptions {
    decisions: DecisionClient;
    /** The balances of each query on the Book of the snapshot, in query order. */
    loadBalances: (queries: string[]) => Promise<QueryBalances[]>;
    timing: Timing;
    /** Where the suggestions' ranking is remembered (see `suggestions.ts`). */
    cache?: SuggestionStore;
}

/**
 * How the report was shown: for a request, the model's judgments and the rule that chose the
 * chart it prefers; the facts of its data, the charts that fit them, and the main one.
 */
export interface ReportTrace extends Partial<IntentTrace> {
    /**
     * Why the comparison the intent asks for cannot be made: the report compares with the
     * previous period instead (all time with nothing), and its spec says so.
     */
    comparisonError?: ComparisonError;
    facts: ChartFacts;
    chart: {
        /** Every chart that fits, in the order a renderer offers them; `table` for none. */
        fitting: ViewKind[];
        main: ViewKind;
        rule: ChartRule;
        unfit?: ReportCharts['unfit'];
    };
}

export interface ReportResult {
    spec: ReportSpec;
    /** The intent read, its period as parts. */
    intent: ReportIntent;
    /** The language of the spec's texts. */
    language: string;
    /** The Bkper query of exactly the report's transactions and dates. */
    query: string;
    /** When the balances were read, as an ISO instant. */
    dataAt: string;
    /** The chart drawn, and whether it stands in for the intent's `chart`, which does not fit. */
    chart: { kind: ReportChart['kind']; fallback: boolean };
    /** The request as a person would type it: the prompt, or the report's title and period. */
    text: string;
    trace: ReportTrace;
}

/** The request is not a report of this Book; the suggestions' texts are reports it can have. */
export class NotAReportError extends Error {
    constructor(readonly suggestions: string[]) {
        super('The request is not a report of this Book.');
        this.name = 'NotAReportError';
    }
}

export async function createReport(
    snapshot: Snapshot,
    request: ReportRequest,
    languages: ReportLanguages,
    options: ReportServiceOptions
): Promise<ReportResult> {
    const { timing } = options;
    assertReportable(snapshot);
    options = { ...options, loadBalances: readOnce(options.loadBalances) };
    let intent: ReportIntent;
    let intentTrace: IntentTrace | undefined;
    let detected: string | undefined;
    let defaultPeriod = false;
    // A suggestion's text, in the language it would be suggested in, needs no decision.
    const suggested = languages.requested ?? languages.accepted ?? DEFAULT_LANGUAGE;
    const suggestion =
        'prompt' in request
            ? await findSuggestion(request.prompt, snapshot, suggested, options)
            : undefined;
    if ('intent' in request) {
        intent = reportIntentOf(request.intent);
    } else if (suggestion) {
        intent = suggestion.intent;
        detected = suggested;
    } else {
        const resolution = await resolveIntent(request.prompt, snapshot, {
            client: options.decisions,
            timing,
        });
        detected = resolution.language;
        if (!resolution.recognized) {
            throw await notAReport(
                snapshot,
                options,
                languages.requested ?? detected ?? languages.accepted
            );
        }
        intent = resolution.intent;
        intentTrace = resolution.trace;
        defaultPeriod = resolution.defaultPeriod === true;
    }
    const language = languages.requested ?? detected ?? languages.accepted ?? DEFAULT_LANGUAGE;

    let read: ReadReport;
    try {
        read = await readReport(intent, snapshot, {
            loadBalances: options.loadBalances,
            defaultPeriod,
        });
    } catch (error) {
        if (error instanceof ReportError && error.reason === 'no_activity_roots') {
            throw await notAReport(snapshot, options, language);
        }
        throw error;
    }
    intent = read.intent;
    const report: ReportData = await timing.measure('compute', async () =>
        buildReport(read.intent, snapshot, read.balances)
    );

    const spec = await timing.measure('render', async () => buildReportSpec(report, language));
    return {
        spec,
        intent,
        language,
        query: report.query,
        dataAt: report.dataAt,
        chart: { kind: report.chart.kind, fallback: report.chart.fallback === true },
        text: 'prompt' in request ? request.prompt : reportText(spec),
        trace: {
            ...intentTrace,
            ...(report.comparisonError ? { comparisonError: report.comparisonError } : {}),
            ...reportTrace(report.charts),
        },
    };
}

function reportTrace({ facts, views, main, rule, unfit }: ReportCharts): ReportTrace {
    return {
        facts,
        chart: { fitting: views.map(viewKindOf), main, rule, ...(unfit ? { unfit } : {}) },
    };
}

/** Not a report, with the suggestions the Book can have instead, read as their own requests. */
async function notAReport(
    snapshot: Snapshot,
    options: ReportServiceOptions,
    language = DEFAULT_LANGUAGE
): Promise<NotAReportError> {
    const suggestions = await readSuggestions(snapshot, language, options);
    return new NotAReportError(suggestions.map(suggestion => suggestion.text));
}

type LoadBalances = ReportServiceOptions['loadBalances'];

/**
 * Reads each query once per request: the report of a suggestion reads the queries its
 * suggestion was just read with.
 */
function readOnce(load: LoadBalances): LoadBalances {
    const read = new Map<string, Promise<QueryBalances>>();
    return queries => {
        const missing = [...new Set(queries)].filter(query => !read.has(query));
        if (missing.length > 0) {
            const loaded = load(missing);
            missing.forEach((query, i) =>
                read.set(
                    query,
                    loaded.then(balances => balances[i])
                )
            );
        }
        return Promise.all(
            queries.map(
                query => read.get(query) ?? Promise.reject(new Error('A query was not read'))
            )
        );
    };
}
