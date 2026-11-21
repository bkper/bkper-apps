import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ClassificationCase, Label } from './cases.js';

/** A document as the bot receives it: file bytes with their content type. */
export interface DocumentContent {
    mediaType: 'application/pdf' | 'image/png' | 'image/jpeg';
    base64: string;
    sha256: string;
}

const DOCUMENTS_DIR = join(import.meta.dir, 'documents');

export function mediaTypeOf(file: string): DocumentContent['mediaType'] {
    if (file.endsWith('.pdf')) return 'application/pdf';
    if (file.endsWith('.png')) return 'image/png';
    if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
    throw new Error(`No media type for ${file}.`);
}

export function documentContent(file: string, bytes: Buffer): DocumentContent {
    return {
        mediaType: mediaTypeOf(file),
        base64: bytes.toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
    };
}

export async function loadDocuments(cases: ClassificationCase[]): Promise<Map<string, DocumentContent>> {
    const entries = await Promise.all(cases.map(async classificationCase =>
        [classificationCase.id, documentContent(classificationCase.file, await readFile(join(DOCUMENTS_DIR, classificationCase.file)))] as const));
    return new Map(entries);
}

export const DECISION_MODEL = 'gemini-decision';

/** The question name in every decision request; the answer comes back under the same name. */
export const KIND_QUESTION = 'kind';

/** Stands for the uploaded file in the state. */
export const FILE_PLACEHOLDER = 'uploaded-file';

/**
 * The bot's classification rule as `choice` criteria, in the words of its Flash-Lite system prompt.
 * Its "when uncertain, choose single_transaction" is left to code: a threshold on the probability.
 */
export const KIND_CRITERIA: Record<Label, string> = {
    statement: 'A bank statement, credit card statement, or similar document with a table or list of multiple transaction rows.',
    single_transaction: 'An invoice, receipt, payment confirmation, message screenshot, estimate, quote, or anything else.',
};

type DecisionAsset =
    | { type: 'file'; media_type: 'application/pdf'; data_base64: string }
    | { type: 'image'; format: 'png' | 'jpeg'; data_base64: string };

export interface DecisionRequest {
    model: string;
    state: { document: string };
    assets: Record<string, DecisionAsset>;
    questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<Label, string> }>;
}

function asset(document: DocumentContent): DecisionAsset {
    if (document.mediaType === 'application/pdf') {
        return { type: 'file', media_type: document.mediaType, data_base64: document.base64 };
    }
    return { type: 'image', format: document.mediaType === 'image/png' ? 'png' : 'jpeg', data_base64: document.base64 };
}

/** One Open System One request per document: the file, unchanged, and one `choice` question. */
export function buildDecisionRequest(document: DocumentContent): DecisionRequest {
    return {
        model: DECISION_MODEL,
        state: { document: FILE_PLACEHOLDER },
        assets: { [FILE_PLACEHOLDER]: asset(document) },
        questions: {
            [KIND_QUESTION]: {
                type: 'choice',
                instructions: 'Classify `document` for transaction extraction.',
                criteria: KIND_CRITERIA,
            },
        },
    };
}

/** The request with the document's bytes replaced by their hash, as it is recorded. */
export function redactDocument(value: unknown, document: DocumentContent): unknown {
    if (typeof value === 'string') return value.split(document.base64).join(`sha256:${document.sha256}`);
    if (Array.isArray(value)) return value.map(item => redactDocument(item, document));
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDocument(item, document)]));
    }
    return value;
}
