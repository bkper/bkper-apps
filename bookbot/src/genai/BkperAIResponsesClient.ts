import { createOpenAI, type OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai';
import {
    APICallError,
    generateText,
    jsonSchema,
    NoObjectGeneratedError,
    Output,
    type JSONSchema7,
    type LanguageModelUsage,
    type UserContent,
} from 'ai';
import {
    BkperAIClientError,
    getSafeConnectionErrorDetails,
    isRecord,
} from './BkperAIClientError.js';
import type { GenAIOperation, GenAIRequestContext } from './GenAITelemetry.js';
import { validateStructuredValue, type JsonSchema } from './JsonSchema.js';

export interface StructuredGenerationPart {
    text?: string;
    inlineData?: {
        mimeType: string;
        data: string;
    };
}

export type BkperAILanguageModel = 'gemini-flash' | 'gemini-flash-lite';
export type BkperAIReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface StructuredGenerationRequest extends GenAIRequestContext {
    operation: GenAIOperation;
    model: BkperAILanguageModel;
    systemPrompt: string;
    contents: StructuredGenerationPart[];
    responseFormat: {
        name: string;
        schema: JsonSchema;
        strict: boolean;
    };
    reasoningEffort: BkperAIReasoningEffort;
    signal?: AbortSignal;
}

export interface StructuredGenerationUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens: number;
}

export interface StructuredGenerationResult {
    value: unknown;
    usage?: StructuredGenerationUsage;
}

interface BkperAIResponsesClientOptions {
    baseUrl?: string;
    oauthToken?: string;
    signal?: AbortSignal;
    fetch?: typeof fetch;
}

interface SafeErrorBody {
    code: string;
    message: string;
}

function getSafeError(value: unknown): SafeErrorBody | undefined {
    if (!isRecord(value) || !isRecord(value.error)) return undefined;
    return {
        code: typeof value.error.code === 'string' ? value.error.code : 'bkper_ai_error',
        message: typeof value.error.message === 'string'
            ? value.error.message
            : 'Bkper AI rejected the request.',
    };
}

function getSafeErrorBody(responseBody: string | undefined): SafeErrorBody | undefined {
    if (!responseBody) return undefined;
    try {
        return getSafeError(JSON.parse(responseBody) as unknown);
    } catch {
        return undefined;
    }
}

function isRetryable(status: number, code: string): boolean {
    if (code === 'usage_limit_exceeded') return false;
    if (code === 'provider_rate_limited') return true;
    return status === 408 || status >= 500;
}

function extensionForMimeType(mimeType: string): string {
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/gif') return 'gif';
    return 'png';
}

function decodeBase64Text(data: string): string {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
}

function toUserContent(parts: StructuredGenerationPart[]): UserContent {
    const content: UserContent = [];
    for (const part of parts) {
        if (typeof part.text === 'string') {
            content.push({ type: 'text', text: part.text });
            continue;
        }
        if (!part.inlineData) continue;
        if (part.inlineData.mimeType.startsWith('text/')) {
            content.push({ type: 'text', text: decodeBase64Text(part.inlineData.data) });
            continue;
        }
        content.push({
            type: 'file',
            mediaType: part.inlineData.mimeType,
            data: part.inlineData.data,
            filename: `document.${extensionForMimeType(part.inlineData.mimeType)}`,
            ...(part.inlineData.mimeType.startsWith('image/')
                ? { providerOptions: { openai: { imageDetail: 'high' } } }
                : {}),
        });
    }
    return content;
}

function toAISdkJsonSchema(schema: JsonSchema): JSONSchema7 {
    return JSON.parse(JSON.stringify(schema)) as JSONSchema7;
}

function toStructuredUsage(usage: LanguageModelUsage | undefined): StructuredGenerationUsage | undefined {
    if (usage?.inputTokens === undefined ||
        usage.outputTokens === undefined ||
        usage.totalTokens === undefined) {
        return undefined;
    }
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
    };
}

function emitTerminalTelemetry(
    request: StructuredGenerationRequest,
    outcome: string,
    usage?: StructuredGenerationUsage
): void {
    console.log('BKPER_AI_RESULT', JSON.stringify({
        operation: request.operation,
        ...(request.document_kind ? { document_kind: request.document_kind } : {}),
        ...(request.stage ? { stage: request.stage } : {}),
        ...(request.epoch !== undefined ? { epoch: request.epoch } : {}),
        ...(request.media_type ? { media_type: request.media_type } : {}),
        ...(request.file_size_bucket ? { file_size_bucket: request.file_size_bucket } : {}),
        model: request.model,
        outcome,
        ...(usage ? {
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            total_tokens: usage.totalTokens,
            reasoning_tokens: usage.reasoningTokens,
        } : {}),
    }));
}

export class BkperAIResponsesClient {
    private readonly baseUrl?: string;
    private readonly oauthToken?: string;
    private readonly requestSignal?: AbortSignal;
    private readonly provider: ReturnType<typeof createOpenAI>;

    constructor(options: BkperAIResponsesClientOptions) {
        this.baseUrl = options.baseUrl?.replace(/\/$/u, '');
        this.oauthToken = options.oauthToken;
        this.requestSignal = options.signal;
        this.provider = createOpenAI({
            baseURL: this.baseUrl,
            apiKey: this.oauthToken ?? '',
            headers: { 'bkper-ai-source': 'bookbot' },
            fetch: options.fetch ?? fetch,
        });
    }

    async generate(request: StructuredGenerationRequest): Promise<StructuredGenerationResult> {
        if (!this.oauthToken) {
            throw new BkperAIClientError(
                401,
                'missing_oauth_token',
                'Bkper OAuth token is required for Flash inference.',
                false
            );
        }
        if (!this.baseUrl) {
            throw new BkperAIClientError(
                500,
                'missing_bkper_ai_base_url',
                'BKPER_AI_BASE_URL is required for Flash inference.',
                false
            );
        }

        const signal = request.signal ?? this.requestSignal;
        const providerOptions: OpenAILanguageModelResponsesOptions = {
            store: false,
            instructions: request.systemPrompt,
            reasoningEffort: request.reasoningEffort,
            reasoningSummary: null,
            forceReasoning: true,
            strictJsonSchema: request.responseFormat.strict,
        };
        const schema = jsonSchema<unknown>(toAISdkJsonSchema(request.responseFormat.schema), {
            validate: value => validateStructuredValue(request.responseFormat.schema, value)
                ? { success: true, value }
                : {
                    success: false,
                    error: new Error('Structured generation response does not match the expected schema.'),
                },
        });

        try {
            const result = await generateText({
                model: this.provider.responses(request.model),
                messages: [{ role: 'user', content: toUserContent(request.contents) }],
                output: Output.object({
                    name: request.responseFormat.name,
                    schema,
                }),
                providerOptions: { openai: providerOptions },
                maxRetries: 0,
                abortSignal: signal,
            });
            // AI SDK treats a parsed null output as if no output was generated.
            // Preserve null when the requested schema explicitly accepts it.
            const value = result.text.trim() === 'null' &&
                validateStructuredValue(request.responseFormat.schema, null)
                ? null
                : result.output;
            const usage = toStructuredUsage(result.usage);
            emitTerminalTelemetry(request, 'success', usage);
            return { value, ...(usage ? { usage } : {}) };
        } catch (error) {
            let clientError: BkperAIClientError;
            let usage: StructuredGenerationUsage | undefined;
            const aborted = signal?.aborted === true ||
                (error instanceof DOMException && error.name === 'AbortError');

            if (aborted) {
                clientError = new BkperAIClientError(
                    0,
                    'request_aborted',
                    'Bkper AI request was aborted.',
                    false
                );
            } else if (NoObjectGeneratedError.isInstance(error)) {
                usage = toStructuredUsage(error.usage);
                clientError = new BkperAIClientError(
                    502,
                    'structured_output_schema_mismatch',
                    'Bkper AI returned output that does not match the requested schema.',
                    false
                );
            } else if (APICallError.isInstance(error) &&
                error.statusCode !== undefined &&
                error.statusCode >= 400) {
                const safe = getSafeErrorBody(error.responseBody);
                const code = safe?.code ?? 'bkper_ai_error';
                clientError = new BkperAIClientError(
                    error.statusCode,
                    code,
                    safe?.message ?? 'Bkper AI rejected the request.',
                    isRetryable(error.statusCode, code)
                );
            } else if ((APICallError.isInstance(error) && error.statusCode === undefined) ||
                error instanceof TypeError) {
                console.error(
                    'BKPER_AI_CONNECTION_ERROR',
                    JSON.stringify(getSafeConnectionErrorDetails(error, this.oauthToken))
                );
                clientError = new BkperAIClientError(
                    0,
                    'connection_error',
                    'Could not connect to Bkper AI.',
                    true
                );
            } else {
                clientError = new BkperAIClientError(
                    502,
                    'malformed_bkper_ai_response',
                    'Bkper AI returned a malformed response.',
                    false
                );
            }

            emitTerminalTelemetry(request, clientError.code, usage);
            throw clientError;
        }
    }
}
