import { File } from 'bkper-js';
import type { ChoiceQuestion } from '@typesafe-ai/sdk';
import { FILE_CLASSIFICATION_MODEL } from '../../constants.js';
import type { BkperAIEvaluationsClient, EvaluationAsset } from '../BkperAIEvaluationsClient.js';

export type FileClassificationKind = 'single_transaction' | 'statement';

export interface ExtractedFileClassification {
    kind: FileClassificationKind;
}

/**
 * A file is read as a statement, one draft per row, only from this probability up; below it, as
 * one transaction. Misreading an invoice as a statement creates many wrong drafts, so doubt goes to
 * one transaction. In the synthetic trial every statement scored at least 0.97 and the closest
 * other document 0.41, so 0.8 leaves room on both sides.
 */
export const STATEMENT_PROBABILITY_THRESHOLD = 0.8;

/** The question name; the answer comes back under the same name. */
export const FILE_CLASSIFICATION_QUESTION = 'kind';

/** Stands for the uploaded file in the state. */
const FILE_PLACEHOLDER = 'uploaded-file';

const KIND_QUESTION: ChoiceQuestion<Record<FileClassificationKind, string>> = {
    type: 'choice',
    instructions: 'Classify `document` for transaction extraction.',
    criteria: {
        statement: 'A bank statement, credit card statement, or similar document with a table or list of multiple transaction rows.',
        single_transaction: 'An invoice, receipt, payment confirmation, message screenshot, estimate, quote, or anything else.',
    },
};

export interface FileClassificationRequest {
    state: { document: string };
    assets?: Record<string, EvaluationAsset>;
    questions: Record<string, ChoiceQuestion>;
}

const IMAGE_FORMATS: Readonly<Record<string, 'png' | 'jpeg' | 'webp'>> = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/webp': 'webp',
};

function decodeBase64Text(data: string): string {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
}

/**
 * The System One request for a file: text files as the state, other files unchanged as an asset
 * (PDFs and other documents as files, png, jpeg and webp as images).
 */
export function buildFileClassificationRequest(contentType: string, base64: string): FileClassificationRequest {
    const mediaType = contentType.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    const questions = { [FILE_CLASSIFICATION_QUESTION]: KIND_QUESTION };
    if (mediaType.startsWith('text/')) {
        return { state: { document: decodeBase64Text(base64) }, questions };
    }
    const format = IMAGE_FORMATS[mediaType];
    const asset: EvaluationAsset = format
        ? { type: 'image', format, data_base64: base64 }
        : { type: 'file', media_type: mediaType, data_base64: base64 };
    return { state: { document: FILE_PLACEHOLDER }, assets: { [FILE_PLACEHOLDER]: asset }, questions };
}

/** Classifies an uploaded file before extraction with a System One decision model that reads PDFs. */
export class ExtractorFileClassification {
    constructor(
        private readonly file: File,
        private readonly evaluationsClient: BkperAIEvaluationsClient
    ) {}

    async extract(): Promise<ExtractedFileClassification | undefined> {
        const content = await this.file.getContent();
        if (!content) return undefined;

        const { probabilities } = await this.evaluationsClient.evaluateChoices({
            evaluationKind: 'file_classification',
            model: FILE_CLASSIFICATION_MODEL,
            ...buildFileClassificationRequest(this.file.getContentType() ?? '', content),
        });
        const pStatement = probabilities[FILE_CLASSIFICATION_QUESTION]?.statement ?? 0;
        return { kind: pStatement >= STATEMENT_PROBABILITY_THRESHOLD ? 'statement' : 'single_transaction' };
    }
}
