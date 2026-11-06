/**
 * Builds a report from a Book snapshot: by intent, or by a request in any language that one
 * decision request turns into an intent.
 *
 * Work that does not depend on the intent starts first: a request with `#hashtags` runs its
 * live balances query while the decision model answers. Everything else is computed from the
 * snapshot, or from the one live query the report needs.
 */
import type { BalancesReport } from 'bkper-js';
import type { ReportSpec } from 'report-shared/catalog';
import { reportText } from 'report-shared/report-state';
import type { DecisionClient } from './decision-client.js';
import { extractHashtags, resolveIntent } from './intent-resolver.js';
import {
    hashtagQuery,
    readLiveBalances,
    type LiveBalances,
    type LiveQuery,
} from './live-balances.js';
import {
    ReportError,
    buildReport,
    viewKindOf,
    type ChartFacts,
    type ChartRule,
    type ReportChart,
    type ReportCharts,
    type ReportData,
    type ReportStep,
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
    /** Runs one balances query on the Book of the snapshot. */
    readBalances: (query: string) => Promise<BalancesReport>;
    timing: Timing;
    now?: () => Date;
}

/** How the report was shown: the facts of its data, the charts that fit them, and the main one. */
export interface ReportTrace {
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
    /** The chart drawn, and whether it is the rules' because the intent's `chart` does not fit. */
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
    const now = options.now ?? (() => new Date());
    const readLive = (query: LiveQuery): Promise<LiveBalances> =>
        timing.measure('balances', async () => {
            const dataAt = now();
            const report = await options.readBalances(query.query);
            return readLiveBalances(query, report, snapshot, dataAt);
        });

    let intent: ReportIntent;
    let detected: string | undefined;
    let prefetched: { query: LiveQuery; balances: Promise<LiveBalances> } | undefined;
    if ('intent' in request) {
        intent = request.intent;
    } else {
        const hashtags = extractHashtags(request.prompt);
        if (hashtags.length > 0) {
            const query = hashtagQuery(snapshot, hashtags);
            prefetched = { query, balances: readLive(query) };
            // Its failure matters only if the report reads it.
            prefetched.balances.catch(() => undefined);
        }
        const resolution = await resolveIntent(request.prompt, snapshot, {
            client: options.decisions,
            timing,
        });
        detected = resolution.language;
        if (!resolution.recognized) {
            throw notAReport(snapshot, languages.requested ?? detected ?? languages.accepted);
        }
        intent = resolution.intent;
    }
    const language = languages.requested ?? detected ?? languages.accepted ?? DEFAULT_LANGUAGE;

    let report: ReportData;
    try {
        const compute = (live?: LiveBalances) =>
            timing.measure('compute', async () => buildReport(intent, snapshot, live));
        let step: ReportStep = await compute();
        if ('liveQuery' in step) {
            const query = step.liveQuery;
            const live =
                prefetched && prefetched.query.query === query.query
                    ? await prefetched.balances
                    : await readLive(query);
            step = await compute(live);
        }
        if ('liveQuery' in step) {
            throw new Error('The report needs a second live query');
        }
        report = step.report;
    } catch (error) {
        if (error instanceof ReportError && error.reason === 'no_activity_roots') {
            throw notAReport(snapshot, language);
        }
        throw error;
    }

    const spec = await timing.measure('render', async () => buildReportSpec(report, language));
    return {
        spec,
        intent,
        language,
        query: report.query,
        dataAt: report.dataAt,
        chart: { kind: report.chart.kind, fallback: report.chart.fallback === true },
        text: 'prompt' in request ? request.prompt : reportText(spec),
        trace: reportTrace(report.charts),
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
