/**
 * Builds a report of a Book: by intent, or by a request in any language that one decision
 * request, whose options come from the Book snapshot (its map), turns into an intent.
 *
 * The intent names the report's balances queries (its period and the previous one, per
 * root), which run in parallel; every amount of the report comes from their responses. A
 * request that names no period reads the default one, and only when that has no movements,
 * one query of the report's history and the report of its last year with them
 * (`default-period.ts`).
 */
import type { ReportSpec } from 'report-shared/catalog';
import { reportText } from 'report-shared/report-state';
import type { DecisionClient } from './decision-client.js';
import { readReport, type ReadReport } from './default-period.js';
import { resolveIntent, type IntentTrace } from './intent-resolver.js';
import type { QueryBalances } from './balances.js';
import {
    ReportError,
    buildReport,
    viewKindOf,
    type ChartFacts,
    type ChartRule,
    type ReportChart,
    type ReportCharts,
    type ReportData,
    type ViewKind,
} from './report.js';
import type { ReportIntent } from './report-intent.js';
import { buildReportSpec } from './report-spec.js';
import type { Snapshot } from './snapshot.js';
import { buildSuggestions, type Suggestion } from './suggestions.js';
import type { Timing } from './timing.js';

/** The language of reports whose request names none and whose caller prefers none. */
export const DEFAULT_LANGUAGE = 'en';

/** A report request: a text in any language, or an intent, such as a suggestion's. */
export type ReportRequest = { prompt: string } | { intent: ReportIntent };

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
}

/**
 * How the report was shown: for a request, the model's judgments and the rule that chose the
 * chart it prefers; the facts of its data, the charts that fit them, and the main one.
 */
export interface ReportTrace extends Partial<IntentTrace> {
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

/** The request is not a report of this Book; the suggestions are reports it can have. */
export class NotAReportError extends Error {
    constructor(readonly suggestions: Suggestion[]) {
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
    let intent: ReportIntent;
    let intentTrace: IntentTrace | undefined;
    let detected: string | undefined;
    let defaultPeriod = false;
    if ('intent' in request) {
        intent = request.intent;
    } else {
        const resolution = await resolveIntent(request.prompt, snapshot, {
            client: options.decisions,
            timing,
        });
        detected = resolution.language;
        if (!resolution.recognized) {
            throw notAReport(snapshot, languages.requested ?? detected ?? languages.accepted);
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
            throw notAReport(snapshot, language);
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
        trace: { ...intentTrace, ...reportTrace(report.charts) },
    };
}

function reportTrace({ facts, views, main, rule, unfit }: ReportCharts): ReportTrace {
    return {
        facts,
        chart: { fitting: views.map(viewKindOf), main, rule, ...(unfit ? { unfit } : {}) },
    };
}

function notAReport(snapshot: Snapshot, language = DEFAULT_LANGUAGE): NotAReportError {
    return new NotAReportError(buildSuggestions(snapshot, language));
}
