import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FILE_CLASSIFICATION_MODEL } from '../../src/constants.js';
import {
    buildFileClassificationRequest,
    FILE_CLASSIFICATION_QUESTION,
    type FileClassificationRequest,
} from '../../src/genai/file/ExtractorFileClassification.js';
import type { ClassificationCase } from './cases.js';

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

export const DECISION_MODEL = FILE_CLASSIFICATION_MODEL;

/** The question name in every decision request; the answer comes back under the same name. */
export const KIND_QUESTION = FILE_CLASSIFICATION_QUESTION;

export interface DecisionRequest extends FileClassificationRequest {
    model: string;
}

/** One Open System One request per document, exactly as Extractor Bot builds it. */
export function buildDecisionRequest(document: DocumentContent): DecisionRequest {
    return { model: DECISION_MODEL, ...buildFileClassificationRequest(document.mediaType, document.base64) };
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
