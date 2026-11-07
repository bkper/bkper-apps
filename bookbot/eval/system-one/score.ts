import type { CaseTag, DiscoveryCase } from './cases.js';
import { isChoiceAnswer, isNoulAnswer, isSystemOneResponse, readSystemOneError, type SystemOneRequest } from './contract.js';
import { ACCOUNT_QUESTION, buildRequest, FITS_QUESTION } from './request.js';

/** Gateway prices from the model catalog at recording time, in nano USD per token. */
export interface ModelPricing {
    inputNanoUsdPerToken: number;
    outputNanoUsdPerToken: number;
}

export interface RecordedCall {
    caseId: string;
    model: string;
    status: number;
    latencyMs: number;
    request: SystemOneRequest;
    body: unknown;
}

export interface Recording {
    recordedAt: string;
    endpoint: string;
    release: string;
    pricing: Record<string, ModelPricing>;
    calls: RecordedCall[];
}

export interface CaseOutcome {
    caseId: string;
    model: string;
    tags: CaseTag[];
    expected: string | null;
    error?: string;
    choice?: string;
    confidence?: number;
    fits?: number;
    latencyMs: number;
    costNanoUsd: number;
}

/** Discovery suggests the chosen Account only when the model says an Account fits. */
export const FITS_THRESHOLD = 0.5;
export const CONFIDENCE_THRESHOLDS = [0, 0.5, 0.7, 0.9, 0.95];

function isCandidate(discoveryCase: DiscoveryCase, name: string): boolean {
    return name !== discoveryCase.book.bankAccount && discoveryCase.book.accounts.some(account => account.name === name);
}

export function scoreCall(discoveryCase: DiscoveryCase, call: RecordedCall, pricing: ModelPricing | undefined): CaseOutcome {
    const base = {
        caseId: discoveryCase.id,
        model: call.model,
        tags: discoveryCase.tags,
        expected: discoveryCase.expected,
        latencyMs: call.latencyMs,
        costNanoUsd: 0,
    };
    if (call.status !== 200 || !isSystemOneResponse(call.body)) {
        const error = readSystemOneError(call.body);
        return { ...base, error: `HTTP ${call.status} ${error?.code ?? 'invalid_response'}` };
    }
    const usage = call.body.usage;
    const costNanoUsd = pricing
        ? usage.input_tokens * pricing.inputNanoUsdPerToken + usage.output_tokens * pricing.outputNanoUsdPerToken
        : 0;
    const account = call.body.answers[ACCOUNT_QUESTION];
    const fits = call.body.answers[FITS_QUESTION];
    if (!isChoiceAnswer(account) || !isNoulAnswer(fits) || !isCandidate(discoveryCase, account.choice)) {
        return { ...base, costNanoUsd, error: 'invalid_answer' };
    }
    return { ...base, costNanoUsd, choice: account.choice, confidence: account.confidence, fits: fits.noul };
}

/** The Account discovery would suggest, or null for no suggestion. */
export function suggestion(outcome: CaseOutcome, minConfidence = 0, gateOnFits = true): string | null {
    if (outcome.error || outcome.choice === undefined || outcome.confidence === undefined || outcome.fits === undefined) return null;
    if (gateOnFits && outcome.fits < FITS_THRESHOLD) return null;
    return outcome.confidence >= minConfidence ? outcome.choice : null;
}

export interface Ratio {
    hits: number;
    total: number;
}

export interface ThresholdRow {
    threshold: number;
    suggested: number;
    correct: number;
    /** Correct suggestions over all cases that have an expected Account. */
    coverage: Ratio;
}

export interface ModelSummary {
    model: string;
    calls: number;
    errors: number;
    /** Choice accuracy on cases that have an expected Account. */
    choiceAccuracy: Ratio;
    /** `noul` at the fits threshold: yes on cases with an Account, no on cases without one. */
    fitsOnFitting: Ratio;
    fitsOnNone: Ratio;
    fitsBrier: number;
    /** End to end, suggesting only when fits: correct Account, or no suggestion when none fits. */
    decisionAccuracy: Ratio;
    wrongSuggestions: number;
    missedSuggestions: number;
    byConfidence: ThresholdRow[];
    byConfidenceGated: ThresholdRow[];
    byTag: Record<string, Ratio>;
    latencyMs: { mean: number; p50: number; p95: number };
    costNanoUsd: { meanPerCall: number; total: number };
}

function ratio(outcomes: CaseOutcome[], predicate: (outcome: CaseOutcome) => boolean): Ratio {
    return { hits: outcomes.filter(predicate).length, total: outcomes.length };
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function thresholdRows(outcomes: CaseOutcome[], gateOnFits: boolean): ThresholdRow[] {
    const fitting = outcomes.filter(outcome => outcome.expected !== null).length;
    return CONFIDENCE_THRESHOLDS.map(threshold => {
        const suggested = outcomes.filter(outcome => suggestion(outcome, threshold, gateOnFits) !== null);
        const correct = suggested.filter(outcome => suggestion(outcome, threshold, gateOnFits) === outcome.expected).length;
        return { threshold, suggested: suggested.length, correct, coverage: { hits: correct, total: fitting } };
    });
}

export function summarize(model: string, outcomes: CaseOutcome[]): ModelSummary {
    const answered = outcomes.filter(outcome => !outcome.error);
    const fitting = outcomes.filter(outcome => outcome.expected !== null);
    const none = outcomes.filter(outcome => outcome.expected === null);
    const decisionCorrect = (outcome: CaseOutcome) => !outcome.error && suggestion(outcome) === outcome.expected;
    const latencies = answered.map(outcome => outcome.latencyMs).sort((left, right) => left - right);
    const totalCost = outcomes.reduce((sum, outcome) => sum + outcome.costNanoUsd, 0);
    const brierTerms = answered.map(outcome => ((outcome.fits ?? 0) - (outcome.expected !== null ? 1 : 0)) ** 2);

    const byTag: Record<string, Ratio> = {};
    for (const tag of [...new Set(outcomes.flatMap(outcome => outcome.tags))].sort()) {
        byTag[tag] = ratio(outcomes.filter(outcome => outcome.tags.includes(tag)), decisionCorrect);
    }

    return {
        model,
        calls: outcomes.length,
        errors: outcomes.length - answered.length,
        choiceAccuracy: ratio(fitting, outcome => !outcome.error && outcome.choice === outcome.expected),
        fitsOnFitting: ratio(fitting, outcome => !outcome.error && (outcome.fits ?? 0) >= FITS_THRESHOLD),
        fitsOnNone: ratio(none, outcome => !outcome.error && (outcome.fits ?? 1) < FITS_THRESHOLD),
        fitsBrier: brierTerms.length ? brierTerms.reduce((sum, term) => sum + term, 0) / brierTerms.length : 0,
        decisionAccuracy: ratio(outcomes, decisionCorrect),
        wrongSuggestions: outcomes.filter(outcome => suggestion(outcome) !== null && suggestion(outcome) !== outcome.expected).length,
        missedSuggestions: fitting.filter(outcome => suggestion(outcome) === null).length,
        byConfidence: thresholdRows(outcomes, false),
        byConfidenceGated: thresholdRows(outcomes, true),
        byTag,
        latencyMs: {
            mean: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0,
            p50: percentile(latencies, 0.5),
            p95: percentile(latencies, 0.95),
        },
        costNanoUsd: { meanPerCall: outcomes.length ? totalCost / outcomes.length : 0, total: totalCost },
    };
}

/** Scores every recorded call against its case; calls for unknown cases or stale requests are an error. */
export function scoreRecording(cases: DiscoveryCase[], recording: Recording): ModelSummary[] {
    const casesById = new Map(cases.map(discoveryCase => [discoveryCase.id, discoveryCase]));
    const outcomesByModel = new Map<string, CaseOutcome[]>();
    for (const call of recording.calls) {
        const discoveryCase = casesById.get(call.caseId);
        if (!discoveryCase) throw new Error(`Recorded call for unknown case: ${call.caseId}`);
        if (JSON.stringify(call.request) !== JSON.stringify(buildRequest(call.model, discoveryCase))) {
            throw new Error(`Recorded request differs from the current case: ${call.caseId} (${call.model})`);
        }
        const outcomes = outcomesByModel.get(call.model) ?? [];
        outcomes.push(scoreCall(discoveryCase, call, recording.pricing[call.model]));
        outcomesByModel.set(call.model, outcomes);
    }
    return [...outcomesByModel.entries()].map(([model, outcomes]) => summarize(model, outcomes));
}

function formatRatio({ hits, total }: Ratio): string {
    return `${hits}/${total} (${total ? ((hits / total) * 100).toFixed(1) : '0.0'}%)`;
}

function formatUsd(nanoUsd: number): string {
    return `$${(nanoUsd / 1e9).toFixed(6)}`;
}

function table(header: string[], rows: string[][]): string {
    return [
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...rows.map(row => `| ${row.join(' | ')} |`),
    ].join('\n');
}

function thresholdTable(summaries: ModelSummary[], rows: (summary: ModelSummary) => ThresholdRow[]): string {
    return table(
        ['Model', 'Confidence ≥', 'Suggested', 'Precision', 'Coverage'],
        summaries.flatMap(summary => rows(summary).map(row => [
            summary.model,
            row.threshold.toFixed(2),
            String(row.suggested),
            formatRatio({ hits: row.correct, total: row.suggested }),
            formatRatio(row.coverage),
        ]))
    );
}

/** The deterministic results section, reproducible from a recording. */
export function renderReport(summaries: ModelSummary[]): string {
    const models = summaries.map(summary => summary.model);
    const row = (label: string, value: (summary: ModelSummary) => string) => [label, ...summaries.map(value)];
    const tags = [...new Set(summaries.flatMap(summary => Object.keys(summary.byTag)))].sort();
    return [
        '### Summary',
        '',
        table(['Metric', ...models], [
            row('Calls (errors)', summary => `${summary.calls} (${summary.errors})`),
            row('Choice accuracy, cases with an Account', summary => formatRatio(summary.choiceAccuracy)),
            row(`Fits ≥ ${FITS_THRESHOLD} when an Account fits`, summary => formatRatio(summary.fitsOnFitting)),
            row(`Fits < ${FITS_THRESHOLD} when none fits`, summary => formatRatio(summary.fitsOnNone)),
            row('Fits Brier score (lower is better)', summary => summary.fitsBrier.toFixed(3)),
            row(`Decision accuracy, suggesting only when fits ≥ ${FITS_THRESHOLD}`, summary => formatRatio(summary.decisionAccuracy)),
            row('Wrong suggestions', summary => String(summary.wrongSuggestions)),
            row('Missed suggestions', summary => String(summary.missedSuggestions)),
            row('Latency mean / p50 / p95 (ms)', summary => `${Math.round(summary.latencyMs.mean)} / ${Math.round(summary.latencyMs.p50)} / ${Math.round(summary.latencyMs.p95)}`),
            row('Cost per call (mean)', summary => formatUsd(summary.costNanoUsd.meanPerCall)),
            row('Cost, all calls', summary => formatUsd(summary.costNanoUsd.total)),
        ]),
        '',
        '### Choice confidence thresholds',
        '',
        'Suggest the chosen Account when its confidence is at least the threshold. Precision counts any suggestion on a case where no Account fits as wrong; coverage is correct suggestions over cases with an Account.',
        '',
        thresholdTable(summaries, summary => summary.byConfidence),
        '',
        `### Choice confidence thresholds, gated on fits ≥ ${FITS_THRESHOLD}`,
        '',
        thresholdTable(summaries, summary => summary.byConfidenceGated),
        '',
        '### Decision accuracy by tag',
        '',
        table(['Tag', ...models], tags.map(tag => row(tag, summary => summary.byTag[tag] ? formatRatio(summary.byTag[tag]) : '—'))),
    ].join('\n');
}
