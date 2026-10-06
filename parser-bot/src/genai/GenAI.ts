import { GEMINI_MODEL_FLASH, GEMINI_MODEL_FLASH_LITE } from '../constants.js';
import {
    BkperAIResponsesClient,
    type BkperAILanguageModel,
    type BkperAIReasoningEffort,
    type StructuredGenerationPart,
} from './BkperAIResponsesClient.js';
import { GenAIBase } from './GenAIBase.js';
import { isTransientGenAIError } from './GenAIRetry.js';
import { type GenAIOperation, type GenAIRequestContext, type GenAIRequestMetadata } from './GenAITelemetry.js';
import { type JsonSchema, validateStructuredValue } from './JsonSchema.js';

function isBkperAILanguageModel(model: string): model is BkperAILanguageModel {
    return model === GEMINI_MODEL_FLASH || model === GEMINI_MODEL_FLASH_LITE;
}

export abstract class GenAI<E> extends GenAIBase {
    private readonly responsesClient?: BkperAIResponsesClient;

    constructor(_env: Env, responsesClient?: BkperAIResponsesClient) {
        super();
        this.responsesClient = responsesClient;
    }

    protected abstract getSystemPrompt(): string;

    protected abstract getResponseSchema(): JsonSchema;

    protected getResponseSchemaName(): string {
        return this.getOperation();
    }

    protected isStrictResponseSchema(): boolean {
        return true;
    }

    protected abstract getOperation(): GenAIOperation;

    protected getReasoningEffort(): BkperAIReasoningEffort {
        return 'medium';
    }

    protected async attemptQuery(
        model: string,
        contents: StructuredGenerationPart[],
        metadata: GenAIRequestMetadata
    ): Promise<E | undefined> {
        if (!this.responsesClient) {
            throw new Error('Bkper AI client is required for language-model inference.');
        }
        if (!isBkperAILanguageModel(model)) {
            throw new Error(`Unsupported Bkper AI language model: ${model}`);
        }

        const result = await this.responsesClient.generate({
            ...metadata,
            model,
            systemPrompt: this.getSystemPrompt(),
            contents,
            responseFormat: {
                name: this.getResponseSchemaName(),
                schema: this.getResponseSchema(),
                strict: this.isStrictResponseSchema(),
            },
            reasoningEffort: this.getReasoningEffort(),
        });
        const parsed = result.value;

        if (!validateStructuredValue(this.getResponseSchema(), parsed)) {
            throw new Error('Structured generation response does not match the expected schema.');
        }
        return parsed as E;
    }

    public async query(
        contents: StructuredGenerationPart[],
        context: GenAIRequestContext = {}
    ): Promise<E | undefined> {
        const model = this.getModel();
        const { operation, ...metadataContext } = context;
        const metadata: GenAIRequestMetadata = {
            operation: operation ?? this.getOperation(),
            ...metadataContext,
        };

        for (let attempt = 0; attempt <= GenAIBase.MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = this.calculateBackoffDelay(attempt);
                    console.log(`Retrying model ${model} (attempt ${attempt + 1}/${GenAIBase.MAX_RETRIES + 1}) after ${delay}ms...`);
                    await this.sleep(delay);
                }

                return await this.attemptQuery(model, contents, metadata);
            } catch (error) {
                console.warn(`Error on model ${model} attempt ${attempt + 1}:`, error);

                if (!isTransientGenAIError(error) || attempt === GenAIBase.MAX_RETRIES) {
                    if (isTransientGenAIError(error)) {
                        console.error(`Model ${model} exhausted all retries.`);
                    }
                    throw error;
                }
            }
        }

        throw new Error('Query failed after all retry attempts');
    }
}
