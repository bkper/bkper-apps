import { File } from 'bkper-js';
import { BkperAIResponsesClient } from '../BkperAIResponsesClient.js';
import { ReflectorBase } from '../ace/ReflectorBase.js';
import { ExtractedTransaction } from '../ExtractedTransaction.js';
import { ReflectionResult } from '../ace/ReflectionResult.js';

export type { ReflectionResult };

export class ReflectorInvoice extends ReflectorBase {
    constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
        super(file, env, responsesClient);
    }

    getSystemPrompt(): string {
        return `You are an expert at analyzing invoice/receipt extraction quality.
Compare the AI extraction with user corrections and identify patterns of success and failure.`;
    }

    protected buildUserPrompt(aiExtracted: ExtractedTransaction[], userCorrected: ExtractedTransaction[], userRemoved: ExtractedTransaction[], currentPrompt?: string): string {
        // For invoices, we expect single-element arrays
        const aiTransaction = aiExtracted[0];
        const userTransaction = userCorrected[0];

        let prompt = `Analyze the following invoice/receipt extraction quality:

AI Extracted:
${JSON.stringify(aiTransaction, null, 2)}

User Corrected To:
${JSON.stringify(userTransaction, null, 2)}`;

        // Add current instructions context for multi-epoch ACE
        if (currentPrompt) {
            prompt += `

CURRENT INSTRUCTIONS (already in effect):
${currentPrompt}

These instructions are already in effect when generating the AI extraction above.
When suggesting improvements, DO NOT contradict these existing instructions.
Build upon them to address remaining failures.`;
        }

        prompt += `

Compare these and identify:
1. What fields were extracted correctly (whatWorked)
2. What fields needed correction (whatFailed)
3. Specific suggestions to improve the extraction prompt (suggestedImprovements)

- Focus on patterns and specific guidance that would help extract similar documents correctly in the future.
- We are strict about properties, so be explicit on which properties to extract.
- If user removed a given property, give instructions to NOT extract it.
`;

        return prompt;
    }
}
