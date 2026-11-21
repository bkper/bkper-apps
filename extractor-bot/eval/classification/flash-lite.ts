import { Book, File } from 'bkper-js';

import { isRecord } from '../../src/genai/BkperAIClientError.js';
import { BkperAIResponsesClient } from '../../src/genai/BkperAIResponsesClient.js';
import { ExtractorFileClassification, type ExtractedFileClassification } from '../../src/genai/file/ExtractorFileClassification.js';
import { CLASSIFICATION_SCHEMA, validateStructuredValue } from '../../src/genai/JsonSchema.js';
import { redactDocument, type DocumentContent } from './request.js';

/**
 * Extractor Bot's current file classification, run unchanged: `ExtractorFileClassification` with its
 * system prompt, schema, model and reasoning effort, through `BkperAIResponsesClient` to
 * `POST /v1/responses`. Only the transport is wrapped, to record each exchange.
 */

/** Placeholder environment: `GenAI` takes an `Env` but reads nothing from it. */
const ENV: Env = { BKPER_AI_BASE_URL: 'https://ai-dev.bkper.app/v1' };

function classifier(document: DocumentContent, client?: BkperAIResponsesClient): ExtractorFileClassification {
    // A File without an id never fetches: getContent returns the content it holds.
    const file = new File(new Book({ id: 'synthetic-book' }), {
        name: 'document',
        contentType: document.mediaType,
        content: document.base64,
    });
    return new ExtractorFileClassification(file, ENV, client);
}

export function flashLiteSystemPrompt(): string {
    return classifier({ mediaType: 'application/pdf', base64: '', sha256: '' }).getSystemPrompt();
}

export function flashLiteModel(): string {
    return classifier({ mediaType: 'application/pdf', base64: '', sha256: '' }).getModel();
}

export interface Exchange {
    status: number;
    latencyMs: number;
    request: unknown;
    body: unknown;
}

export function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/** The body without the provider's opaque reasoning signatures, which are large and never scored. */
function withoutEncryptedReasoning(body: unknown): unknown {
    if (!isRecord(body) || !Array.isArray(body.output)) return body;
    return {
        ...body,
        output: body.output.map(item => isRecord(item) && 'encrypted_content' in item ? { ...item, encrypted_content: null } : item),
    };
}

/**
 * Runs the bot's classification on one document and returns every HTTP exchange it made, retries
 * included, with the document's bytes replaced by their hash. Errors are not thrown: the recorded
 * exchanges are scored instead.
 */
export async function callFlashLite(
    baseUrl: string,
    token: string,
    document: DocumentContent,
    beforeCall: () => void
): Promise<Exchange[]> {
    const exchanges: Exchange[] = [];
    const recordingFetch: typeof fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        beforeCall();
        const headers = new Headers(init?.headers);
        headers.set('bkper-ai-source', 'extractor-bot-eval');
        const started = performance.now();
        const response = await fetch(input, { ...init, headers });
        const text = await response.clone().text();
        exchanges.push({
            status: response.status,
            latencyMs: Math.round(performance.now() - started),
            request: redactDocument(typeof init?.body === 'string' ? parseJson(init.body) : null, document),
            body: withoutEncryptedReasoning(parseJson(text)),
        });
        return response;
    }, { preconnect: fetch.preconnect });

    const client = new BkperAIResponsesClient({ readOnly: true, baseUrl, oauthToken: token, fetch: recordingFetch });
    try {
        await classifier(document, client).extract(undefined);
    } catch {
        // Scored from the recorded exchanges.
    }
    return exchanges;
}

function collectStrings(value: unknown, into: string[] = []): string[] {
    if (typeof value === 'string') into.push(value);
    else if (Array.isArray(value)) value.forEach(item => collectStrings(item, into));
    else if (isRecord(value)) Object.values(value).forEach(item => collectStrings(item, into));
    return into;
}

/** Whether a recorded Responses request carries the current system prompt, model and this document. */
export function flashLiteRequestMatches(request: unknown, document: DocumentContent): boolean {
    return isRecord(request)
        && request.instructions === flashLiteSystemPrompt()
        && request.model === flashLiteModel()
        && collectStrings(request).some(text => text.includes(`sha256:${document.sha256}`));
}

export interface ResponsesUsage {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
}

export function readResponsesUsage(body: unknown): ResponsesUsage | undefined {
    if (!isRecord(body) || !isRecord(body.usage)) return undefined;
    const { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details: details } = body.usage;
    if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return undefined;
    const cachedInputTokens = isRecord(details) && typeof details.cached_tokens === 'number' ? details.cached_tokens : 0;
    return { inputTokens, cachedInputTokens, outputTokens };
}

/** The structured output of an Open Responses body, validated with the bot's own schema check. */
export function readFlashLiteAnswer(body: unknown): ExtractedFileClassification | undefined {
    if (!isRecord(body) || !Array.isArray(body.output)) return undefined;
    const text = body.output
        .filter(isRecord)
        .filter(item => item.type === 'message' && Array.isArray(item.content))
        .flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(isRecord)
        .filter(part => part.type === 'output_text' && typeof part.text === 'string')
        .map(part => String(part.text))
        .join('');
    const answer = parseJson(text);
    return isClassification(answer) ? answer : undefined;
}

function isClassification(value: unknown): value is ExtractedFileClassification {
    return validateStructuredValue(CLASSIFICATION_SCHEMA, value);
}
