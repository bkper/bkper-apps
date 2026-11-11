import { BkperAIResponsesClient } from '../BkperAIResponsesClient.js';
import { EXTRACTED_TRANSACTION_SCHEMA, JsonSchema } from '../JsonSchema.js';
import { File } from 'bkper-js';
import { GenAIFile } from '../GenAIFile.js';
import { ExtractedTransaction } from '../ExtractedTransaction.js';
import { GEMINI_MODEL_FLASH } from '../../constants.js';

export class ExtractorInvoice extends GenAIFile<ExtractedTransaction> {
    constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
        super(file, env, responsesClient);
    }

    getModel(): string {
        return GEMINI_MODEL_FLASH;
    }

    getOperation(): 'transaction_extraction' {
        return 'transaction_extraction';
    }

    getSystemPrompt(): string {
        return `
     You are a specialized assistant for extracting data from invoices and receipts and generate a single transaction from it, in the language of the document.
   `;
    }

    getDefaultUserPrompt(): string {
        return `
     - Prioritize items description to generate the description of the transaction in the language of the document.
     - For a long list of items, generate a concise description of the transaction summarizing, the purchased items (e.g., "Office supplies and electronics").
     - Do NOT concatenate long product titles or list every item individually.
     - Dates on format DD/MM/YY are to be converted to YYYY-MM-DD. Example: 02/09/25 -> 2025-09-02
     - Only extract a date when it is explicitly the invoice, receipt, payment, purchase, or service date.
     - If no clear transaction date exists, return null for date. Do not infer a date from context or from the current day.
     - Do NOT include any additional property
    `;
    }
    getResponseSchema(): JsonSchema {
        return EXTRACTED_TRANSACTION_SCHEMA;
    }

    protected isStrictResponseSchema(): boolean {
        return false;
    }
}
