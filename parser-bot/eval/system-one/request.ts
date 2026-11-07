import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { REFERENCE_DATE, type ExtractionCase } from './cases.js';
import type { SystemOneRequest } from './contract.js';

/** A document as the bot receives it: file bytes with their content type. */
export interface DocumentContent {
    mimeType: 'text/plain' | 'image/png' | 'image/jpeg';
    base64: string;
}

/** Question names in every Clairic request; answers come back under the same names. */
export const QUESTIONS = {
    date: 'date',
    total: 'total',
    currency: 'currency',
    supplier: 'supplier',
    documentNumber: 'document_number',
    description: 'description',
    lineAmounts: 'line_amounts',
    charges: 'charges',
    discounts: 'discounts',
} as const;

/** Stands for the scanned page in an image document's state. */
export const IMAGE_PLACEHOLDER = 'document-scan';

const IMAGES_DIR = join(import.meta.dir, 'images');

export async function loadDocument(extractionCase: ExtractionCase): Promise<DocumentContent> {
    if (extractionCase.image) {
        const bytes = await readFile(join(IMAGES_DIR, extractionCase.image.file));
        return { mimeType: `image/${extractionCase.image.format}`, base64: bytes.toString('base64') };
    }
    if (extractionCase.text === undefined) throw new Error(`Case ${extractionCase.id} has no document.`);
    return { mimeType: 'text/plain', base64: Buffer.from(extractionCase.text, 'utf8').toString('base64') };
}

export async function loadDocuments(cases: ExtractionCase[]): Promise<Map<string, DocumentContent>> {
    const entries = await Promise.all(cases.map(async extractionCase =>
        [extractionCase.id, await loadDocument(extractionCase)] as const));
    return new Map(entries);
}

/**
 * One Clairic request per document, asking for every field Extractor Bot records from an invoice
 * or receipt, plus the itemized amounts that let code check the total. The model reads values; it
 * is never asked to add them up.
 */
export function buildClairicRequest(model: string, extractionCase: ExtractionCase, document: DocumentContent): SystemOneRequest {
    const image = extractionCase.image;
    return {
        model,
        state: image ? `Scanned document: ${IMAGE_PLACEHOLDER}` : extractionCase.text ?? '',
        ...(image ? { assets: { [IMAGE_PLACEHOLDER]: { type: 'image', format: image.format, data_base64: document.base64 } } } : {}),
        reference_date: REFERENCE_DATE,
        questions: {
            [QUESTIONS.date]: {
                type: 'date',
                instructions: 'Date of the invoice, receipt, payment, purchase or service. Not a due date or the start or end of a billing period.',
            },
            [QUESTIONS.total]: {
                type: 'number',
                decimals: 2,
                instructions: 'Total amount of the document: the amount paid or due, including taxes and fees.',
            },
            [QUESTIONS.currency]: {
                type: 'text',
                instructions: 'Currency of the total, as written: a symbol, code or name.',
            },
            [QUESTIONS.supplier]: {
                type: 'text',
                instructions: 'Name of the business or person that issued the document or received the payment.',
            },
            [QUESTIONS.documentNumber]: {
                type: 'text',
                instructions: 'Invoice, receipt, order or bill number.',
            },
            [QUESTIONS.description]: {
                type: 'text',
                instructions: 'The goods or services purchased.',
            },
            [QUESTIONS.lineAmounts]: {
                type: 'list',
                items: 'number',
                decimals: 2,
                instructions: 'Amount of each purchased item or service line, before taxes, fees and discounts.',
            },
            [QUESTIONS.charges]: {
                type: 'list',
                items: 'number',
                decimals: 2,
                instructions: 'Taxes, shipping, service charges, tips and fees added to the items.',
            },
            [QUESTIONS.discounts]: {
                type: 'list',
                items: 'number',
                decimals: 2,
                instructions: 'Discounts subtracted from the items, as positive amounts.',
            },
        },
    };
}
