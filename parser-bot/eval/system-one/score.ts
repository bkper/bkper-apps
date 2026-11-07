import { REFERENCE_DATE, type CaseTag, type ExpectedFields, type ExtractionCase } from './cases.js';
import {
    isListAnswer,
    isSystemOneResponse,
    isValueAnswer,
    readSystemOneError,
    type SystemOneRequest,
    type SystemOneResponse,
    type SystemOneSpan,
} from './contract.js';
import { GEMINI_PROPERTIES, geminiRequestMatches, readGeminiAnswer, readGeminiUsage } from './gemini.js';
import type { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';
import { buildClairicRequest, QUESTIONS, type DocumentContent } from './request.js';

export const CLAIRIC = 'clairic';
export const GEMINI = 'gemini-flash';

/** Gateway prices from the model catalog at recording time, in nano USD per token. */
export interface ModelPricing {
    inputNanoUsdPerToken: number;
    outputNanoUsdPerToken: number;
    cachedInputNanoUsdPerToken?: number;
}

/** One HTTP exchange. A Gemini extraction that retried has several, in order. */
export interface RecordedCall {
    caseId: string;
    model: string;
    status: number;
    latencyMs: number;
    request: unknown;
    body: unknown;
}

export interface Recording {
    recordedAt: string;
    endpoints: Record<string, string>;
    release: string;
    pricing: Record<string, ModelPricing>;
    calls: RecordedCall[];
}

export const FIELDS = ['date', 'total', 'currency', 'supplier', 'document_number', 'description'] as const;
export type FieldName = (typeof FIELDS)[number];

export interface FieldReading {
    value: string | number | null;
    /** The most likely value, also when `value` is null. */
    guess?: string | number;
    confidence?: number;
    pNull?: number;
}

export interface Items {
    lineAmounts: number[];
    charges: number[];
    discounts: number[];
}

/** What one model read from one document, in the trial's terms. */
export interface Extraction {
    fields: Record<FieldName, FieldReading>;
    items?: Items;
}

/** `correct_null`: the document does not state the field and the model returned none. */
export type FieldOutcome = 'correct' | 'correct_null' | 'wrong' | 'missed' | 'hallucinated';

export interface FieldResult {
    outcome: FieldOutcome;
    /** Fields the document states, for models that return a guess: whether the guess is correct. */
    guessCorrect?: boolean;
    confidence?: number;
    pNull?: number;
}

export interface SpanCheck {
    /** Spans of text answers, and how many cover exactly the answer's guess. */
    textSpans: number;
    textSpansMatching: number;
    /** Spans of number and date answers and list items, and how many lie within the text. */
    otherSpans: number;
    otherSpansInBounds: number;
    /** Non-null spans on image documents, whose values are read from the image. */
    imageSpans: number;
}

export interface CaseOutcome {
    caseId: string;
    model: string;
    tags: CaseTag[];
    /** Which fields the document states, whatever the model answered. */
    stated: Record<FieldName, boolean>;
    calls: number;
    error?: string;
    fields?: Record<FieldName, FieldResult>;
    /** Itemized documents only: the item amounts match the document's, in order. */
    lineItemsExact?: boolean;
    /** The date answer is the request's reference date, and the document's date is not. */
    dateIsReference?: boolean;
    /** Items, charges and discounts add up to the model's total, computed here. */
    totalVerified?: boolean;
    totalCorrect?: boolean;
    spans?: SpanCheck;
    latencyMs: number;
    costNanoUsd: number;
}

const CURRENCY_ALIASES: Record<string, string> = {
    '$': 'USD',
    'US$': 'USD',
    'DOLLARS': 'USD',
    'R$': 'BRL',
    'REAIS': 'BRL',
    'REAL': 'BRL',
    '€': 'EUR',
    'EURO': 'EUR',
    'EUROS': 'EUR',
    '£': 'GBP',
};

/** Lowercase letters and digits without accents, single-spaced. */
export function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, ' ')
        .trim();
}

/** An ISO 4217 code from a symbol, code or name. A bare `$` is read as USD in these documents. */
export function normalizeCurrency(value: string): string {
    const key = value.trim().toUpperCase();
    return CURRENCY_ALIASES[key] ?? key;
}

function alphanumeric(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/gu, '');
}

/** A document number without a leading `No`, `Nº`, `Nr` or `#` label, in letters and digits. */
function documentNumber(value: string): string {
    return alphanumeric(value.trim().replace(/^(?:n[oº°]|nr)\.?\s+|^#/iu, ''));
}

function cents(amount: number): number {
    return Math.round(amount * 100);
}

function sumCents(amounts: number[]): number {
    return amounts.reduce((sum, amount) => sum + cents(amount), 0);
}

function mapFields<T>(make: (field: FieldName) => T): Record<FieldName, T> {
    return {
        date: make('date'),
        total: make('total'),
        currency: make('currency'),
        supplier: make('supplier'),
        document_number: make('document_number'),
        description: make('description'),
    };
}

function expectedValue(field: FieldName, expected: ExpectedFields): unknown {
    switch (field) {
        case 'date': return expected.date;
        case 'total': return expected.total;
        case 'currency': return expected.currency;
        case 'supplier': return expected.supplier;
        case 'document_number': return expected.documentNumber;
        case 'description': return expected.description;
    }
}

export function fieldMatches(field: FieldName, value: string | number, expected: ExpectedFields): boolean {
    const text = String(value);
    switch (field) {
        case 'date': return text === expected.date;
        case 'total': return expected.total !== null && typeof value === 'number' && cents(value) === cents(expected.total);
        case 'currency': return normalizeCurrency(text) === expected.currency;
        case 'supplier': return (expected.supplier ?? []).some(name => normalizeText(text).includes(normalizeText(name)));
        case 'document_number': return (expected.documentNumber ?? []).some(number => documentNumber(text) === documentNumber(number));
        case 'description': return expected.description.some(keyword => normalizeText(text).includes(normalizeText(keyword)));
    }
}

export function fieldOutcome(field: FieldName, reading: FieldReading, expected: ExpectedFields): FieldOutcome {
    if (expectedValue(field, expected) === null) return reading.value === null ? 'correct_null' : 'hallucinated';
    if (reading.value === null) return 'missed';
    return fieldMatches(field, reading.value, expected) ? 'correct' : 'wrong';
}

/** Whether the items, plus charges, minus discounts, add up to the total, in cents. */
export function itemsAddUp(total: number, items: Items): boolean {
    return items.lineAmounts.length > 0
        && sumCents(items.lineAmounts) + sumCents(items.charges) - sumCents(items.discounts) === cents(total);
}

function sameAmounts(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((amount, index) => cents(amount) === cents(right[index]));
}

function codePointSlice(text: string, [start, end]: SystemOneSpan): string | undefined {
    const codePoints = Array.from(text);
    if (start > end || end > codePoints.length) return undefined;
    return codePoints.slice(start, end).join('');
}

/** Checks every span against the text it indexes: `state_text` when returned, else the state sent. */
export function checkSpans(response: SystemOneResponse, request: SystemOneRequest, isImage: boolean): SpanCheck {
    const text = response.state_text ?? request.state;
    const check: SpanCheck = { textSpans: 0, textSpansMatching: 0, otherSpans: 0, otherSpansInBounds: 0, imageSpans: 0 };
    const countOther = (span: SystemOneSpan) => {
        check.otherSpans++;
        if (codePointSlice(text, span) !== undefined) check.otherSpansInBounds++;
    };
    for (const answer of Object.values(response.answers)) {
        if (isValueAnswer(answer, 'text') && answer.span) {
            if (isImage) check.imageSpans++;
            check.textSpans++;
            if (codePointSlice(text, answer.span) === answer.guess) check.textSpansMatching++;
        } else if ((isValueAnswer(answer, 'number') || isValueAnswer(answer, 'date')) && answer.span) {
            if (isImage) check.imageSpans++;
            countOther(answer.span);
        } else if (isListAnswer(answer, 'number')) {
            for (const span of answer.spans ?? []) {
                if (!span) continue;
                if (isImage) check.imageSpans++;
                countOther(span);
            }
        }
    }
    return check;
}

/** Reads Clairic's answers; undefined when any is missing or malformed. */
export function readClairic(response: SystemOneResponse): Extraction | undefined {
    const answers = response.answers;
    const value = (name: string, type: 'text' | 'number' | 'date'): FieldReading | undefined => {
        const answer = answers[name];
        if (!isValueAnswer(answer, type)) return undefined;
        return {
            value: answer.value,
            ...(answer.guess !== undefined ? { guess: answer.guess } : {}),
            confidence: answer.confidence,
            pNull: answer.p_null,
        };
    };
    const amounts = (name: string): number[] | undefined => {
        const answer = answers[name];
        return isListAnswer(answer, 'number') ? answer.value.filter((item): item is number => typeof item === 'number') : undefined;
    };
    const date = value(QUESTIONS.date, 'date');
    const total = value(QUESTIONS.total, 'number');
    const currency = value(QUESTIONS.currency, 'text');
    const supplier = value(QUESTIONS.supplier, 'text');
    const documentNumber = value(QUESTIONS.documentNumber, 'text');
    const description = value(QUESTIONS.description, 'text');
    const lineAmounts = amounts(QUESTIONS.lineAmounts);
    const charges = amounts(QUESTIONS.charges);
    const discounts = amounts(QUESTIONS.discounts);
    if (!date || !total || !currency || !supplier || !documentNumber || !description || !lineAmounts || !charges || !discounts) {
        return undefined;
    }
    return {
        fields: { date, total, currency, supplier, document_number: documentNumber, description },
        items: { lineAmounts, charges, discounts },
    };
}

/**
 * Reads the bot's extracted transaction. Its schema requires an amount, so an amount of 0 is how it
 * reports none; an absent or empty property is no value.
 */
export function readGemini(transaction: ExtractedTransaction): Extraction {
    const property = (name: string): FieldReading => {
        const value = transaction.properties[name];
        return { value: value === undefined || value === '' ? null : String(value) };
    };
    return {
        fields: {
            date: { value: transaction.date },
            total: { value: transaction.amount === 0 ? null : transaction.amount },
            currency: property(GEMINI_PROPERTIES.currency),
            supplier: property(GEMINI_PROPERTIES.supplier),
            document_number: property(GEMINI_PROPERTIES.documentNumber),
            description: { value: transaction.description.trim() === '' ? null : transaction.description },
        },
    };
}

function scoreExtraction(extractionCase: ExtractionCase, extraction: Extraction): Pick<CaseOutcome, 'fields' | 'dateIsReference' | 'lineItemsExact' | 'totalVerified' | 'totalCorrect'> {
    const expected = extractionCase.expected;
    const fields = mapFields(field => {
        const reading = extraction.fields[field];
        const result: FieldResult = { outcome: fieldOutcome(field, reading, expected) };
        if (reading.guess !== undefined && expectedValue(field, expected) !== null) {
            result.guessCorrect = fieldMatches(field, reading.guess, expected);
        }
        if (reading.confidence !== undefined) result.confidence = reading.confidence;
        if (reading.pNull !== undefined) result.pNull = reading.pNull;
        return result;
    });
    const date = extraction.fields.date.value;
    const outcome = { fields, dateIsReference: date === REFERENCE_DATE && expected.date !== REFERENCE_DATE };
    if (!extraction.items) return outcome;
    const total = extraction.fields.total.value;
    return {
        ...outcome,
        ...(expected.lineAmounts.length > 0 ? { lineItemsExact: sameAmounts(extraction.items.lineAmounts, expected.lineAmounts) } : {}),
        totalVerified: typeof total === 'number' && itemsAddUp(total, extraction.items),
        totalCorrect: outcome.fields.total.outcome === 'correct',
    };
}

function callCost(model: string, body: unknown, pricing: ModelPricing | undefined): number {
    if (!pricing) return 0;
    if (model === CLAIRIC) {
        return isSystemOneResponse(body)
            ? body.usage.input_tokens * pricing.inputNanoUsdPerToken + body.usage.output_tokens * pricing.outputNanoUsdPerToken
            : 0;
    }
    const usage = readGeminiUsage(body);
    if (!usage) return 0;
    const cachedPrice = pricing.cachedInputNanoUsdPerToken ?? pricing.inputNanoUsdPerToken;
    return (usage.inputTokens - usage.cachedInputTokens) * pricing.inputNanoUsdPerToken
        + usage.cachedInputTokens * cachedPrice
        + usage.outputTokens * pricing.outputNanoUsdPerToken;
}

/** Scores one document for one model from its exchanges; the last exchange holds the answer. */
export function scoreCase(extractionCase: ExtractionCase, document: DocumentContent, calls: RecordedCall[], pricing: ModelPricing | undefined): CaseOutcome {
    const last = calls[calls.length - 1];
    if (!last) throw new Error(`No calls for ${extractionCase.id}.`);
    const base: CaseOutcome = {
        caseId: extractionCase.id,
        model: last.model,
        tags: extractionCase.tags,
        stated: mapFields(field => expectedValue(field, extractionCase.expected) !== null),
        calls: calls.length,
        latencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0),
        costNanoUsd: calls.reduce((sum, call) => sum + callCost(call.model, call.body, pricing), 0),
    };
    if (last.status !== 200) {
        return { ...base, error: `HTTP ${last.status} ${readSystemOneError(last.body)?.code ?? 'invalid_response'}` };
    }
    if (last.model === CLAIRIC) {
        if (!isSystemOneResponse(last.body)) return { ...base, error: 'invalid_response' };
        const extraction = readClairic(last.body);
        if (!extraction) return { ...base, error: 'invalid_answer' };
        const request = buildClairicRequest(last.model, extractionCase, document);
        return { ...base, ...scoreExtraction(extractionCase, extraction), spans: checkSpans(last.body, request, Boolean(extractionCase.image)) };
    }
    const answer = readGeminiAnswer(last.body);
    if (!answer) return { ...base, error: 'invalid_answer' };
    return { ...base, ...scoreExtraction(extractionCase, readGemini(answer.transaction)) };
}

export interface Ratio {
    hits: number;
    total: number;
}

export interface FieldSummary {
    /** Correct values and correct nulls over all documents. */
    accuracy: Ratio;
    /** Correct values where the document states the field. */
    present: Ratio;
    /** Nulls where the document does not state the field. */
    absent: Ratio;
    /** Correct guesses where the document states the field, for models that return guesses. */
    presentGuess?: Ratio;
    wrong: number;
    missed: number;
    hallucinated: number;
}

export interface ThresholdRow {
    threshold: number;
    kept: number;
    correct: number;
    /** Correct kept values over all fields the documents state. */
    coverage: Ratio;
}

export interface ItemsSummary {
    lineItemsExact: Ratio;
    /** Documents whose items add up to the model's total. */
    verified: Ratio;
    verifiedCorrect: Ratio;
    unverifiedCorrect: Ratio;
}

export interface ModelSummary {
    model: string;
    documents: number;
    calls: number;
    errors: number;
    accuracy: Ratio;
    /** Field accuracy on documents given as text, without the image documents. */
    textAccuracy: Ratio;
    byField: Record<FieldName, FieldSummary>;
    absent: Ratio;
    presentGuess?: Ratio;
    hallucinated: number;
    missed: number;
    /** Dates answered with the reference date when the document's date differs. */
    referenceDates: number;
    byConfidence?: ThresholdRow[];
    pNullBrier?: number;
    items?: ItemsSummary;
    spans?: SpanCheck;
    byTag: Record<string, Ratio>;
    latencyMs: { mean: number; p50: number; p95: number; max: number };
    costNanoUsd: { meanPerDocument: number; total: number };
}

export const CONFIDENCE_THRESHOLDS = [0, 0.5, 0.7, 0.9, 0.99];

function ratio<T>(items: T[], predicate: (item: T) => boolean): Ratio {
    return { hits: items.filter(predicate).length, total: items.length };
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function isNotStated(result: FieldResult): boolean {
    return result.outcome === 'correct_null' || result.outcome === 'hallucinated';
}

function isCorrect(result: FieldResult | undefined): boolean {
    return result?.outcome === 'correct' || result?.outcome === 'correct_null';
}

function guessRatio(outcomes: CaseOutcome[], fields: readonly FieldName[]): Ratio | undefined {
    const stated = outcomes.flatMap(outcome => fields.filter(field => outcome.stated[field]).map(field => outcome.fields?.[field]));
    if (!stated.some(result => result?.guessCorrect !== undefined)) return undefined;
    return ratio(stated, result => result?.guessCorrect === true);
}

function summarizeField(outcomes: CaseOutcome[], field: FieldName): FieldSummary {
    const results = outcomes.map(outcome => outcome.fields?.[field]);
    const presentGuess = guessRatio(outcomes, [field]);
    return {
        ...(presentGuess ? { presentGuess } : {}),
        accuracy: ratio(results, isCorrect),
        present: ratio(outcomes.filter(outcome => outcome.stated[field]), outcome => outcome.fields?.[field].outcome === 'correct'),
        absent: ratio(outcomes.filter(outcome => !outcome.stated[field]), outcome => outcome.fields?.[field].outcome === 'correct_null'),
        wrong: results.filter(result => result?.outcome === 'wrong').length,
        missed: results.filter(result => result?.outcome === 'missed').length,
        hallucinated: results.filter(result => result?.outcome === 'hallucinated').length,
    };
}

function sumSpans(checks: SpanCheck[]): SpanCheck {
    const total: SpanCheck = { textSpans: 0, textSpansMatching: 0, otherSpans: 0, otherSpansInBounds: 0, imageSpans: 0 };
    for (const check of checks) {
        total.textSpans += check.textSpans;
        total.textSpansMatching += check.textSpansMatching;
        total.otherSpans += check.otherSpans;
        total.otherSpansInBounds += check.otherSpansInBounds;
        total.imageSpans += check.imageSpans;
    }
    return total;
}

export function summarize(model: string, outcomes: CaseOutcome[]): ModelSummary {
    const results = outcomes.flatMap(outcome => FIELDS.map(field => outcome.fields?.[field]));
    const answered = results.filter((result): result is FieldResult => result !== undefined);
    const stated = outcomes.reduce((sum, outcome) => sum + FIELDS.filter(field => outcome.stated[field]).length, 0);
    const notStated = outcomes.flatMap(outcome => FIELDS.filter(field => !outcome.stated[field]).map(field => outcome.fields?.[field]));
    const latencies = outcomes.filter(outcome => !outcome.error).map(outcome => outcome.latencyMs).sort((left, right) => left - right);
    const totalCost = outcomes.reduce((sum, outcome) => sum + outcome.costNanoUsd, 0);

    const withConfidence = answered.filter(result => result.confidence !== undefined
        && (result.outcome === 'correct' || result.outcome === 'wrong' || result.outcome === 'hallucinated'));
    const byConfidence = answered.some(result => result.confidence !== undefined)
        ? CONFIDENCE_THRESHOLDS.map(threshold => {
            const kept = withConfidence.filter(result => (result.confidence ?? 0) >= threshold);
            const correct = kept.filter(result => result.outcome === 'correct').length;
            return { threshold, kept: kept.length, correct, coverage: { hits: correct, total: stated } };
        })
        : undefined;
    const brierTerms = answered
        .filter(result => result.pNull !== undefined)
        .map(result => ((result.pNull ?? 0) - (isNotStated(result) ? 1 : 0)) ** 2);

    const scored = outcomes.filter(outcome => outcome.totalVerified !== undefined);
    const items: ItemsSummary | undefined = scored.length > 0
        ? {
            lineItemsExact: ratio(scored.filter(outcome => outcome.lineItemsExact !== undefined), outcome => outcome.lineItemsExact === true),
            verified: ratio(scored, outcome => outcome.totalVerified === true),
            verifiedCorrect: ratio(scored.filter(outcome => outcome.totalVerified), outcome => outcome.totalCorrect === true),
            unverifiedCorrect: ratio(scored.filter(outcome => !outcome.totalVerified && outcome.fields?.total.outcome !== 'correct_null'), outcome => outcome.totalCorrect === true),
        }
        : undefined;
    const presentGuess = guessRatio(outcomes, FIELDS);
    const spanChecks = outcomes.flatMap(outcome => outcome.spans ? [outcome.spans] : []);

    const byTag: Record<string, Ratio> = {};
    for (const tag of [...new Set(outcomes.flatMap(outcome => outcome.tags))].sort()) {
        const tagged = outcomes.filter(outcome => outcome.tags.includes(tag)).flatMap(outcome => FIELDS.map(field => outcome.fields?.[field]));
        byTag[tag] = ratio(tagged, isCorrect);
    }

    return {
        model,
        documents: outcomes.length,
        calls: outcomes.reduce((sum, outcome) => sum + outcome.calls, 0),
        errors: outcomes.filter(outcome => outcome.error).length,
        accuracy: ratio(results, isCorrect),
        textAccuracy: ratio(outcomes.filter(outcome => !outcome.tags.includes('image')).flatMap(outcome => FIELDS.map(field => outcome.fields?.[field])), isCorrect),
        byField: mapFields(field => summarizeField(outcomes, field)),
        absent: ratio(notStated, result => result?.outcome === 'correct_null'),
        ...(presentGuess ? { presentGuess } : {}),
        hallucinated: answered.filter(result => result.outcome === 'hallucinated').length,
        missed: answered.filter(result => result.outcome === 'missed').length,
        referenceDates: outcomes.filter(outcome => outcome.dateIsReference).length,
        ...(byConfidence ? { byConfidence } : {}),
        ...(brierTerms.length ? { pNullBrier: brierTerms.reduce((sum, term) => sum + term, 0) / brierTerms.length } : {}),
        ...(items ? { items } : {}),
        ...(spanChecks.length ? { spans: sumSpans(spanChecks) } : {}),
        byTag,
        latencyMs: {
            mean: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0,
            p50: percentile(latencies, 0.5),
            p95: percentile(latencies, 0.95),
            max: latencies[latencies.length - 1] ?? 0,
        },
        costNanoUsd: { meanPerDocument: outcomes.length ? totalCost / outcomes.length : 0, total: totalCost },
    };
}

function requestMatches(call: RecordedCall, extractionCase: ExtractionCase, document: DocumentContent): boolean {
    if (call.model === CLAIRIC) {
        return JSON.stringify(call.request) === JSON.stringify(buildClairicRequest(call.model, extractionCase, document));
    }
    if (call.model === GEMINI) return geminiRequestMatches(call.request, document);
    throw new Error(`Recorded call for an unknown model: ${call.model}`);
}

export interface Scores {
    summaries: ModelSummary[];
    outcomes: CaseOutcome[];
}

/** Scores every recorded call against its case; calls for unknown cases or stale requests are an error. */
export function scoreRecording(cases: ExtractionCase[], documents: Map<string, DocumentContent>, recording: Recording): Scores {
    const casesById = new Map(cases.map(extractionCase => [extractionCase.id, extractionCase]));
    const callsByKey = new Map<string, RecordedCall[]>();
    for (const call of recording.calls) {
        const extractionCase = casesById.get(call.caseId);
        const document = documents.get(call.caseId);
        if (!extractionCase || !document) throw new Error(`Recorded call for unknown case: ${call.caseId}`);
        if (!requestMatches(call, extractionCase, document)) {
            throw new Error(`Recorded request differs from the current case: ${call.caseId} (${call.model})`);
        }
        const key = JSON.stringify([call.model, call.caseId]);
        callsByKey.set(key, [...callsByKey.get(key) ?? [], call]);
    }
    const outcomes = [...callsByKey.values()].map(calls => {
        const first = calls[0];
        const extractionCase = casesById.get(first.caseId);
        const document = documents.get(first.caseId);
        if (!extractionCase || !document) throw new Error(`Recorded call for unknown case: ${first.caseId}`);
        return scoreCase(extractionCase, document, calls, recording.pricing[first.model]);
    });
    const models = [...new Set(outcomes.map(outcome => outcome.model))];
    return {
        summaries: models.map(model => summarize(model, outcomes.filter(outcome => outcome.model === model))),
        outcomes,
    };
}

function formatRatio({ hits, total }: Ratio): string {
    return `${hits}/${total} (${total ? ((hits / total) * 100).toFixed(1) : '0.0'}%)`;
}

function formatCount({ hits, total }: Ratio): string {
    return total ? formatRatio({ hits, total }) : 'none returned';
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

function failures(outcome: CaseOutcome): string {
    if (outcome.error) return outcome.error;
    const failed = FIELDS.flatMap(field => {
        const result = outcome.fields?.[field];
        return result && !isCorrect(result) ? [`${field} ${result.outcome}`] : [];
    });
    if (outcome.lineItemsExact === false) failed.push('line items differ');
    return failed.length ? failed.join(', ') : '—';
}

/** The deterministic results section, reproducible from a recording. */
export function renderReport({ summaries, outcomes }: Scores): string {
    const models = summaries.map(summary => summary.model);
    const row = (label: string, value: (summary: ModelSummary) => string) => [label, ...summaries.map(value)];
    const optional = <T>(value: T | undefined, format: (value: T) => string) => value === undefined ? '—' : format(value);
    const tags = [...new Set(summaries.flatMap(summary => Object.keys(summary.byTag)))].sort();
    const withConfidence = summaries.filter(summary => summary.byConfidence);
    const caseIds = [...new Set(outcomes.map(outcome => outcome.caseId))];

    return [
        '### Summary',
        '',
        table(['Metric', ...models], [
            row('Documents (calls, errors)', summary => `${summary.documents} (${summary.calls}, ${summary.errors})`),
            row('Field accuracy, all fields', summary => formatRatio(summary.accuracy)),
            row('Field accuracy, text documents', summary => formatRatio(summary.textAccuracy)),
            row('Nulls where the document states no value', summary => formatRatio(summary.absent)),
            row('Hallucinated values', summary => String(summary.hallucinated)),
            row('Missed values (null where stated)', summary => String(summary.missed)),
            row('Stated fields whose guess is correct, ignoring p_null', summary => optional(summary.presentGuess, formatRatio)),
            row(`Dates answered with the reference date (${REFERENCE_DATE}) when the document's date differs`, summary => String(summary.referenceDates)),
            row('p_null Brier score (lower is better)', summary => optional(summary.pNullBrier, value => value.toFixed(3))),
            row('Latency per document mean / p50 / p95 / max (ms)', summary => [summary.latencyMs.mean, summary.latencyMs.p50, summary.latencyMs.p95, summary.latencyMs.max].map(Math.round).join(' / ')),
            row('Cost per document (mean)', summary => formatUsd(summary.costNanoUsd.meanPerDocument)),
            row('Cost, all documents', summary => formatUsd(summary.costNanoUsd.total)),
        ]),
        '',
        '### Accuracy by field',
        '',
        'Accuracy counts correct values and correct nulls. Stated: correct values where the document states the field. Not stated: nulls where it does not. Guess: correct guesses where the document states the field, whatever `p_null` says.',
        '',
        table(['Field', 'Model', 'Accuracy', 'Stated', 'Not stated', 'Guess', 'Wrong', 'Missed', 'Hallucinated'],
            FIELDS.flatMap(field => summaries.map(summary => {
                const fieldSummary = summary.byField[field];
                return [
                    field,
                    summary.model,
                    formatRatio(fieldSummary.accuracy),
                    formatRatio(fieldSummary.present),
                    fieldSummary.absent.total ? formatRatio(fieldSummary.absent) : '—',
                    optional(fieldSummary.presentGuess, formatRatio),
                    String(fieldSummary.wrong),
                    String(fieldSummary.missed),
                    String(fieldSummary.hallucinated),
                ];
            }))),
        '',
        '### Confidence thresholds',
        '',
        'Accept a non-null value only when its confidence is at least the threshold, over all six fields. Precision is correct values over accepted values; coverage is correct accepted values over all fields the documents state.',
        '',
        withConfidence.length
            ? table(['Model', 'Confidence ≥', 'Accepted', 'Precision', 'Coverage'],
                withConfidence.flatMap(summary => (summary.byConfidence ?? []).map(threshold => [
                    summary.model,
                    threshold.threshold.toFixed(2),
                    String(threshold.kept),
                    formatRatio({ hits: threshold.correct, total: threshold.kept }),
                    formatRatio(threshold.coverage),
                ])))
            : 'No model returned confidences.',
        '',
        '### Totals checked against items',
        '',
        'Code adds the item amounts and charges and subtracts the discounts the model read, then compares the sum with the model\'s total.',
        '',
        table(['Metric', ...models], [
            row('Item amounts exact, itemized documents', summary => optional(summary.items, items => formatRatio(items.lineItemsExact))),
            row('Totals verified by items', summary => optional(summary.items, items => formatRatio(items.verified))),
            row('Verified totals that are correct', summary => optional(summary.items, items => formatRatio(items.verifiedCorrect))),
            row('Unverified totals that are correct', summary => optional(summary.items, items => formatRatio(items.unverifiedCorrect))),
        ]),
        '',
        '### Spans',
        '',
        table(['Metric', ...models], [
            row('Text spans covering exactly the guess', summary => optional(summary.spans, spans => formatCount({ hits: spans.textSpansMatching, total: spans.textSpans }))),
            row('Number, date and item spans within the text', summary => optional(summary.spans, spans => formatCount({ hits: spans.otherSpansInBounds, total: spans.otherSpans }))),
            row('Spans on image documents', summary => optional(summary.spans, spans => String(spans.imageSpans))),
        ]),
        '',
        '### Field accuracy by tag',
        '',
        table(['Tag', ...models], tags.map(tag => row(tag, summary => summary.byTag[tag] ? formatRatio(summary.byTag[tag]) : '—'))),
        '',
        '### Misses by document',
        '',
        table(['Document', ...models], caseIds.map(caseId => [
            caseId,
            ...models.map(model => {
                const outcome = outcomes.find(candidate => candidate.caseId === caseId && candidate.model === model);
                return outcome ? failures(outcome) : 'not run';
            }),
        ])),
    ].join('\n');
}
