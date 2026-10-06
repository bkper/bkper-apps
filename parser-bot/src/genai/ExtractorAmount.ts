import { GenAI } from './GenAI.js';
import { Amount } from 'bkper-js';
import { GEMINI_MODEL_FLASH_LITE } from '../constants.js';
import { BkperAIResponsesClient, type BkperAIReasoningEffort } from './BkperAIResponsesClient.js';
import { AMOUNT_SCHEMA, JsonSchema } from './JsonSchema.js';

export class ExtractorAmount extends GenAI<Amount | null> {

    constructor(env: Env, responsesClient?: BkperAIResponsesClient) {
        super(env, responsesClient);
    }

    getModel(): string {
        return GEMINI_MODEL_FLASH_LITE;
    }

    getOperation(): 'amount_extraction' {
        return 'amount_extraction';
    }

    protected override getReasoningEffort(): BkperAIReasoningEffort {
        return 'minimal';
    }

    getSystemPrompt(): string {
        return `
You are a specialized assistant that extracts numeric amounts from transaction descriptions.

TASK: Extract the most relevant monetary amount from the transaction description.

RULES:
1. Look for numeric values that represent monetary amounts
2. Ignore transaction IDs, dates, reference numbers, quantities (unless they represent amounts)
3. Consider context clues like currency symbols, "for", "amount", "total", etc.
4. Return the amount as a positive number (no currency symbols)
5. If multiple amounts exist, prefer the main transaction amount over fees or taxes
6. If no clear monetary amount is found, return null

EXAMPLES:
"#legendzbuy for 200sc" -> 200.00
"Payment of $150.50 to vendor" -> 150.50
"Transfer €1,234.56 processing fee €5" -> 1234.56
"Amazon purchase 45.99 USD ref#123456" -> 45.99
"Salary payment 5k monthly" -> 5000
"ABSCHLUSS PER 31.08.2025" -> null (no amount found)
"Invoice #123 total: 2,500.00" -> 2500.00
"Refund amount 99.95" -> 99.95

Extract the primary monetary amount or return null:`;
    }

    getResponseSchema(): JsonSchema {
        return AMOUNT_SCHEMA;
    }

    public async extract(description: string): Promise<Amount | null> {
        if (!description || description.trim().length === 0) {
            return null;
        }

        try {
            if (!this.readOnly) console.log(`AMOUNT EXTRACTOR PROMPT:`, description);
            const result = await this.query([{ text: description }]);

            return result ? new Amount(result) : null;
        } catch (error) {
            if (this.readOnly) throw error;
            console.error('ExtractorAmount error:', error);
            return null;
        }
    }
}
