import { isRecord } from '../../src/genai/BkperAIClientError.js';
import { CASES, FORMATS, type ClassificationCase, type Format, type Label } from './cases.js';
import { flashLiteRequestMatches, readFlashLiteAnswer, readResponsesUsage } from './flash-lite.js';
import { buildDecisionRequest, DECISION_MODEL, KIND_QUESTION, redactDocument, type DocumentContent } from './request.js';

export const FLASH_LITE = 'gemini-flash-lite';
export const DECISION = DECISION_MODEL;
/** Trial models, in report order. */
export const MODELS = [FLASH_LITE, DECISION];
/** Thresholds on the decision model's probability that a document is a statement. */
export const THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95];

/** Gateway prices from the model catalog at recording time, in nano USD per token. */
export interface ModelPricing {
    inputNanoUsdPerToken: number;
    outputNanoUsdPerToken: number;
    cachedInputNanoUsdPerToken?: number;
}

/** One HTTP exchange, with the document's bytes replaced by their hash. A retried call has several. */
export interface RecordedCall {
    caseId: string;
    model: string;
    status: number;
    latencyMs: number;
    request: unknown;
    body: unknown;
}

export interface Recording {
    /** By model. */
    recordedAt: Record<string, string>;
    /** By model. */
    endpoints: Record<string, string>;
    /** Open System One release of the decision endpoint. */
    release: string;
    /** By model. */
    pricing: Record<string, ModelPricing>;
    calls: RecordedCall[];
}

/** What one model answered for one document. */
export interface CaseResult {
    caseId: string;
    model: string;
    label: Label;
    format: Format;
    calls: number;
    /** Flash-Lite: the bot's routing. Decision: `p_statement >= 0.5`. Absent on errors. */
    predicted?: Label;
    /** Decision model only: the probability of `statement`. */
    pStatement?: number;
    error?: string;
    latencyMs: number;
    costNanoUsd: number;
}

interface TokenUsage {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
}

function cost(usage: TokenUsage, pricing: ModelPricing): number {
    const uncached = usage.inputTokens - usage.cachedInputTokens;
    return uncached * pricing.inputNanoUsdPerToken
        + usage.cachedInputTokens * (pricing.cachedInputNanoUsdPerToken ?? pricing.inputNanoUsdPerToken)
        + usage.outputTokens * pricing.outputNanoUsdPerToken;
}

function errorOf(call: RecordedCall): string {
    const error = isRecord(call.body) && isRecord(call.body.error) ? call.body.error : undefined;
    const code = typeof error?.code === 'string' ? error.code : undefined;
    const param = typeof error?.param === 'string' ? error.param : undefined;
    if (call.status === 200) return 'invalid answer';
    return [`HTTP ${call.status}`, code, param ? `(${param})` : undefined].filter(Boolean).join(' ');
}

export interface DecisionAnswer {
    pStatement: number;
    usage: TokenUsage;
}

function isProbability(value: unknown): value is number {
    return typeof value === 'number' && value >= 0 && value <= 1;
}

/** The `choice` answer of a System One response, with the probability of `statement`. */
export function readDecisionAnswer(body: unknown): DecisionAnswer | undefined {
    if (!isRecord(body) || !isRecord(body.answers) || !isRecord(body.usage)) return undefined;
    const answer = body.answers[KIND_QUESTION];
    const { input_tokens: inputTokens, output_tokens: outputTokens } = body.usage;
    if (!isRecord(answer) || answer.type !== 'choice' || !isRecord(answer.probabilities)) return undefined;
    if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return undefined;
    const pStatement = answer.probabilities.statement;
    if (!isProbability(pStatement)) return undefined;
    return { pStatement, usage: { inputTokens, cachedInputTokens: 0, outputTokens } };
}

function scoreFlashLite(base: Omit<CaseResult, 'costNanoUsd'>, calls: RecordedCall[], pricing: ModelPricing): CaseResult {
    const costNanoUsd = calls.reduce((sum, call) => {
        const usage = readResponsesUsage(call.body);
        return usage ? sum + cost(usage, pricing) : sum;
    }, 0);
    const last = calls[calls.length - 1];
    const answer = last.status === 200 ? readFlashLiteAnswer(last.body) : undefined;
    if (!answer) return { ...base, error: errorOf(last), costNanoUsd };
    // As the bot routes: anything but `statement` goes to the single-transaction extractor.
    return { ...base, predicted: answer.kind === 'statement' ? 'statement' : 'single_transaction', costNanoUsd };
}

function scoreDecision(base: Omit<CaseResult, 'costNanoUsd'>, calls: RecordedCall[], pricing: ModelPricing): CaseResult {
    const call = calls[calls.length - 1];
    const answer = call.status === 200 ? readDecisionAnswer(call.body) : undefined;
    if (!answer) return { ...base, error: errorOf(call), costNanoUsd: 0 };
    return {
        ...base,
        pStatement: answer.pStatement,
        predicted: answer.pStatement >= 0.5 ? 'statement' : 'single_transaction',
        costNanoUsd: cost(answer.usage, pricing),
    };
}

function requestMatches(model: string, request: unknown, document: DocumentContent): boolean {
    if (model === FLASH_LITE) return flashLiteRequestMatches(request, document);
    return JSON.stringify(request) === JSON.stringify(redactDocument(buildDecisionRequest(document), document));
}

export function scoreCase(
    classificationCase: ClassificationCase,
    document: DocumentContent,
    model: string,
    calls: RecordedCall[],
    pricing: ModelPricing
): CaseResult {
    if (calls.length === 0) throw new Error(`No recorded ${model} call for ${classificationCase.id}.`);
    if (!calls.every(call => requestMatches(model, call.request, document))) {
        throw new Error(`The recorded ${model} request for ${classificationCase.id} does not match the current document or prompt; record again.`);
    }
    const base = {
        caseId: classificationCase.id,
        model,
        label: classificationCase.label,
        format: classificationCase.format,
        calls: calls.length,
        latencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0),
    };
    return model === FLASH_LITE ? scoreFlashLite(base, calls, pricing) : scoreDecision(base, calls, pricing);
}

export function scoreRecording(
    cases: ClassificationCase[],
    documents: Map<string, DocumentContent>,
    recording: Recording
): CaseResult[] {
    return MODELS.flatMap(model => {
        const pricing = recording.pricing[model];
        if (!pricing) throw new Error(`The recording has no pricing for ${model}.`);
        return cases.map(classificationCase => {
            const document = documents.get(classificationCase.id);
            if (!document) throw new Error(`No document for ${classificationCase.id}.`);
            const calls = recording.calls.filter(call => call.model === model && call.caseId === classificationCase.id);
            return scoreCase(classificationCase, document, model, calls, pricing);
        });
    });
}

export interface Tally {
    correct: number;
    total: number;
    /** Statements read as statements, of all statements. */
    statementsCaught: number;
    statements: number;
    /** Other documents read as statements, of all other documents. */
    singlesAsStatements: number;
    singles: number;
    errors: number;
}

/** Errors count as neither correct nor read as a statement: the bot's parse fails and records nothing. */
export function tally(results: CaseResult[], predict: (result: CaseResult) => Label | undefined = result => result.predicted): Tally {
    const counts: Tally = { correct: 0, total: 0, statementsCaught: 0, statements: 0, singlesAsStatements: 0, singles: 0, errors: 0 };
    for (const result of results) {
        const predicted = result.error ? undefined : predict(result);
        counts.total++;
        if (result.error) counts.errors++;
        if (predicted === result.label) counts.correct++;
        if (result.label === 'statement') {
            counts.statements++;
            if (predicted === 'statement') counts.statementsCaught++;
        } else {
            counts.singles++;
            if (predicted === 'statement') counts.singlesAsStatements++;
        }
    }
    return counts;
}

export function atThreshold(threshold: number): (result: CaseResult) => Label | undefined {
    return result => result.pStatement === undefined ? undefined : result.pStatement >= threshold ? 'statement' : 'single_transaction';
}

/** Mean squared error of the probability of `statement`, over answered documents. Lower is better. */
export function brierScore(results: CaseResult[]): number | undefined {
    const answered = results.filter(result => result.pStatement !== undefined);
    if (answered.length === 0) return undefined;
    const total = answered.reduce((sum, result) => sum + ((result.pStatement ?? 0) - (result.label === 'statement' ? 1 : 0)) ** 2, 0);
    return total / answered.length;
}

/** Nearest-rank percentile. */
export function percentile(values: number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

function ratio(part: number, whole: number): string {
    return whole === 0 ? '—' : `${part}/${whole} (${(100 * part / whole).toFixed(1)}%)`;
}

function usd(nanoUsd: number): string {
    return `$${(nanoUsd / 1e9).toFixed(6)}`;
}

function row(cells: string[]): string {
    return `| ${cells.join(' | ')} |`;
}

function table(header: string[], rows: string[][]): string {
    return [row(header), row(header.map(() => '---')), ...rows.map(row)].join('\n');
}

function answerCell(result: CaseResult | undefined): string {
    if (!result) return '—';
    if (result.error) return `error: ${result.error}`;
    const mark = result.predicted === result.label ? '✓' : '✗';
    const probability = result.pStatement !== undefined ? `${result.pStatement.toFixed(2)} ` : '';
    return `${probability}${result.predicted} ${mark}`;
}

export function renderReport(results: CaseResult[], cases: ClassificationCase[] = CASES): string {
    const byModel = MODELS.map(model => results.filter(result => result.model === model));
    const tallies = byModel.map(modelResults => tally(modelResults));
    const formatTally = (modelResults: CaseResult[], format: Format) => tally(modelResults.filter(result => result.format === format));
    const formatNames: Record<Format, string> = { pdf: 'PDFs with a text layer', scanned_pdf: 'scanned PDFs', image: 'images' };
    const latencies = byModel.map(modelResults => modelResults.map(result => result.latencyMs));
    const costs = byModel.map(modelResults => modelResults.reduce((sum, result) => sum + result.costNanoUsd, 0));

    const summary = table(['Metric', ...MODELS], [
        ['Documents (calls, errors)', ...byModel.map((modelResults, index) =>
            `${modelResults.length} (${modelResults.reduce((sum, result) => sum + result.calls, 0)}, ${tallies[index].errors})`)],
        ['Accuracy (decision: p(statement) ≥ 0.5)', ...tallies.map(counts => ratio(counts.correct, counts.total))],
        ['Statements read as statements', ...tallies.map(counts => ratio(counts.statementsCaught, counts.statements))],
        ['Other documents read as statements', ...tallies.map(counts => ratio(counts.singlesAsStatements, counts.singles))],
        ...FORMATS.map(format => [`Accuracy, ${formatNames[format]}`, ...byModel.map(modelResults => {
            const counts = formatTally(modelResults, format);
            return ratio(counts.correct, counts.total);
        })]),
        ['Errors on PDFs', ...byModel.map(modelResults =>
            String(modelResults.filter(result => result.error && result.format !== 'image').length))],
        ['p(statement) Brier score (lower is better)', ...byModel.map(modelResults => {
            const score = brierScore(modelResults);
            return score === undefined ? '—' : score.toFixed(3);
        })],
        ['Latency per document mean / p50 / p95 / max (ms)', ...latencies.map(values => values.length === 0 ? '—' : [
            Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
            percentile(values, 0.5),
            percentile(values, 0.95),
            Math.max(...values),
        ].join(' / '))],
        ['Cost per document (mean)', ...costs.map((total, index) => byModel[index].length ? usd(total / byModel[index].length) : '—')],
        ['Cost, all documents', ...costs.map(usd)],
    ]);

    const decisionResults = byModel[MODELS.indexOf(DECISION)];
    const thresholds = table(['p(statement) ≥', 'Accuracy', 'Statements read as statements', 'Other documents read as statements'],
        THRESHOLDS.map(threshold => {
            const counts = tally(decisionResults, atThreshold(threshold));
            return [threshold.toFixed(2), ratio(counts.correct, counts.total), ratio(counts.statementsCaught, counts.statements),
                ratio(counts.singlesAsStatements, counts.singles)];
        }));

    const documents = table(['Document', 'Format', 'Label', 'Tags', ...MODELS], cases.map(classificationCase => [
        classificationCase.id,
        classificationCase.format,
        classificationCase.label,
        classificationCase.tags.join(', '),
        ...byModel.map(modelResults => answerCell(modelResults.find(result => result.caseId === classificationCase.id))),
    ]));

    return [
        '### Summary', '', summary, '',
        '### Decision thresholds', '',
        `Read a document as a statement only when \`${DECISION}\` gives \`statement\` at least this probability. Errors count as wrong.`, '',
        thresholds, '',
        '### By document', '',
        `\`${DECISION}\` shows its probability of \`statement\` and the label at 0.5.`, '',
        documents, '',
    ].join('\n');
}
