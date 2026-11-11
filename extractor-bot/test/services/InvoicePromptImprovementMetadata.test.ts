import { describe, expect, it, mock } from 'bun:test';
import { File } from 'bkper-js';

import { AppContext } from '../../src/AppContext.js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';
import { GenAIRequestContext } from '../../src/genai/GenAITelemetry.js';
import type { InvoiceDescriptionPair, SemanticEvaluationService } from '../../src/genai/JevEvaluationService.js';
import { InvoicePromptImprovementService } from '../../src/services/InvoicePromptImprovementService.js';

interface InvoiceValidationSeams {
    performPreValidation(file: File, currentPrompt: string, userCorrected: ExtractedTransaction): Promise<{ shouldSkip: boolean; currentPromptValid?: boolean; preExtracted?: ExtractedTransaction }>;
    performPostValidation(
        file: File,
        improvedPrompt: string,
        comparison: { aiExtracted: ExtractedTransaction; userCorrected: ExtractedTransaction },
        preExtracted: ExtractedTransaction,
        hasStoredPrompt: boolean,
        epochNum?: number,
        userDefinedSkipKeys?: string[]
    ): Promise<{ passed: boolean; extractedTransaction?: ExtractedTransaction }>;
}

class MetadataEvaluationService implements SemanticEvaluationService {
    readonly invoiceRequests: Array<{ pairs: InvoiceDescriptionPair[]; context: GenAIRequestContext }> = [];

    async areInvoiceDescriptionsEquivalent(pairs: InvoiceDescriptionPair[], context: GenAIRequestContext = {}): Promise<boolean[]> {
        this.invoiceRequests.push({ pairs, context });
        return pairs.map(() => true);
    }

    async areAceBulletsRedundant(): Promise<boolean[]> {
        return [];
    }
}

describe('InvoicePromptImprovementService metadata', () => {
    it('batches Jev validation comparisons and preserves the ACE stage and epoch', async () => {
        const transaction: ExtractedTransaction = {
            date: '2026-01-01',
            description: 'Example invoice',
            amount: 10,
            properties: {},
        };
        const jevEvaluationService = new MetadataEvaluationService();
        const extractor = { extract: mock().mockResolvedValue(transaction) };
        const context = {
            env: {} as Env,
            jevEvaluationService,
            createExtractorInvoice: () => extractor,
        } as unknown as AppContext;
        const service = new InvoicePromptImprovementService(context);
        const seams = service as unknown as InvoiceValidationSeams;
        const file = {} as File;

        await seams.performPreValidation(file, '- current', transaction);
        await seams.performPostValidation(file, '- improved', { aiExtracted: transaction, userCorrected: transaction }, transaction, true, 2);

        expect(jevEvaluationService.invoiceRequests).toHaveLength(2);
        expect(jevEvaluationService.invoiceRequests[0]).toMatchObject({
            pairs: [{ first: 'Example invoice', second: 'Example invoice' }],
            context: {
                operation: 'ace',
                document_kind: 'invoice',
                stage: 'pre_validation',
            },
        });
        expect(jevEvaluationService.invoiceRequests[1]).toMatchObject({
            pairs: [
                { first: 'Example invoice', second: 'Example invoice' },
                { first: 'Example invoice', second: 'Example invoice' },
            ],
            context: {
                operation: 'ace',
                document_kind: 'invoice',
                stage: 'post_validation',
                epoch: 2,
            },
        });
    });
});
