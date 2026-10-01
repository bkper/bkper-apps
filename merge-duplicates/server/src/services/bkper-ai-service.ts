import {
    APIConnectionError,
    APIError,
    TypeSafeClient,
    type JsonValue,
    type ScoreQuestion,
    type SystemOneRequest,
    type SystemOneResult,
} from '@typesafe-ai/sdk';
import {
    elapsedMilliseconds,
    silentPerformanceMonitor,
    type PerformanceMonitor,
} from '../observability';
import { isPlausiblePair, type TransactionFingerprint } from './candidate-service';

// TypeSafe SDK clients call `${baseURL}/v1/systemone`, which Bkper AI serves permanently.
const AI_BASE_URL = 'https://ai.bkper.app';
// Bkper Platform outbound replaces this with the current user's token and app attribution,
// so the Worker never reads or forwards a user credential.
const PLATFORM_AUTHORIZATION_PLACEHOLDER = 'bkper-platform-outbound';
const MODEL = 'jev';
const MAX_REQUEST_BYTES = 100_000;
const MAX_AI_TEXT_CHARACTERS = 200;
const MAX_AI_PROPERTY_KEY_CHARACTERS = 30;
const MAX_AI_PROPERTY_VALUE_CHARACTERS = 256;

const SCORE_LEVELS = [
    'Different: the records describe distinct movements. Equal amount or nearby dates alone are insufficient.',
    'Possible: the records likely describe one movement, but meaningful uncertainty remains.',
    'Strong: compatible Account information, descriptions, or references compellingly identify one movement. Missing Accounts and plausible statement-processing delays do not disqualify it.',
] as const;

interface CandidatePair {
    firstIndex: number;
    secondIndex: number;
}

type AccountPath = 'SAME' | 'COMPATIBLE_PARTIAL' | 'INSUFFICIENT' | 'CONFLICTING';

type PairQuestions = Record<string, ScoreQuestion<typeof SCORE_LEVELS>>;
type EvaluationRequest = SystemOneRequest<PairQuestions>;
type EvaluationResult = SystemOneResult<PairQuestions>;

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
    batchCount: number;
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
    if (candidatePairs.length === 0) return { pairs: [], batchCount: 0 };

    const batches = planEvaluationBatches(transactions, candidatePairs, learningExamples);
    const client = createAiClient(fetcher);
    const scoredPairs: ScoredPair[] = [];
    const batchCount = batches.length;
    for (const [batchIndex, batch] of batches.entries()) {
        const batchNumber = batchIndex + 1;
        const requestBody = buildEvaluationRequest(transactions, batch, learningExamples);
        const requestBytes = requestByteLength(requestBody);
        const startedAt = performanceMonitor.now();
        try {
            const response = await callEvaluation(requestBody, client);
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
        batchCount,
    };
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

function planEvaluationBatches(
    transactions: readonly TransactionFingerprint[],
    pairs: readonly CandidatePair[],
    learningExamples: readonly string[]
): CandidatePair[][] {
    const batches: CandidatePair[][] = [];
    let offset = 0;

    while (offset < pairs.length) {
        let bestEnd = offset + 1;
        const firstPair = pairs.slice(offset, bestEnd);
        if (fullContextRequestFits(transactions, firstPair, learningExamples)) {
            let step = 1;
            while (bestEnd < pairs.length) {
                const probeEnd = Math.min(pairs.length, bestEnd + step);
                const probe = pairs.slice(offset, probeEnd);
                if (fullContextRequestFits(transactions, probe, learningExamples)) {
                    bestEnd = probeEnd;
                    step *= 2;
                    continue;
                }

                let low = bestEnd + 1;
                let high = probeEnd - 1;
                while (low <= high) {
                    const middle = Math.floor((low + high) / 2);
                    const candidate = pairs.slice(offset, middle);
                    if (fullContextRequestFits(transactions, candidate, learningExamples)) {
                        bestEnd = middle;
                        low = middle + 1;
                    } else {
                        high = middle - 1;
                    }
                }
                break;
            }
        }
        batches.push(pairs.slice(offset, bestEnd));
        offset = bestEnd;
    }

    return batches;
}

function fullContextRequestFits(
    transactions: readonly TransactionFingerprint[],
    pairs: readonly CandidatePair[],
    learningExamples: readonly string[]
): boolean {
    return (
        requestByteLength(
            createEvaluationRequest(transactions, pairs, learningExamples, true, true)
        ) <= MAX_REQUEST_BYTES
    );
}

function buildEvaluationRequest(
    transactions: readonly TransactionFingerprint[],
    pairs: readonly CandidatePair[],
    learningExamples: readonly string[]
): EvaluationRequest {
    const withAllContext = createEvaluationRequest(
        transactions,
        pairs,
        learningExamples,
        true,
        true
    );
    if (requestByteLength(withAllContext) <= MAX_REQUEST_BYTES) return withAllContext;

    const withoutLearning = createEvaluationRequest(
        transactions,
        pairs,
        learningExamples,
        false,
        true
    );
    if (requestByteLength(withoutLearning) <= MAX_REQUEST_BYTES) return withoutLearning;

    const requiredContext = createEvaluationRequest(
        transactions,
        pairs,
        learningExamples,
        false,
        false
    );
    if (requestByteLength(requiredContext) <= MAX_REQUEST_BYTES) return requiredContext;

    throw new BkperAiError(
        400,
        'analysis_input_too_large',
        'Transaction context is too large to analyze safely.'
    );
}

function createEvaluationRequest(
    transactions: readonly TransactionFingerprint[],
    pairs: readonly CandidatePair[],
    learningExamples: readonly string[],
    includeLearning: boolean,
    includeProperties: boolean
): EvaluationRequest {
    return {
        state: {
            humanRejectedPairs: includeLearning ? [...learningExamples] : [],
        },
        questions: Object.fromEntries(
            pairs.map(pair => {
                const first = transactions[pair.firstIndex];
                const second = transactions[pair.secondIndex];
                if (!first || !second) {
                    throw new Error('Candidate transaction index was not mapped.');
                }
                return [
                    pairId(pair),
                    {
                        type: 'score' as const,
                        instructions: {
                            question:
                                'Do the two `transactions` describe duplicate records of one real-world movement? Duplicate imports can have complementary partial Account paths. Treat missing Accounts as unknown and known Account conflicts as negative evidence. Use `accountPath` and `calendarDaysApart` as exact facts, and `humanRejectedPairs` only when closely analogous.',
                            transactions: toAiSnapshots([first, second], includeProperties),
                            accountPath: describeAccountPath(first, second),
                            calendarDaysApart: calendarDayDistance(first.date, second.date),
                        },
                        criteria: SCORE_LEVELS,
                    },
                ];
            })
        ),
    };
}

function createAiClient(fetcher: Fetcher): TypeSafeClient {
    return new TypeSafeClient({
        apiKey: PLATFORM_AUTHORIZATION_PLACEHOLDER,
        baseURL: AI_BASE_URL,
        defaultModel: MODEL,
        // The SDK invokes fetch as its own method; Workers' fetch rejects a foreign receiver.
        fetch: (input, init) => fetcher(input, init),
    });
}

async function callEvaluation(
    body: EvaluationRequest,
    client: TypeSafeClient
): Promise<EvaluationResult> {
    try {
        return await client.systemOne(body);
    } catch (error) {
        if (error instanceof APIError) {
            // Plain-text or empty bodies come from outside Bkper AI, such as platform outbound.
            if (!isRecord(error.body)) throw invalidResponse();
            const aiError = readAiError(error.body);
            throw new BkperAiError(
                error.status === 503 ? 502 : error.status,
                aiError?.code ?? 'bkper_ai_error',
                aiError?.message ?? `Bkper AI returned an error (${error.status}).`
            );
        }
        if (error instanceof APIConnectionError) {
            throw new BkperAiError(502, 'connection_error', 'Bkper AI could not be reached.');
        }
        throw error;
    }
}

// Bkper AI validates every answer against its question before responding.
function readBatchScores(result: EvaluationResult, pairs: readonly CandidatePair[]): ScoredPair[] {
    return pairs.flatMap(pair => {
        const answer = result.answers[pairId(pair)];
        const { 0: different, 1: possible, 2: strong } = answer.probabilities;
        if (different >= possible && different >= strong) return [];
        return [
            {
                ...pair,
                score: answer.score,
                strength:
                    strong > different && strong > possible
                        ? ('Strong' as const)
                        : ('Possible' as const),
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
    return selected.sort(
        (left, right) => left.firstIndex - right.firstIndex || left.secondIndex - right.secondIndex
    );
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

function describeAccountPath(
    first: TransactionFingerprint,
    second: TransactionFingerprint
): AccountPath {
    const sameFromAccount = sameAccount(first.fromAccount, second.fromAccount);
    const sameToAccount = sameAccount(first.toAccount, second.toAccount);
    if (sameFromAccount && sameToAccount) return 'SAME';

    const sharedAcrossOppositeSides =
        sameAccount(first.fromAccount, second.toAccount) ||
        sameAccount(first.toAccount, second.fromAccount);
    if (
        differentKnownAccounts(first.fromAccount, second.fromAccount) ||
        differentKnownAccounts(first.toAccount, second.toAccount) ||
        sharedAcrossOppositeSides
    ) {
        return 'CONFLICTING';
    }

    const hasMissingAccount =
        !first.fromAccount || !first.toAccount || !second.fromAccount || !second.toAccount;
    const combinedPathIsKnown =
        Boolean(first.fromAccount || second.fromAccount) &&
        Boolean(first.toAccount || second.toAccount);
    return hasMissingAccount && combinedPathIsKnown ? 'COMPATIBLE_PARTIAL' : 'INSUFFICIENT';
}

function sameAccount(
    first: TransactionFingerprint['fromAccount'],
    second: TransactionFingerprint['fromAccount']
): boolean {
    return first !== null && second !== null && first.id === second.id;
}

function differentKnownAccounts(
    first: TransactionFingerprint['fromAccount'],
    second: TransactionFingerprint['fromAccount']
): boolean {
    return first !== null && second !== null && first.id !== second.id;
}

function requestByteLength(body: EvaluationRequest): number {
    return new TextEncoder().encode(JSON.stringify(body)).byteLength;
}

function toAiSnapshots(
    transactions: readonly TransactionFingerprint[],
    includeProperties: boolean
): JsonValue[] {
    const accountReferences = new Map<string, number>();
    const accountSnapshot = (account: TransactionFingerprint['fromAccount']) => {
        if (!account) return null;
        let reference = accountReferences.get(account.id);
        if (reference === undefined) {
            reference = accountReferences.size;
            accountReferences.set(account.id, reference);
        }
        return {
            reference,
            name: truncateAiText(account.name),
            ...(account.type ? { type: account.type } : {}),
        };
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
