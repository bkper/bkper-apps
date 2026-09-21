import {
    elapsedMilliseconds,
    silentPerformanceMonitor,
    type PerformanceMonitor,
} from '../observability';
import { isPlausiblePair, type TransactionFingerprint } from './candidate-service';

const AI_URL = 'https://ai.bkper.app/v1/evaluations';
const MODEL = 'jev';
const MAX_REQUEST_BYTES = 100_000;
const MAX_AI_TEXT_CHARACTERS = 200;
const MAX_AI_PROPERTY_KEY_CHARACTERS = 30;
const MAX_AI_PROPERTY_VALUE_CHARACTERS = 256;

const EVALUATION_POLICY = [
    'Equal amount, dates no more than seven calendar days apart, and candidate eligibility are gates only; they are not duplicate evidence.',
    'Different merchants, payees, employees, purposes, `toAccount` identities, or business references are evidence of Different movements.',
    '`movementTopology.sameFromAccount` alone is weak evidence. Purchases from the same card or payments from the same cash Account remain separate movements.',
    '`movementTopology.sharedAcrossOppositeSides` usually describes consecutive movements, such as a card settlement followed by a merchant purchase, and is evidence of Different movements.',
    'Draft status permits evaluation despite incomplete Accounts, but it does not weaken conflicting semantic or Account evidence.',
    'Duplicate evidence requires matching distinctive description details, properties, references, or clearly complementary records of the same transfer.',
    'When `movementTopology.sameDate` and `movementTopology.samePath` are both true, complementary payment descriptions are compelling duplicate evidence.',
    'Repeated merchant descriptions when `movementTopology.sameDate` is false are separate recurring movements unless a distinctive reference also matches.',
    'Use `humanRejectedPairs` as negative evidence only when a prior rejection is closely analogous to the two records in `transactions`.',
] as const;

const SCORE_LEVELS = [
    'Different movement: evidence favors distinct movements, or distinctive evidence for the same movement is absent.',
    'Possible duplicate: the same movement is more likely than a different movement, with meaningful but incomplete corroboration.',
    'Strong duplicate: distinctive evidence compellingly identifies one and the same real-world movement.',
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
    const scoredPairs: ScoredPair[] = [];
    const batchCount = batches.length;
    for (const [batchIndex, batch] of batches.entries()) {
        const batchNumber = batchIndex + 1;
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
): Record<string, unknown> {
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
): Record<string, unknown> {
    return {
        model: MODEL,
        state: {
            evaluationPolicy: EVALUATION_POLICY,
            humanRejectedPairs: includeLearning ? learningExamples : [],
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
                        type: 'score',
                        instructions: {
                            question:
                                'Do the two records in `transactions` represent one real-world movement? Apply `evaluationPolicy`. Use `movementTopology` as exact facts and `humanRejectedPairs` only when closely analogous.',
                            transactions: toAiSnapshots([first, second], includeProperties),
                            movementTopology: describeMovementTopology(first, second),
                        },
                        criteria: SCORE_LEVELS,
                    },
                ];
            })
        ),
    };
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
        const [different, possible, strong] = readLevelProbabilities(answer.probabilities);
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

function describeMovementTopology(
    first: TransactionFingerprint,
    second: TransactionFingerprint
): Record<string, boolean> {
    const sameFromAccount = sameAccount(first.fromAccount, second.fromAccount);
    const sameToAccount = sameAccount(first.toAccount, second.toAccount);
    return {
        sameFromAccount,
        sameToAccount,
        samePath: sameFromAccount && sameToAccount,
        sharedAcrossOppositeSides:
            sameAccount(first.fromAccount, second.toAccount) ||
            sameAccount(first.toAccount, second.fromAccount),
        sameDescription:
            first.description.trim().toLowerCase() === second.description.trim().toLowerCase(),
        sameDate: first.date === second.date,
    };
}

function sameAccount(
    first: TransactionFingerprint['fromAccount'],
    second: TransactionFingerprint['fromAccount']
): boolean {
    return first !== null && second !== null && first.id === second.id;
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

function readLevelProbabilities(value: unknown): [number, number, number] {
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== '0,1,2') {
        throw invalidResponse();
    }
    const probabilities = ['0', '1', '2'].map(key => value[key]);
    if (
        probabilities.some(
            probability =>
                typeof probability !== 'number' ||
                !Number.isFinite(probability) ||
                probability < 0 ||
                probability > 1
        )
    ) {
        throw invalidResponse();
    }
    return probabilities as [number, number, number];
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
