import {
    elapsedMilliseconds,
    silentPerformanceMonitor,
    type PerformanceMonitor,
} from '../observability';
import { isPlausiblePair, type TransactionFingerprint } from './candidate-service';

const AI_URL = 'https://ai.bkper.app/v1/evaluations';
const MODEL = 'jev';
const MAX_QUESTIONS_PER_REQUEST = 25;
const MAX_REQUEST_BYTES = 100_000;
const MAX_AI_TEXT_CHARACTERS = 200;
const MAX_AI_PROPERTY_KEY_CHARACTERS = 30;
const MAX_AI_PROPERTY_VALUE_CHARACTERS = 256;

const SCORE_LEVELS = [
    'Different movement: the records describe different real-world movements, conflict materially, or match a human-rejected false positive.',
    'Possible duplicate: the records may describe the same real-world movement, but the semantic evidence is not compelling.',
    'Strong duplicate: the records compellingly describe one and the same real-world movement.',
] as const;

interface CandidatePair {
    firstIndex: number;
    secondIndex: number;
}

interface ScoredPair extends CandidatePair {
    score: number;
    strength: 'Strong' | 'Possible';
}

export interface AiSuggestedPair extends CandidatePair {
    strength: 'Strong' | 'Possible';
    explanation: string;
}

export interface AiAnalysis {
    pairs: AiSuggestedPair[];
}

export class BkperAiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'BkperAiError';
    }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function analyzeCandidateTransactions(
    transactions: readonly TransactionFingerprint[],
    learningExamples: readonly string[],
    fetcher: Fetcher = fetch,
    performanceMonitor: PerformanceMonitor = silentPerformanceMonitor
): Promise<AiAnalysis> {
    const candidatePairs = collectCandidatePairs(transactions);
    if (candidatePairs.length === 0) return { pairs: [] };

    const scoredPairs: ScoredPair[] = [];
    const batchCount = countEvaluationBatches(candidatePairs.length);
    for (let offset = 0; offset < candidatePairs.length; offset += MAX_QUESTIONS_PER_REQUEST) {
        const batch = candidatePairs.slice(offset, offset + MAX_QUESTIONS_PER_REQUEST);
        const batchNumber = Math.floor(offset / MAX_QUESTIONS_PER_REQUEST) + 1;
        const requestBody = buildEvaluationRequest(transactions, batch, learningExamples);
        const requestBytes = requestByteLength(requestBody);
        const startedAt = performanceMonitor.now();
        try {
            const response = await callEvaluation(requestBody, fetcher);
            scoredPairs.push(...readBatchScores(response, batch));
            performanceMonitor.log('jev.batch.completed', {
                batch: batchNumber,
                batches: batchCount,
                questions: batch.length,
                requestBytes,
                durationMs: elapsedMilliseconds(startedAt, performanceMonitor.now()),
            });
        } catch (error) {
            performanceMonitor.log('jev.batch.failed', {
                batch: batchNumber,
                batches: batchCount,
                questions: batch.length,
                requestBytes,
                durationMs: elapsedMilliseconds(startedAt, performanceMonitor.now()),
                errorCode: performanceErrorCode(error),
            });
            throw error;
        }
    }

    return {
        pairs: selectNonOverlappingPairs(scoredPairs).map(pair => ({
            firstIndex: pair.firstIndex,
            secondIndex: pair.secondIndex,
            strength: pair.strength,
            explanation: explainPair(transactions[pair.firstIndex], transactions[pair.secondIndex]),
        })),
    };
}

export function countEvaluationBatches(candidatePairCount: number): number {
    return Math.ceil(candidatePairCount / MAX_QUESTIONS_PER_REQUEST);
}

function collectCandidatePairs(transactions: readonly TransactionFingerprint[]): CandidatePair[] {
    const pairs: CandidatePair[] = [];
    for (let firstIndex = 0; firstIndex < transactions.length; firstIndex += 1) {
        for (
            let secondIndex = firstIndex + 1;
            secondIndex < transactions.length;
            secondIndex += 1
        ) {
            if (isPlausiblePair(transactions[firstIndex], transactions[secondIndex])) {
                pairs.push({ firstIndex, secondIndex });
            }
        }
    }
    return pairs;
}

function buildEvaluationRequest(
    transactions: readonly TransactionFingerprint[],
    pairs: readonly CandidatePair[],
    learningExamples: readonly string[]
): Record<string, unknown> {
    const transactionIndexes = [
        ...new Set(pairs.flatMap(pair => [pair.firstIndex, pair.secondIndex])),
    ];
    const localIndexByGlobal = new Map(
        transactionIndexes.map((globalIndex, localIndex) => [globalIndex, localIndex] as const)
    );
    const batchTransactions = transactionIndexes.map(index => transactions[index]);

    const createBody = (includeLearning: boolean, includeProperties: boolean) => ({
        model: MODEL,
        state: {
            humanRejectedPairs: includeLearning ? learningExamples : [],
            candidateTransactions: toAiSnapshots(batchTransactions, includeProperties),
        },
        questions: Object.fromEntries(
            pairs.map(pair => {
                const first = localIndexByGlobal.get(pair.firstIndex);
                const second = localIndexByGlobal.get(pair.secondIndex);
                if (first === undefined || second === undefined) {
                    throw new Error('Candidate transaction index was not mapped.');
                }
                return [
                    pairId(pair),
                    {
                        type: 'score',
                        instructions: {
                            question:
                                'How do these two transaction records relate as real-world movements?',
                            compare: [
                                `\`candidateTransactions[${first}]\``,
                                `\`candidateTransactions[${second}]\``,
                            ],
                            knownFacts: [
                                'Their amounts are exactly equal.',
                                'Their dates are within seven calendar days.',
                                'They passed the deterministic Account-side or draft-recovery rule.',
                            ],
                            rejectedExamples:
                                'Pairs equivalent to humanRejectedPairs are confirmed false positives.',
                        },
                        criteria: SCORE_LEVELS,
                    },
                ];
            })
        ),
    });

    const withAllContext = createBody(true, true);
    if (requestByteLength(withAllContext) <= MAX_REQUEST_BYTES) return withAllContext;

    const withoutLearning = createBody(false, true);
    if (requestByteLength(withoutLearning) <= MAX_REQUEST_BYTES) return withoutLearning;

    const requiredContext = createBody(false, false);
    if (requestByteLength(requiredContext) <= MAX_REQUEST_BYTES) return requiredContext;

    throw new BkperAiError(
        400,
        'analysis_input_too_large',
        'Transaction context is too large to analyze safely.'
    );
}

async function callEvaluation(body: Record<string, unknown>, fetcher: Fetcher): Promise<unknown> {
    let response: Response;
    try {
        response = await fetcher(
            new Request(AI_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            })
        );
    } catch {
        throw new BkperAiError(502, 'connection_error', 'Bkper AI could not be reached.');
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new BkperAiError(502, 'invalid_response', 'Bkper AI returned an invalid response.');
    }

    if (!response.ok) {
        const error = readAiError(payload);
        throw new BkperAiError(
            response.status === 503 ? 502 : response.status,
            error?.code ?? 'bkper_ai_error',
            error?.message ?? `Bkper AI returned an error (${response.status}).`
        );
    }
    return payload;
}

function readBatchScores(value: unknown, pairs: readonly CandidatePair[]): ScoredPair[] {
    if (!isRecord(value) || value.model !== MODEL || !isRecord(value.answers)) {
        throw invalidResponse();
    }
    const answers = value.answers;
    const expectedIds = pairs.map(pairId);
    const returnedIds = Object.keys(answers);
    if (
        returnedIds.length !== expectedIds.length ||
        expectedIds.some(id => !Object.hasOwn(answers, id))
    ) {
        throw invalidResponse();
    }

    return pairs.flatMap(pair => {
        const answer = answers[pairId(pair)];
        if (
            !isRecord(answer) ||
            answer.type !== 'score' ||
            typeof answer.score !== 'number' ||
            !Number.isFinite(answer.score) ||
            answer.score < 0 ||
            answer.score > 2
        ) {
            throw invalidResponse();
        }
        if (answer.score < 0.5) return [];
        return [
            {
                ...pair,
                score: answer.score,
                strength: answer.score >= 1.5 ? ('Strong' as const) : ('Possible' as const),
            },
        ];
    });
}

function selectNonOverlappingPairs(pairs: readonly ScoredPair[]): ScoredPair[] {
    const ranked = [...pairs].sort(
        (left, right) =>
            Number(right.strength === 'Strong') - Number(left.strength === 'Strong') ||
            right.score - left.score ||
            left.firstIndex - right.firstIndex ||
            left.secondIndex - right.secondIndex
    );
    const usedIndexes = new Set<number>();
    const selected: ScoredPair[] = [];
    for (const pair of ranked) {
        if (usedIndexes.has(pair.firstIndex) || usedIndexes.has(pair.secondIndex)) continue;
        usedIndexes.add(pair.firstIndex);
        usedIndexes.add(pair.secondIndex);
        selected.push(pair);
    }
    return selected;
}

function explainPair(first: TransactionFingerprint, second: TransactionFingerprint): string {
    const account =
        sharedAccountExplanation(first.fromAccount, second.fromAccount, 'From') ??
        sharedAccountExplanation(first.toAccount, second.toAccount, 'To');
    const evidence = account ?? 'Draft recovery candidate';
    const days = calendarDayDistance(first.date, second.date);
    const date = days === 0 ? 'Same date' : `${days} day${days === 1 ? '' : 's'} apart`;
    return `${evidence} · ${date}`;
}

function sharedAccountExplanation(
    first: TransactionFingerprint['fromAccount'],
    second: TransactionFingerprint['fromAccount'],
    side: 'From' | 'To'
): string | undefined {
    if (!first || !second || first.id !== second.id) return undefined;
    return `Same ${side} Account: ${first.name || second.name || 'Unnamed'}`;
}

function calendarDayDistance(first: string, second: string): number {
    return Math.round(
        Math.abs(Date.parse(`${first}T00:00:00Z`) - Date.parse(`${second}T00:00:00Z`)) / 86_400_000
    );
}

function pairId(pair: CandidatePair): string {
    return `pair_${pair.firstIndex}_${pair.secondIndex}`;
}

function requestByteLength(body: Record<string, unknown>): number {
    return new TextEncoder().encode(JSON.stringify(body)).byteLength;
}

function toAiSnapshots(
    transactions: readonly TransactionFingerprint[],
    includeProperties: boolean
): Array<Record<string, unknown>> {
    const accountReferences = new Map<string, number>();
    const accountSnapshot = (account: TransactionFingerprint['fromAccount']) => {
        if (!account) return null;
        let reference = accountReferences.get(account.id);
        if (reference === undefined) {
            reference = accountReferences.size;
            accountReferences.set(account.id, reference);
        }
        return { reference, name: truncateAiText(account.name) };
    };

    return transactions.map(transaction => ({
        date: transaction.date,
        amount: transaction.amount,
        description: truncateAiText(transaction.description),
        fromAccount: accountSnapshot(transaction.fromAccount),
        toAccount: accountSnapshot(transaction.toAccount),
        ...(includeProperties ? { properties: toAiProperties(transaction.properties) } : {}),
        draft: transaction.draft,
    }));
}

function truncateAiText(value: string): string {
    return value.slice(0, MAX_AI_TEXT_CHARACTERS);
}

function toAiProperties(properties: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(properties).filter(
            ([key, value]) =>
                !key.endsWith('_') &&
                key.length <= MAX_AI_PROPERTY_KEY_CHARACTERS &&
                value.length <= MAX_AI_PROPERTY_VALUE_CHARACTERS
        )
    );
}

function invalidResponse(): BkperAiError {
    return new BkperAiError(502, 'invalid_response', 'Bkper AI returned an invalid response.');
}

function performanceErrorCode(error: unknown): string {
    return error instanceof BkperAiError ? error.code : 'unexpected_error';
}

function readAiError(payload: unknown): { code: string; message: string } | undefined {
    if (
        !isRecord(payload) ||
        !isRecord(payload.error) ||
        typeof payload.error.code !== 'string' ||
        typeof payload.error.message !== 'string'
    ) {
        return undefined;
    }
    return { code: payload.error.code, message: payload.error.message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
