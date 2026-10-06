import {
    APIConnectionError,
    APIError,
    APIUserAbortError,
    TypeSafeClient,
    type JsonValue,
    type NoulQuestion,
} from '@typesafe-ai/sdk';
import {
    BkperAIClientError,
    getSafeConnectionErrorDetails,
    isRecord,
} from './BkperAIClientError.js';
import type { GenAIRequestContext } from './GenAITelemetry.js';

export type EvaluationKind = 'invoice_description_equivalence' | 'ace_bullet_redundancy';

type EvaluationState = string | { [key: string]: JsonValue } | JsonValue[];

export interface BooleanEvaluationQuestion {
    instructions: string;
    criteria?: {
        true?: string;
        false?: string;
    };
}

export interface BooleanEvaluationRequest {
    evaluationKind: EvaluationKind;
    state: EvaluationState;
    questions: Record<string, BooleanEvaluationQuestion>;
    context?: GenAIRequestContext;
    signal?: AbortSignal;
}

export interface BooleanEvaluationResult {
    probabilities: Record<string, number>;
}

interface EvaluationTelemetryUsage {
    inputTokens: number;
    outputTokens: number;
}

interface BkperAIEvaluationsClientOptions {
    baseUrl?: string;
    oauthToken?: string;
    signal?: AbortSignal;
    fetch?: typeof fetch;
}

function emitEvaluationTelemetry(
    request: BooleanEvaluationRequest,
    outcome: string,
    usage?: EvaluationTelemetryUsage
): void {
    const context = request.context ?? {};
    console.log('BKPER_AI_RESULT', JSON.stringify({
        operation: 'evaluation',
        evaluation_kind: request.evaluationKind,
        ...(context.document_kind ? { document_kind: context.document_kind } : {}),
        ...(context.stage ? { stage: context.stage } : {}),
        ...(context.epoch !== undefined ? { epoch: context.epoch } : {}),
        model: 'jev',
        outcome,
        ...(usage ? {
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            total_tokens: usage.inputTokens + usage.outputTokens,
        } : {}),
    }));
}

/** Errors surface after the SDK's retries, so none is retryable again. */
function toClientError(error: unknown, signal: AbortSignal | undefined, oauthToken: string): BkperAIClientError | undefined {
    if (error instanceof APIUserAbortError || signal?.aborted === true) {
        return new BkperAIClientError(0, 'request_aborted', 'Bkper AI request was aborted.', false);
    }
    if (error instanceof APIError) {
        const body = isRecord(error.body) && isRecord(error.body.error) ? error.body.error : undefined;
        return new BkperAIClientError(
            error.status,
            typeof body?.code === 'string' ? body.code : 'bkper_ai_error',
            typeof body?.message === 'string' ? body.message : 'Bkper AI rejected the request.',
            false
        );
    }
    if (error instanceof APIConnectionError) {
        console.error(
            'BKPER_AI_CONNECTION_ERROR',
            JSON.stringify(getSafeConnectionErrorDetails(error, oauthToken))
        );
        return new BkperAIClientError(0, 'connection_error', 'Could not connect to Bkper AI.', false);
    }
    return undefined;
}

/** Asks Bkper AI's Jev decision model yes/no questions through the TypeSafe SDK. */
export class BkperAIEvaluationsClient {
    private readonly baseUrl?: string;
    private readonly oauthToken?: string;
    private readonly requestSignal?: AbortSignal;
    private readonly fetcher: typeof fetch;

    constructor(options: BkperAIEvaluationsClientOptions) {
        this.baseUrl = options.baseUrl;
        this.oauthToken = options.oauthToken;
        this.requestSignal = options.signal;
        this.fetcher = options.fetch ?? fetch;
    }

    async evaluateBooleans(request: BooleanEvaluationRequest): Promise<BooleanEvaluationResult> {
        if (!this.oauthToken) {
            throw new BkperAIClientError(
                401,
                'missing_oauth_token',
                'Bkper OAuth token is required for evaluation.',
                false
            );
        }
        if (!this.baseUrl) {
            throw new BkperAIClientError(
                500,
                'missing_bkper_ai_base_url',
                'BKPER_AI_BASE_URL is required for evaluation.',
                false
            );
        }

        const signal = request.signal ?? this.requestSignal;
        const questionIds = Object.keys(request.questions);
        const questions: Record<string, NoulQuestion> = Object.fromEntries(
            questionIds.map(id => [id, { type: 'noul', ...request.questions[id] }])
        );
        const fetcher = this.fetcher;
        const bkperAi = new TypeSafeClient({
            apiKey: this.oauthToken,
            // The SDK appends /v1/systemone, Bkper AI's permanent decision path.
            baseURL: new URL(this.baseUrl).origin,
            defaultModel: 'jev',
            defaultHeaders: { 'bkper-ai-source': 'bookbot' },
            // The SDK calls fetch as its own method; Workers' fetch rejects a foreign receiver.
            fetch: (input, init) => fetcher(input, init),
        });

        try {
            // Bkper AI validates every answer against its question before responding.
            const { answers, usage } = await bkperAi.systemOne({ state: request.state, questions }, { signal });
            const probabilities = Object.fromEntries(questionIds.map(id => [id, answers[id].noul]));
            emitEvaluationTelemetry(request, 'success', {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
            });
            return { probabilities };
        } catch (error) {
            const clientError = toClientError(error, signal, this.oauthToken);
            emitEvaluationTelemetry(request, clientError?.code ?? 'unexpected_error');
            throw clientError ?? error;
        }
    }
}
