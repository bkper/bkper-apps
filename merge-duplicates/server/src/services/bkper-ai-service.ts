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
    const failures: AiAttemptFailure[] = [];
    for (const attempt of MODEL_ATTEMPTS) {
        let response: Response;
        try {
            response = await fetchWithTimeout(
                fetcher,
                buildAiRequest(attempt, transactions, inputText),
                attempt.timeoutMs
            );
        } catch (error) {
            failures.push({
                model: attempt.model,
                status: isAbortError(error) ? 408 : 0,
                code: isAbortError(error) ? 'provider_timeout' : 'connection_error',
            });
            continue;
        }

        let payload: unknown;
        try {
            payload = await readAiPayload(response);
        } catch {
            const failure = {
                model: attempt.model,
                status: response.status,
                code: 'invalid_response',
            };
            if (!isRetryableFailure(failure)) {
                throw new BkperAiError(
                    response.status,
                    failure.code,
                    `Bkper AI returned an invalid response (${response.status}).`,
                    [...failures, failure]
                );
            }
            failures.push(failure);
            continue;
        }

        if (!response.ok) {
            const upstreamError = readAiError(payload);
            const failure = {
                model: attempt.model,
                status: response.status,
                code: upstreamError?.code ?? 'bkper_ai_error',
            };
            if (!isRetryableFailure(failure)) {
                throw new BkperAiError(
                    response.status,
                    failure.code,
                    upstreamError?.message ?? `Bkper AI returned ${response.status}.`,
                    [...failures, failure]
                );
            }
            failures.push(failure);
            continue;
        }

        try {
            return parseAnalysis(payload, transactions);
        } catch {
            failures.push({ model: attempt.model, status: 200, code: 'invalid_output' });
        }
    }

    throw new BkperAiError(502, 'ai_providers_failed', formatFailures(failures), failures);
}

function buildAiRequest(
    attempt: ModelAttempt,
    transactions: readonly TransactionFingerprint[],
    inputText: string
): Request {
    return new Request(AI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            model: attempt.model,
            input: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: inputText,
                        },
                    ],
                },
            ],
            instructions: defaultPrompt(),
            text: {
                format: {
                    type: 'json_schema',
                    name: 'merge_duplicate_global_matching',
                    schema: responseSchema(transactions.length),
                    strict: true,
                },
            },
            reasoning: { effort: attempt.reasoningEffort },
            ...(attempt.temperature === undefined ? {} : { temperature: attempt.temperature }),
            stream: false,
            store: false,
        }),
    });
}

async function fetchWithTimeout(
    fetcher: Fetcher,
    request: Request,
    timeoutMs: number
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetcher(new Request(request, { signal: controller.signal }));
    } catch (error) {
        if (controller.signal.aborted) {
            throw new DOMException('Bkper AI request timed out.', 'AbortError');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
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

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

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

function responseSchema(transactionCount: number): Record<string, unknown> {
    const maximumIndex = Math.max(0, transactionCount - 1);
    return {
        type: 'object',
        properties: {
            pairs: {
                type: 'array',
                minItems: 0,
                maxItems: Math.floor(transactionCount / 2),
                items: {
                    type: 'object',
                    properties: {
                        firstIndex: { type: 'integer', minimum: 0, maximum: maximumIndex },
                        secondIndex: { type: 'integer', minimum: 0, maximum: maximumIndex },
                        strength: { type: 'string', enum: ['Strong', 'Possible'] },
                        explanation: { type: 'string', maxLength: 180 },
                    },
                    required: ['firstIndex', 'secondIndex', 'strength', 'explanation'],
                    additionalProperties: false,
                },
            },
        },
        required: ['pairs'],
        additionalProperties: false,
    };
}

function parseAnalysis(
    payload: unknown,
    transactions: readonly TransactionFingerprint[]
): AiAnalysis {
    const outputText = getOutputText(payload);
    let value: unknown;
    try {
        value = JSON.parse(outputText) as unknown;
    } catch {
        throw new Error('Bkper AI returned malformed structured output.');
    }
    if (!isRecord(value) || !Array.isArray(value.pairs)) {
        throw new Error('Bkper AI output did not match the required schema.');
    }
    if (value.pairs.length > Math.floor(transactions.length / 2)) {
        throw new Error('Bkper AI returned too many pairs.');
    }

    const usedIndexes = new Set<number>();
    const pairs: AiSuggestedPair[] = [];
    for (const item of value.pairs) {
        if (
            !isRecord(item) ||
            typeof item.firstIndex !== 'number' ||
            !Number.isInteger(item.firstIndex) ||
            typeof item.secondIndex !== 'number' ||
            !Number.isInteger(item.secondIndex) ||
            item.firstIndex < 0 ||
            item.firstIndex >= transactions.length ||
            item.secondIndex < 0 ||
            item.secondIndex >= transactions.length ||
            item.firstIndex === item.secondIndex ||
            usedIndexes.has(item.firstIndex) ||
            usedIndexes.has(item.secondIndex) ||
            (item.strength !== 'Strong' && item.strength !== 'Possible') ||
            typeof item.explanation !== 'string' ||
            item.explanation.length > 180
        ) {
            throw new Error('Bkper AI output did not match the required schema.');
        }
        const first = transactions[item.firstIndex];
        const second = transactions[item.secondIndex];
        if (!isPlausiblePair(first, second)) {
            throw new Error('Bkper AI returned a pair outside deterministic constraints.');
        }
        usedIndexes.add(item.firstIndex);
        usedIndexes.add(item.secondIndex);
        pairs.push({
            firstIndex: item.firstIndex,
            secondIndex: item.secondIndex,
            strength: item.strength,
            explanation: item.explanation,
        });
    }
    pairs.sort((left, right) => {
        const strength = left.strength === right.strength ? 0 : left.strength === 'Strong' ? -1 : 1;
        return (
            strength || left.firstIndex - right.firstIndex || left.secondIndex - right.secondIndex
        );
    });
    return { pairs };
}

function getOutputText(payload: unknown): string {
    if (!isRecord(payload) || payload.status !== 'completed' || !Array.isArray(payload.output)) {
        throw new Error('Bkper AI did not return a complete response.');
    }
    const texts: string[] = [];
    for (const item of payload.output) {
        if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
        for (const part of item.content) {
            if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
                texts.push(part.text);
            }
        }
    }
    if (texts.length === 0) throw new Error('Bkper AI returned no output text.');
    return texts.join('');
}

async function readAiPayload(response: Response): Promise<unknown> {
    const body = await response.text();
    if (body.trim().length === 0) {
        throw new Error(`Bkper AI returned an empty response (${response.status}).`);
    }
    try {
        return JSON.parse(body) as unknown;
    } catch {
        throw new Error(`Bkper AI returned malformed JSON (${response.status}).`);
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
