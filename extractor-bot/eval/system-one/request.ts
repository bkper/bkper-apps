import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { REFERENCE_DATE, type ExtractionCase } from './cases.js';
import type { SystemOneQuestion, SystemOneRequest } from './contract.js';

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
    itemNames: 'item_names',
} as const;

/**
 * Instructions shaped like those Extractor Bot learns from corrections and keeps on an Account or
 * Group (`extractor_prompt_transaction`): plain bullets covering every field. The first four address
 * the tuned request's misses on these documents, to see whether Clairic follows notes in its state.
 * The last two come from the bot's Gemini prompt and do not apply to Clairic's questions, to see
 * whether notes that do not apply do harm.
 */
export const BOOK_NOTES = [
    'The date is when the document was issued or paid. On a hotel folio, it is the payment or departure date, not the arrival date.',
    'When an email states a balance or an amount due, that amount is the total.',
    'A trip or ride code, such as "Código da viagem", is the document number.',
    'The supplier is the business named at the top of a receipt, even when scanning replaced letters with digits.',
    'Summarize the purchased items in a short description, in the language of the document.',
    'Do NOT include any additional property.',
] as const;

/**
 * The four Book notes that apply to Clairic's questions, each appended to its own field's
 * instructions instead of the state. The notes that do not apply to any question are left out.
 */
export const FIELD_NOTES: Readonly<Record<string, string>> = {
    [QUESTIONS.date]: 'On a hotel folio, it is the payment or departure date, not the arrival date.',
    [QUESTIONS.total]: 'When an email states a balance or an amount due, that amount is the total.',
    [QUESTIONS.supplier]: 'The supplier is the business named at the top of a receipt, even when scanning replaced letters with digits.',
    [QUESTIONS.documentNumber]: 'A trip or ride code, such as "Código da viagem", is the document number.',
};

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

/**
 * The same document with the context Extractor Bot has: the buyer, from the Book. Code reads the
 * currency of text documents and writes the description from item names, so Clairic is asked for
 * currency only on images and never for a description. No reference date unless asked: like the
 * bot, it gets none by default, so it cannot fill a missing date with it. Book notes, when given,
 * sit between the buyer and the document.
 */
export function buildClairicTunedRequest(
    model: string,
    extractionCase: ExtractionCase,
    document: DocumentContent,
    options: { referenceDate?: boolean; bookNotes?: readonly string[]; fieldNotes?: Readonly<Record<string, string>> } = {}
): SystemOneRequest {
    const { reference_date: referenceDate, ...original } = buildClairicRequest(model, extractionCase, document);
    const asked = original.questions;
    const image = extractionCase.image;
    const notes = options.bookNotes ? `Book notes:\n${options.bookNotes.map(note => `- ${note}`).join('\n')}\n\n` : '';
    const questions: Record<string, SystemOneQuestion> = {
        [QUESTIONS.date]: {
            type: 'date',
            instructions: 'Date written on the document when it was issued or paid, or when the purchase or service took place. Not a due date, a delivery date, or the start or end of a billing period. Null when the document states no such date.',
        },
        [QUESTIONS.total]: asked[QUESTIONS.total],
        ...(image
            ? {
                [QUESTIONS.currency]: {
                    type: 'text',
                    instructions: 'Currency symbol or code written with the total, such as $, R$, €, £ or USD.',
                },
            }
            : {}),
        [QUESTIONS.supplier]: {
            type: 'text',
            instructions: 'Name of the business or person that issued the document or received the payment. Never the buyer named on the first line, who paid or was billed.',
        },
        [QUESTIONS.documentNumber]: {
            type: 'text',
            instructions: 'Number that identifies this invoice, receipt, bill, order or service note, often labelled Invoice, Receipt, Bill, Order, Folio, No, Nº, #, Fatura, Nota or Cupom. Not a tax ID, customer account, phone, card or payment authorization number.',
        },
        [QUESTIONS.itemNames]: {
            type: 'list',
            items: 'text',
            instructions: 'Name of each purchased good or service, as written. Not taxes, fees, discounts or totals.',
        },
        [QUESTIONS.lineAmounts]: asked[QUESTIONS.lineAmounts],
        [QUESTIONS.charges]: asked[QUESTIONS.charges],
        [QUESTIONS.discounts]: asked[QUESTIONS.discounts],
    };
    return {
        ...original,
        state: image
            ? `Buyer: ${extractionCase.buyer}\n\n${notes}${original.state}`
            : `Buyer: ${extractionCase.buyer}\n\n${notes}Document:\n${original.state}`,
        questions: withFieldNotes(questions, options.fieldNotes ?? {}),
        ...(options.referenceDate ? { reference_date: referenceDate } : {}),
    };
}

/** Each note appended to its question's instructions, in the same question order. */
function withFieldNotes(questions: Record<string, SystemOneQuestion>, notes: Readonly<Record<string, string>>): Record<string, SystemOneQuestion> {
    return Object.fromEntries(Object.entries(questions).map(([name, question]) => {
        const note = notes[name];
        return [name, note ? { ...question, instructions: `${question.instructions} ${note}` } : question];
    }));
}
