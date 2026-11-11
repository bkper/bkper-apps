import { BkperAIResponsesClient } from '../../BkperAIResponsesClient.js';
import { JsonSchema } from '../../JsonSchema.js';
import { File } from 'bkper-js';
import { GenAIFile } from '../../GenAIFile.js';
import { GEMINI_MODEL_FLASH } from '../../../constants.js';
import { ExtractedStatement, getExtractedStatementSchema } from '../ExtractedStatement.js';

export class ExtractorStatementIMG extends GenAIFile<ExtractedStatement> {
    constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
        super(file, env, responsesClient);
    }

    getModel(): string {
        return GEMINI_MODEL_FLASH;
    }

    getOperation(): 'transactions_extraction' {
        return 'transactions_extraction';
    }

    getSystemPrompt(): string {
        return `
        You are a specialized assistant to extract transaction data from bank and credit card statements and generate transactions from it, in the language of the document.
    `;
    }

    getDefaultUserPrompt(): string {
        return `
        - Extract transactions from the table in the document.
        - Do not include headers
        - Only extract a date when it is explicitly the transaction, posting, payment, purchase, or service date for that transaction.
        - If no clear transaction date exists, return null for date. Do not infer a date from context or from the current day.
        - Do NOT include any additional property
    `;
    }
    getResponseSchema(): JsonSchema {
        return getExtractedStatementSchema();
    }

    protected isStrictResponseSchema(): boolean {
        return false;
    }
}
