import { File } from 'bkper-js';
import { GEMINI_MODEL_FLASH_LITE } from '../../constants.js';
import { BkperAIResponsesClient, type BkperAIReasoningEffort } from '../BkperAIResponsesClient.js';
import { GenAIFile } from '../GenAIFile.js';
import { CLASSIFICATION_SCHEMA, JsonSchema } from '../JsonSchema.js';

export type FileClassificationKind = 'single_transaction' | 'statement';

export interface ExtractedFileClassification {
    kind: FileClassificationKind;
}

export class ExtractorFileClassification extends GenAIFile<ExtractedFileClassification> {
    constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
        super(file, env, responsesClient);
    }

    getModel(): string {
        return GEMINI_MODEL_FLASH_LITE;
    }

    getOperation(): 'file_classification' {
        return 'file_classification';
    }

    protected override getReasoningEffort(): BkperAIReasoningEffort {
        return 'minimal';
    }

    getSystemPrompt(): string {
        return `
You classify uploaded files before transaction extraction.
Return statement only when the file is clearly a bank statement, credit card statement, or similar document with a table/list of multiple transaction rows.
Return single_transaction for invoices, receipts, payment confirmations, message screenshots, estimates, quotes, or anything unclear.
When uncertain, choose single_transaction.
`;
    }

    getDefaultUserPrompt(): string {
        return `Classify this file for transaction extraction.`;
    }

    getResponseSchema(): JsonSchema {
        return CLASSIFICATION_SCHEMA;
    }
}
