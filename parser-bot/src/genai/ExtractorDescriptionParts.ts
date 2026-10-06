import { GenAI } from './GenAI.js';
import { GEMINI_MODEL_FLASH_LITE } from '../constants.js';
import { BkperAIResponsesClient, type BkperAIReasoningEffort } from './BkperAIResponsesClient.js';
import { DESCRIPTION_PARTS_SCHEMA, JsonSchema } from './JsonSchema.js';

export class ExtractorDescriptionParts extends GenAI<string[]> {

    constructor(env: Env, responsesClient?: BkperAIResponsesClient) {
        super(env, responsesClient);
    }

    getModel(): string {
        return GEMINI_MODEL_FLASH_LITE;
    }

    getOperation(): 'description_parts_extraction' {
        return 'description_parts_extraction';
    }

    protected override getReasoningEffort(): BkperAIReasoningEffort {
        return 'minimal';
    }

    getSystemPrompt(): string {
        return `
You are a specialized assistant that extracts the most meaningful, stable parts of transaction descriptions that would be consistent across similar transactions, for search matching.

RULES:
1. Extract the most meaningful product, business, service, operation, or entity identifier
2. Preserve original casing and spelling exactly as written
3. Exclude: unique transaction IDs, amounts, dates, unique reference numbers, quantities
4. Include financial Account numbers and stable Account identifiers
5. Return only the extracted stable atomic parts with more than 5 characters, no additional text
6. If you encounter separators like dashes, plusses, colons, semicolons, asterisks, etc., split the description into multiple parts

Extract only the stable, searchable parts.`;
    }

    getDefaultUserPrompt(): string {
        return `
e-Ticket A 405 / Arrendamiento de canchas -> [Arrendamiento de canchas]
MONTLY paYMent withOUT Taxes CHRISTCHURCH455046212016 -> [MONTLY paYMent withOUT Taxes]
50611058689CHRISTCHURCH455046212016 MONTLY paYMent withOUT Taxes -> [MONTLY paYMent withOUT Taxes]
F200000 SUZANO AUSTRIA GMBH ISIN#US86964WAH51 5.000% 01/15/30 B/E DTD 05/29/19 CLB RD 01/12 PD 01/15/24 -> [SUZANO AUSTRIA GMBH]
1* Alfajor Relleno D Leche Nietitos * 8 uni: 364.32 6* Amparito Queso 80 Grs: 335.9 1* Sin Culpa Alfajor Frutos Rojos 835 Grs: 105.84 1 REDONDEO: 0.39 -> [Alfajor Relleno D Leche Nietitos, Amparito Queso, Sin Culpa Alfajor Frutos Rojos]
Amazon AMAZON RETA* NJ1JM7QA0 #goodies -> [AMAZON RETA]
Antonio da Silva : Mercado Pago -> [Antonio da Silva]
Online Banking payment to CRD 3845 Confirmation# XXXXX32951 -> [Online Banking payment to CRD 3845]
transferir de cuenta USD a cuenta UYU si corresponde -> [transferir de cuenta USD a cuenta UYU si corresponde]`;
    }

    getUserPrompt(description: string, customExamples?: string): string {
        const examples = customExamples?.trim() || this.getDefaultUserPrompt();
        return `
EXAMPLES:
${examples}

DESCRIPTION TO EXTRACT:
${description}`;
    }


    getResponseSchema(): JsonSchema {
        return DESCRIPTION_PARTS_SCHEMA;
    }

    public async extract(description: string, customExamples?: string): Promise<string[]> {
        if (!description || description.trim().length === 0) {
            return [];
        }

        try {
            return (await this.query([{ text: this.getUserPrompt(description, customExamples) }])) || [];
        } catch (error) {
            console.error('ExtractorDescriptionParts error:', error);
            return [];
        }
    }
}
