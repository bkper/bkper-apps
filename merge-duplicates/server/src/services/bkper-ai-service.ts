import { createOpenResponses } from '@ai-sdk/open-responses';
import {
    APICallError,
    generateText,
    NoObjectGeneratedError,
    NoOutputGeneratedError,
    Output,
} from 'ai';
import { z } from 'zod';
import { isPlausiblePair, type TransactionFingerprint } from './candidate-service';

export const PROMPT_VERSION = 'merge-duplicates-v6';
const AI_URL = 'https://ai.bkper.app/v1/responses';
const MAX_AI_TEXT_CHARACTERS = 500;
const MAX_AI_PROPERTY_KEY_CHARACTERS = 30;
const MAX_AI_PROPERTY_VALUE_CHARACTERS = 256;
const MAX_AI_INPUT_BYTES = 500_000;

interface ModelAttempt {
    model: 'gemini-flash' | 'gpt-luna' | 'deepseek-flash';
    reasoningEffort: 'medium' | 'high';
    timeoutMs: number;
    temperature?: number;
}

const MODEL_ATTEMPTS: readonly ModelAttempt[] = [
    { model: 'gemini-flash', reasoningEffort: 'medium', temperature: 0.1, timeoutMs: 30_000 },
    { model: 'gpt-luna', reasoningEffort: 'high', timeoutMs: 90_000 },
    { model: 'deepseek-flash', reasoningEffort: 'high', timeoutMs: 180_000 },
];

export interface AiSuggestedPair {
    firstIndex: number;
    secondIndex: number;
    strength: 'Strong' | 'Possible';
    explanation: string;
}

export interface AiAnalysis {
    pairs: AiSuggestedPair[];
}

export interface AiAttemptFailure {
    model: string;
    status: number;
    code: string;
}

export class BkperAiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly attempts: readonly AiAttemptFailure[] = []
    ) {
        super(message);
        this.name = 'BkperAiError';
    }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function analyzeCandidateTransactions(
    transactions: readonly TransactionFingerprint[],
    learningExamples: readonly string[],
    fetcher: Fetcher = fetch
): Promise<AiAnalysis> {
    if (transactions.length < 2) return { pairs: [] };

    const inputText = buildAiInputText(transactions, learningExamples);
    const provider = createOpenResponses({
        name: 'bkper',
        url: AI_URL,
        fetch: withBkperAiDefaults(fetcher),
    });
    const failures: AiAttemptFailure[] = [];

    for (const attempt of MODEL_ATTEMPTS) {
        try {
            const result = await generateText({
                model: provider(attempt.model),
                instructions: defaultPrompt(),
                prompt: inputText,
                output: Output.object({
                    name: 'merge_duplicate_global_matching',
                    schema: analysisSchema(transactions.length),
                }),
                reasoning: attempt.reasoningEffort,
                ...(attempt.temperature === undefined ? {} : { temperature: attempt.temperature }),
                timeout: attempt.timeoutMs,
                maxRetries: 0,
                include: { responseBody: true },
            });
            if (!isCompletedResponse(result.response.body)) {
                throw new InvalidAiOutputError('Bkper AI did not return a complete response.');
            }
            return validateAnalysis(result.output, transactions);
        } catch (error) {
            if (isInvalidAiOutput(error)) {
                failures.push({ model: attempt.model, status: 200, code: 'invalid_output' });
                continue;
            }
            if (isTimeoutError(error)) {
                failures.push({
                    model: attempt.model,
                    status: 408,
                    code: 'provider_timeout',
                });
                continue;
            }
            if (!APICallError.isInstance(error) || error.statusCode === undefined) {
                failures.push({
                    model: attempt.model,
                    status: 0,
                    code: 'connection_error',
                });
                continue;
            }

            const upstreamError =
                readAiError(error.data) ?? readAiErrorResponseBody(error.responseBody);
            const failure = {
                model: attempt.model,
                status: error.statusCode,
                code: upstreamError?.code ?? 'invalid_response',
            };
            if (!isRetryableFailure(failure)) {
                throw new BkperAiError(
                    failure.status,
                    failure.code,
                    upstreamError?.message ??
                        `Bkper AI returned an invalid response (${failure.status}).`,
                    [...failures, failure]
                );
            }
            failures.push(failure);
        }
    }

    throw new BkperAiError(502, 'ai_providers_failed', formatFailures(failures), failures);
}

function withBkperAiDefaults(fetcher: Fetcher): Fetcher {
    return async (input, init) => {
        if (typeof init?.body !== 'string') {
            throw new Error('Bkper AI request body was not JSON.');
        }
        const body: unknown = JSON.parse(init.body);
        if (!isRecord(body)) {
            throw new Error('Bkper AI request body was not an object.');
        }
        return fetcher(
            new Request(input, {
                ...init,
                body: JSON.stringify({ ...body, stream: false, store: false }),
            })
        );
    };
}

function isRetryableFailure(failure: AiAttemptFailure): boolean {
    if (failure.code === 'usage_limit_exceeded') return false;
    if (
        failure.code === 'provider_rejected' ||
        failure.code === 'provider_rate_limited' ||
        failure.code === 'invalid_model'
    ) {
        return true;
    }
    return failure.status === 408 || failure.status >= 500;
}

function isTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.name === 'TimeoutError';
}

function isInvalidAiOutput(error: unknown): boolean {
    return (
        error instanceof InvalidAiOutputError ||
        NoObjectGeneratedError.isInstance(error) ||
        NoOutputGeneratedError.isInstance(error)
    );
}

class InvalidAiOutputError extends Error {}

function formatFailures(failures: readonly AiAttemptFailure[]): string {
    const attempts = failures
        .map(failure => {
            const status = failure.status > 0 ? `, ${failure.status}` : '';
            return `${failure.model} (${failure.code}${status})`;
        })
        .join(', ');
    return `AI analysis failed after ${failures.length} attempts: ${attempts}.`;
}

function defaultPrompt(): string {
    return `${PROMPT_VERSION}
Review the entire indexed transaction list before selecting likely duplicate pairs.
For each transaction, compare all eligible alternatives and choose only its strongest counterpart.
Resolve conflicts globally: Strong before Possible. Return only globally selected, non-overlapping pairs that represent the same real-world movement.
Do not select an earlier weaker match when a later transaction has stronger description, property, Account, or date evidence.
Equal amounts and dates within seven calendar days are mandatory.
A pair must share an Account reference on the same movement side, unless at least one transaction is a draft and both descriptions are non-empty.
Draft Accounts are evidence, not an automatic rejection. Conflicting Accounts on both movement sides remain negative evidence.
Equal amount, date, and the same generic description are not enough to overcome conflicting Accounts; require corroborating distinctive description details or a matching business property.
An exact shared business reference with equal amount and date is compelling evidence and normally Strong, even when draft Accounts or descriptions differ.
Use descriptions, Account names, custom properties, and date proximity.
IMPORTANT: Every pair in humanRejectedPairs is a human-confirmed false positive and MUST be skipped. Never return those pairs or equivalent matches.
Never request a write. Return Strong only when the evidence is compelling; otherwise use Possible. Keep explanations under 140 characters.`;
}

function buildAiInputText(
    transactions: readonly TransactionFingerprint[],
    learningExamples: readonly string[]
): string {
    const snapshots = toAiSnapshots(transactions);
    const withAllContext = serializeAiInput(snapshots, learningExamples);
    if (inputByteLength(withAllContext) <= MAX_AI_INPUT_BYTES) return withAllContext;

    const withoutLearning = serializeAiInput(snapshots, []);
    if (inputByteLength(withoutLearning) <= MAX_AI_INPUT_BYTES) return withoutLearning;

    const snapshotsWithoutProperties = snapshots.map(snapshot => {
        const { properties: _properties, ...requiredContext } = snapshot;
        return requiredContext;
    });
    const requiredContext = serializeAiInput(snapshotsWithoutProperties, []);
    if (inputByteLength(requiredContext) <= MAX_AI_INPUT_BYTES) return requiredContext;

    throw new BkperAiError(
        400,
        'analysis_input_too_large',
        'Transaction context is too large to analyze safely.'
    );
}

function serializeAiInput(
    candidateTransactions: readonly Record<string, unknown>[],
    humanRejectedPairs: readonly string[]
): string {
    return JSON.stringify({ humanRejectedPairs, candidateTransactions });
}

function inputByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function toAiSnapshots(
    transactions: readonly TransactionFingerprint[]
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

    return transactions.map((transaction, index) => ({
        index,
        date: transaction.date,
        amount: transaction.amount,
        description: truncateAiText(transaction.description),
        fromAccount: accountSnapshot(transaction.fromAccount),
        toAccount: accountSnapshot(transaction.toAccount),
        properties: toAiProperties(transaction.properties),
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

function analysisSchema(transactionCount: number) {
    const maximumIndex = Math.max(0, transactionCount - 1);
    const pairSchema = z
        .object({
            firstIndex: z.number().int().min(0).max(maximumIndex),
            secondIndex: z.number().int().min(0).max(maximumIndex),
            strength: z.enum(['Strong', 'Possible']),
            explanation: z.string().max(180),
        })
        .strict();
    return z
        .object({
            pairs: z.array(pairSchema).max(Math.floor(transactionCount / 2)),
        })
        .strict();
}

function validateAnalysis(
    value: AiAnalysis,
    transactions: readonly TransactionFingerprint[]
): AiAnalysis {
    const usedIndexes = new Set<number>();
    const pairs: AiSuggestedPair[] = [];
    for (const item of value.pairs) {
        if (
            item.firstIndex === item.secondIndex ||
            usedIndexes.has(item.firstIndex) ||
            usedIndexes.has(item.secondIndex)
        ) {
            throw new InvalidAiOutputError('Bkper AI returned overlapping pairs.');
        }
        const first = transactions[item.firstIndex];
        const second = transactions[item.secondIndex];
        if (!isPlausiblePair(first, second)) {
            throw new InvalidAiOutputError(
                'Bkper AI returned a pair outside deterministic constraints.'
            );
        }
        usedIndexes.add(item.firstIndex);
        usedIndexes.add(item.secondIndex);
        pairs.push(item);
    }
    pairs.sort((left, right) => {
        const strength = left.strength === right.strength ? 0 : left.strength === 'Strong' ? -1 : 1;
        return (
            strength || left.firstIndex - right.firstIndex || left.secondIndex - right.secondIndex
        );
    });
    return { pairs };
}

function isCompletedResponse(payload: unknown): boolean {
    return isRecord(payload) && payload.status === 'completed';
}

function readAiErrorResponseBody(
    body: string | undefined
): { code: string; message: string } | undefined {
    if (!body) return undefined;
    try {
        return readAiError(JSON.parse(body) as unknown);
    } catch {
        return undefined;
    }
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
