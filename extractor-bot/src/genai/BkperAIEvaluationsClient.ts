import {
    APIConnectionError,
    APIError,
    APIUserAbortError,
    TypeSafeClient,
    type ChoiceQuestion,
    type JsonValue,
    type NoulQuestion,
    type SystemOneRequest,
} from '@typesafe-ai/sdk';
import { BKPER_AI_SOURCE } from '../constants.js';
import {
    BkperAIClientError,
    getSafeConnectionErrorDetails,
    isRecord,
} from './BkperAIClientError.js';
import type { GenAIRequestContext } from './GenAITelemetry.js';

export type EvaluationKind = 'invoice_description_equivalence' | 'ace_bullet_redundancy' | 'file_classification';

export type EvaluationState = string | { [key: string]: JsonValue } | JsonValue[];

/** A file named by a placeholder in the state, as Open System One assets carry it. */
export type EvaluationAsset =
    | { type: 'image'; format: 'png' | 'jpeg' | 'webp'; data_base64: string }
    | { type: 'file'; media_type: string; data_base64: string };

const DEFAULT_EVALUATION_MODEL = 'jev';

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

export interface ChoiceEvaluationRequest {
    evaluationKind: EvaluationKind;
    /** A System One decision model that reads the state and assets, such as `gemini-decision` for PDFs. */
    model: string;
    state: EvaluationState;
    assets?: Record<string, EvaluationAsset>;
    questions: Record<string, ChoiceQuestion>;
    context?: GenAIRequestContext;
    signal?: AbortSignal;
}

export interface ChoiceEvaluationResult {
    /** By question, the probability of each criterion. */
    probabilities: Record<string, Record<string, number>>;
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
    request: { evaluationKind: EvaluationKind; context?: GenAIRequestContext },
    model: string,
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
        model,
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

/** Asks Bkper AI's System One decision models questions through the TypeSafe SDK: Jev by default. */
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
        const bkperAi = this.connect();
        const signal = request.signal ?? this.requestSignal;
        const questionIds = Object.keys(request.questions);
        const questions: Record<string, NoulQuestion> = Object.fromEntries(
            questionIds.map(id => [id, { type: 'noul', ...request.questions[id] }])
        );

        try {
            // Bkper AI validates every answer against its question before responding.
            const { answers, usage } = await bkperAi.systemOne({ state: request.state, questions }, { signal });
            const probabilities = Object.fromEntries(questionIds.map(id => [id, answers[id].noul]));
            emitEvaluationTelemetry(request, DEFAULT_EVALUATION_MODEL, 'success', {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
            });
            return { probabilities };
        } catch (error) {
            throw this.failure(request, DEFAULT_EVALUATION_MODEL, error, signal);
        }
    }

    async evaluateChoices(request: ChoiceEvaluationRequest): Promise<ChoiceEvaluationResult> {
        const bkperAi = this.connect();
        const signal = request.signal ?? this.requestSignal;
        // The SDK forwards fields it does not type, such as Open System One assets.
        const body: SystemOneRequest<Record<string, ChoiceQuestion>> & { assets?: Record<string, EvaluationAsset> } = {
            model: request.model,
            state: request.state,
            ...(request.assets ? { assets: request.assets } : {}),
            questions: request.questions,
        };

        try {
            // Bkper AI validates every answer against its question before responding.
            const { answers, usage } = await bkperAi.systemOne(body, { signal });
            const probabilities = Object.fromEntries(
                Object.keys(request.questions).map(id => [id, { ...answers[id].probabilities }])
            );
            emitEvaluationTelemetry(request, request.model, 'success', {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
            });
            return { probabilities };
        } catch (error) {
            throw this.failure(request, request.model, error, signal);
        }
    }

    private connect(): TypeSafeClient {
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

        const fetcher = this.fetcher;
        return new TypeSafeClient({
            apiKey: this.oauthToken,
            // The SDK appends /v1/systemone, Bkper AI's permanent decision path.
            baseURL: new URL(this.baseUrl).origin,
            defaultModel: DEFAULT_EVALUATION_MODEL,
            defaultHeaders: { 'bkper-ai-source': BKPER_AI_SOURCE },
            // The SDK calls fetch as its own method; Workers' fetch rejects a foreign receiver.
            fetch: (input, init) => fetcher(input, init),
        });
    }

    private failure(
        request: { evaluationKind: EvaluationKind; context?: GenAIRequestContext },
        model: string,
        error: unknown,
        signal: AbortSignal | undefined
    ): unknown {
        const clientError = toClientError(error, signal, this.oauthToken ?? '');
        emitEvaluationTelemetry(request, model, clientError?.code ?? 'unexpected_error');
        return clientError ?? error;
    }
}
