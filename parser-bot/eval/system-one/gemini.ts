import { Book, File } from 'bkper-js';

import { BkperAIResponsesClient } from '../../src/genai/BkperAIResponsesClient.js';
import type { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';
import { ExtractorInvoice } from '../../src/genai/invoice/ExtractorInvoice.js';
import { EXTRACTED_TRANSACTION_SCHEMA, validateStructuredValue } from '../../src/genai/JsonSchema.js';
import { isRecord } from './contract.js';
import type { DocumentContent } from './request.js';

/**
 * Extractor Bot's current invoice and receipt extraction, run unchanged: `ExtractorInvoice` with
 * its system prompt, schema, model and reasoning effort, through `BkperAIResponsesClient` to
 * `POST /v1/responses`. Only the transport is wrapped, to record each exchange.
 */

/** Property names the configured prompt asks for, matching the Clairic questions. */
export const GEMINI_PROPERTIES = {
    supplier: 'supplier',
    documentNumber: 'document_number',
    currency: 'currency',
} as const;

const DEFAULT_PROPERTY_RULE = '- Do NOT include any additional property';
const PROPERTY_RULE = `- Include these properties when the document states them, and omit a property the document does not state:
       - ${GEMINI_PROPERTIES.supplier}: name of the business or person that issued the document or received the payment
       - ${GEMINI_PROPERTIES.documentNumber}: invoice, receipt, order or bill number
       - ${GEMINI_PROPERTIES.currency}: ISO 4217 code of the amount's currency`;

/** Placeholder environment: `GenAI` takes an `Env` but reads nothing from it. */
const ENV: Env = { BKPER_AI_BASE_URL: 'https://ai-dev.bkper.app/v1' };

function documentFile(document: DocumentContent): File {
    // A File without an id never fetches: getContent returns the content it holds.
    return new File(new Book({ id: 'synthetic-book' }), {
        name: document.mimeType === 'text/plain' ? 'document.txt' : 'document',
        contentType: document.mimeType,
        content: document.base64,
    });
}

function extractor(document: DocumentContent, client?: BkperAIResponsesClient): ExtractorInvoice {
    return new ExtractorInvoice(documentFile(document), ENV, client);
}

/**
 * Books get properties extracted by configuring a transaction prompt, which replaces the default
 * user prompt. This prompt is the default with its no-properties rule replaced by the three
 * properties the trial compares, so date, amount and description follow the default rules.
 */
export function geminiPrompt(): string {
    const defaultPrompt = extractor({ mimeType: 'text/plain', base64: '' }).getDefaultUserPrompt();
    if (!defaultPrompt.includes(DEFAULT_PROPERTY_RULE)) {
        throw new Error('The default invoice prompt no longer has the rule this trial replaces.');
    }
    return defaultPrompt.replace(DEFAULT_PROPERTY_RULE, PROPERTY_RULE);
}

export function geminiSystemPrompt(): string {
    return extractor({ mimeType: 'text/plain', base64: '' }).getSystemPrompt();
}

export interface GeminiExchange {
    status: number;
    latencyMs: number;
    request: unknown;
    body: unknown;
}

function parseJson(text: string): unknown {
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
 * Runs the bot's extraction on one document and returns every HTTP exchange it made, retries
 * included. Extraction errors are not thrown: the recorded exchanges are scored instead.
 */
export async function callGemini(
    baseUrl: string,
    token: string,
    document: DocumentContent,
    beforeCall: () => void
): Promise<GeminiExchange[]> {
    const exchanges: GeminiExchange[] = [];
    const recordingFetch: typeof fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        beforeCall();
        const headers = new Headers(init?.headers);
        headers.set('bkper-ai-source', 'parser-bot-eval');
        const started = performance.now();
        const response = await fetch(input, { ...init, headers });
        const text = await response.clone().text();
        exchanges.push({
            status: response.status,
            latencyMs: Math.round(performance.now() - started),
            request: typeof init?.body === 'string' ? parseJson(init.body) : null,
            body: withoutEncryptedReasoning(parseJson(text)),
        });
        return response;
    }, { preconnect: fetch.preconnect });

    const client = new BkperAIResponsesClient({ readOnly: true, baseUrl, oauthToken: token, fetch: recordingFetch });
    try {
        await extractor(document, client).extract(geminiPrompt());
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

/** Whether a recorded Responses request carries the current prompts and this document. */
export function geminiRequestMatches(request: unknown, document: DocumentContent): boolean {
    const strings = collectStrings(request);
    const content = document.mimeType === 'text/plain'
        ? Buffer.from(document.base64, 'base64').toString('utf8')
        : document.base64;
    return isRecord(request)
        && request.instructions === geminiSystemPrompt()
        && strings.includes(geminiPrompt())
        && strings.some(text => text === content || (document.mimeType !== 'text/plain' && text.includes(content)));
}

export interface GeminiUsage {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
}

export interface GeminiAnswer {
    transaction: ExtractedTransaction;
    usage: GeminiUsage;
}

export function readGeminiUsage(body: unknown): GeminiUsage | undefined {
    if (!isRecord(body) || !isRecord(body.usage)) return undefined;
    const { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details: details } = body.usage;
    if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return undefined;
    const cachedInputTokens = isRecord(details) && typeof details.cached_tokens === 'number' ? details.cached_tokens : 0;
    return { inputTokens, cachedInputTokens, outputTokens };
}

function isExtractedTransaction(value: unknown): value is ExtractedTransaction {
    return validateStructuredValue(EXTRACTED_TRANSACTION_SCHEMA, value);
}

/** The structured output of an Open Responses body, validated with the bot's own schema check. */
export function readGeminiAnswer(body: unknown): GeminiAnswer | undefined {
    const usage = readGeminiUsage(body);
    if (!usage || !isRecord(body) || !Array.isArray(body.output)) return undefined;
    const text = body.output
        .filter(isRecord)
        .filter(item => item.type === 'message' && Array.isArray(item.content))
        .flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(isRecord)
        .filter(part => part.type === 'output_text' && typeof part.text === 'string')
        .map(part => String(part.text))
        .join('');
    const transaction = parseJson(text);
    return isExtractedTransaction(transaction) ? { transaction, usage } : undefined;
}
