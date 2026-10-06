import { describe, expect, it } from 'bun:test';
import { BkperAIClientError } from '../../src/genai/BkperAIClientError.js';
import { type StructuredGenerationPart } from '../../src/genai/BkperAIResponsesClient.js';
import { GenAI } from '../../src/genai/GenAI.js';
import { JsonSchema } from '../../src/genai/JsonSchema.js';

class RetryTestGenAI extends GenAI<string> {
    readonly attemptedModels: string[] = [];
    readonly sleepDelays: number[] = [];
    private readonly results: Array<string | Error>;

    constructor(results: Array<string | Error>) {
        super({} as Env);
        this.results = [...results];
    }

    protected getModel(): string {
        return 'selected-model';
    }

    protected getOperation(): 'transaction_extraction' {
        return 'transaction_extraction';
    }

    protected getSystemPrompt(): string {
        return 'test';
    }

    protected getResponseSchema(): JsonSchema {
        return { type: 'string' };
    }

    protected async attemptQuery(
        model: string,
        _contents: StructuredGenerationPart[]
    ): Promise<string | undefined> {
        this.attemptedModels.push(model);
        const result = this.results.shift();
        if (result instanceof Error) {
            throw result;
        }
        return result;
    }

    protected async sleep(ms: number): Promise<void> {
        this.sleepDelays.push(ms);
    }
}

function apiError(status: number): BkperAIClientError {
    const retryable = status === 408 || status === 429 || status >= 500;
    return new BkperAIClientError(status, `http_${status}`, `HTTP ${status}`, retryable);
}

describe('GenAI retry policy', () => {
    it('does not retry HTTP 400', async () => {
        const genAI = new RetryTestGenAI([apiError(400)]);

        await expect(genAI.query([{ text: 'request' }])).rejects.toMatchObject({ status: 400 });
        expect(genAI.attemptedModels).toEqual(['selected-model']);
        expect(genAI.sleepDelays).toEqual([]);
    });

    it('retries HTTP 429 and can succeed', async () => {
        const genAI = new RetryTestGenAI([apiError(429), 'success']);

        expect(await genAI.query([{ text: 'request' }])).toBe('success');
        expect(genAI.attemptedModels).toEqual(['selected-model', 'selected-model']);
        expect(genAI.sleepDelays).toEqual([1000]);
    });

    it('retries HTTP 503 up to three total attempts', async () => {
        const genAI = new RetryTestGenAI([apiError(503), apiError(503), apiError(503)]);

        await expect(genAI.query([{ text: 'request' }])).rejects.toMatchObject({ status: 503 });
        expect(genAI.attemptedModels).toEqual(['selected-model', 'selected-model', 'selected-model']);
        expect(genAI.sleepDelays).toEqual([1000, 2000]);
    });

    it('retries a recognized fetch failure', async () => {
        const genAI = new RetryTestGenAI([new TypeError('fetch failed'), 'success']);

        expect(await genAI.query([{ text: 'request' }])).toBe('success');
        expect(genAI.attemptedModels).toEqual(['selected-model', 'selected-model']);
    });

    it('does not retry a local exception', async () => {
        const error = new Error('invalid local JSON');
        const genAI = new RetryTestGenAI([error]);

        await expect(genAI.query([{ text: 'request' }])).rejects.toBe(error);
        expect(genAI.attemptedModels).toEqual(['selected-model']);
    });

    it('uses only the selected model for every attempt', async () => {
        const genAI = new RetryTestGenAI([apiError(408), apiError(500), 'success']);

        expect(await genAI.query([{ text: 'request' }])).toBe('success');
        expect(new Set(genAI.attemptedModels)).toEqual(new Set(['selected-model']));
    });
});
