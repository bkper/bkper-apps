import type { CandidateEvaluation, CandidatePair } from './candidate-service';

export const PROMPT_VERSION = 'merge-duplicates-v1';
const AI_URL = 'https://ai.bkper.app/v1/responses';

interface ModelAttempt {
    model: 'gemini-flash' | 'gpt-luna' | 'deepseek-flash';
    reasoningEffort: 'low' | 'high';
    timeoutMs: number;
    temperature?: number;
}

const MODEL_ATTEMPTS: readonly ModelAttempt[] = [
    { model: 'gemini-flash', reasoningEffort: 'low', temperature: 0.1, timeoutMs: 30_000 },
    { model: 'gpt-luna', reasoningEffort: 'high', timeoutMs: 90_000 },
    { model: 'deepseek-flash', reasoningEffort: 'high', timeoutMs: 180_000 },
];

export interface AiAnalysis {
    evaluations: CandidateEvaluation[];
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

export async function analyzeCandidatePairs(
    pairs: readonly CandidatePair[],
    learningExamples: readonly string[],
    fetcher: Fetcher = fetch
): Promise<AiAnalysis> {
    if (pairs.length === 0) return { evaluations: [] };

    const failures: AiAttemptFailure[] = [];
    for (const attempt of MODEL_ATTEMPTS) {
        let response: Response;
        try {
            response = await fetchWithTimeout(
                fetcher,
                buildAiRequest(attempt, pairs, learningExamples),
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
            return parseAnalysis(payload, pairs.length);
        } catch {
            failures.push({ model: attempt.model, status: 200, code: 'invalid_output' });
        }
    }

    throw new BkperAiError(502, 'ai_providers_failed', formatFailures(failures), failures);
}

function buildAiRequest(
    attempt: ModelAttempt,
    pairs: readonly CandidatePair[],
    learningExamples: readonly string[]
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
                            text: JSON.stringify({
                                learningExamples,
                                candidatePairs: pairs.map((pair, pairIndex) => ({
                                    pairIndex,
                                    first: toAiSnapshot(pair.first),
                                    second: toAiSnapshot(pair.second),
                                })),
                            }),
                        },
                    ],
                },
            ],
            instructions: defaultPrompt(),
            text: {
                format: {
                    type: 'json_schema',
                    name: 'merge_duplicate_analysis',
                    schema: responseSchema(pairs.length),
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
You review transaction pairs that already passed deterministic amount, date, and movement-side checks.
For every candidate pair, decide whether both rows represent the same real-world movement.
Use descriptions, account names, custom properties, date proximity, and supplied rejected examples.
Rejected examples are negative guidance, not duplicates. Never request a write and never omit a pair.
Return Strong only when the evidence is compelling; otherwise use Possible. Keep explanations under 140 characters.`;
}

function toAiSnapshot(transaction: CandidatePair['first']): Record<string, unknown> {
    return {
        date: transaction.date,
        amount: transaction.amount,
        description: transaction.description,
        fromAccount: transaction.fromAccount?.name ?? null,
        toAccount: transaction.toAccount?.name ?? null,
        properties: transaction.properties,
    };
}

function responseSchema(pairCount: number): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            evaluations: {
                type: 'array',
                minItems: pairCount,
                maxItems: pairCount,
                items: {
                    type: 'object',
                    properties: {
                        pairIndex: {
                            type: 'integer',
                            minimum: 0,
                            maximum: Math.max(0, pairCount - 1),
                        },
                        duplicate: { type: 'boolean' },
                        strength: { type: 'string', enum: ['Strong', 'Possible'] },
                        explanation: { type: 'string', maxLength: 180 },
                    },
                    required: ['pairIndex', 'duplicate', 'strength', 'explanation'],
                    additionalProperties: false,
                },
            },
        },
        required: ['evaluations'],
        additionalProperties: false,
    };
}

function parseAnalysis(payload: unknown, pairCount: number): AiAnalysis {
    const outputText = getOutputText(payload);
    let value: unknown;
    try {
        value = JSON.parse(outputText) as unknown;
    } catch {
        throw new Error('Bkper AI returned malformed structured output.');
    }
    if (!isRecord(value) || !Array.isArray(value.evaluations)) {
        throw new Error('Bkper AI output did not match the required schema.');
    }

    const seen = new Set<number>();
    const evaluations: CandidateEvaluation[] = [];
    for (const item of value.evaluations) {
        if (
            !isRecord(item) ||
            !Number.isInteger(item.pairIndex) ||
            typeof item.pairIndex !== 'number' ||
            item.pairIndex < 0 ||
            item.pairIndex >= pairCount ||
            seen.has(item.pairIndex) ||
            typeof item.duplicate !== 'boolean' ||
            (item.strength !== 'Strong' && item.strength !== 'Possible') ||
            typeof item.explanation !== 'string'
        ) {
            throw new Error('Bkper AI output did not match the required schema.');
        }
        seen.add(item.pairIndex);
        evaluations.push({
            pairIndex: item.pairIndex,
            duplicate: item.duplicate,
            strength: item.strength,
            explanation: item.explanation,
        });
    }
    if (evaluations.length !== pairCount) {
        throw new Error('Bkper AI did not evaluate every candidate pair.');
    }
    return { evaluations };
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
