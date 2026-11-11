import { GenAI } from './GenAI.js';
import { GEMINI_MODEL_FLASH_LITE } from '../constants.js';
import { BkperAIResponsesClient, type BkperAIReasoningEffort } from './BkperAIResponsesClient.js';
import { JsonSchema, OPTIONAL_DATE_SCHEMA } from './JsonSchema.js';

export class ExtractorDate extends GenAI<string | undefined> {

    constructor(env: Env, responsesClient?: BkperAIResponsesClient) {
        super(env, responsesClient);
    }

    getModel(): string {
        return GEMINI_MODEL_FLASH_LITE;
    }

    getOperation(): 'date_extraction' {
        return 'date_extraction';
    }

    protected override getReasoningEffort(): BkperAIReasoningEffort {
        return 'minimal';
    }

    getSystemPrompt(): string {
        return `
You are a specialized assistant that extracts dates from transaction descriptions.

TASK: Extract the most relevant date from the transaction description.

RULES:
1. Look for dates in various formats: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY
2. Consider context clues like "PER", "vom", "dated", "on", "until", etc.
4. When the date is in DD.MM format, use the current year as the year
3. Prefer transaction dates over reference dates or system dates
4. Return the date in YYYY-MM-DD format
5. If multiple dates exist, prefer the main transaction/event date
6. If no clear date is found, return null

EXAMPLES:
"ABSCHLUSS PER 31.08.2025" -> "2025-08-31"
"SEPA Lastschrift vom 09.09.2025" -> "2025-09-09"
"Payment dated 15/03/2024" -> "2024-03-15"
"Transfer on 2024-12-01 ref#123" -> "2024-12-01"
"Monthly payment until 30.06.2025" -> "2025-06-30"
"#legendzbuy for 200sc" -> null (no date found)
"Invoice 123/2024 due 31.12.2024" -> "2024-12-31"
"Refund processed 01-Jan-2025" -> "2025-01-01"
"Purchase on 22.09 -> "2025-09-22" (current being 2025)
"Purchase on 22-09 -> "2025-09-22" (current being 2025)

Extract the primary date in YYYY-MM-DD format or return null:`;
    }

    getResponseSchema(): JsonSchema {
        return OPTIONAL_DATE_SCHEMA;
    }

    public async extract(description: string): Promise<string | undefined> {
        if (!description || description.trim().length === 0) {
            return undefined;
        }
        try {
            if (!this.readOnly) console.log(`DATE EXTRACTOR PROMPT:`, description);
            const result = await this.query([{ text: description }]);

            return result;
        } catch (error) {
            if (this.readOnly) throw error;
            console.error('ExtractorDate error:', error);
            return undefined;
        }
    }
}
