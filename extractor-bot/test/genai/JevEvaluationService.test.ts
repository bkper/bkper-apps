import { describe, expect, it, mock } from 'bun:test';

import { BkperAIClientError } from '../../src/genai/BkperAIClientError.js';
import {
    BkperAIEvaluationsClient,
    type BooleanEvaluationRequest,
} from '../../src/genai/BkperAIEvaluationsClient.js';
import {
    ACE_BULLET_REDUNDANCY_PROBABILITY_THRESHOLD,
    INVOICE_DESCRIPTION_EQUIVALENCE_PROBABILITY_THRESHOLD,
    JevEvaluationService,
} from '../../src/genai/JevEvaluationService.js';

function createService(probabilities: Record<string, number>): { service: JevEvaluationService; evaluateBooleans: ReturnType<typeof mock> } {
    const evaluateBooleans = mock(async (_request: BooleanEvaluationRequest) => ({ probabilities }));
    const client = { evaluateBooleans } as unknown as BkperAIEvaluationsClient;
    return { service: new JevEvaluationService(client), evaluateBooleans };
}

describe('JevEvaluationService', () => {
    it('uses a conservative invoice-specific threshold for equivalent and different descriptions', async () => {
        const { service } = createService({ pair_0: INVOICE_DESCRIPTION_EQUIVALENCE_PROBABILITY_THRESHOLD, pair_1: 0.2 });

        const result = await service.areInvoiceDescriptionsEquivalent([
            { first: 'Cloud hosting services for March', second: 'March cloud-hosting services' },
            { first: 'Cloud hosting services', second: 'Office furniture purchase' },
        ]);

        expect(INVOICE_DESCRIPTION_EQUIVALENCE_PROBABILITY_THRESHOLD).toBe(0.9);
        expect(result).toEqual([true, false]);
    });

    it('treats an invoice probability below the threshold as different', async () => {
        const { service } = createService({ pair_0: INVOICE_DESCRIPTION_EQUIVALENCE_PROBABILITY_THRESHOLD - 0.001 });

        expect(await service.areInvoiceDescriptionsEquivalent([
            { first: 'Professional services', second: 'Consulting services' },
        ])).toEqual([false]);
    });

    it('batches invoice pairs into one evaluation request and preserves ACE context', async () => {
        const { service, evaluateBooleans } = createService({ pair_0: 0.95, pair_1: 0.96 });

        await service.areInvoiceDescriptionsEquivalent([
            { first: 'Description A', second: 'Description B' },
            { first: 'Description C', second: 'Description D' },
        ], { document_kind: 'invoice', stage: 'post_validation', epoch: 2 });

        expect(evaluateBooleans).toHaveBeenCalledTimes(1);
        const request = evaluateBooleans.mock.calls[0][0] as BooleanEvaluationRequest;
        expect(request.evaluationKind).toBe('invoice_description_equivalence');
        expect(Object.keys(request.questions)).toEqual(['pair_0', 'pair_1']);
        expect(request.context).toMatchObject({
            document_kind: 'invoice',
            stage: 'post_validation',
            epoch: 2,
        });
    });

    it('uses a stricter redundancy threshold and retains borderline new guidance', async () => {
        const { service } = createService({ new_0: ACE_BULLET_REDUNDANCY_PROBABILITY_THRESHOLD, new_1: ACE_BULLET_REDUNDANCY_PROBABILITY_THRESHOLD - 0.001 });

        const result = await service.areAceBulletsRedundant(
            ['Extract the date from the first column'],
            ['Read dates from column one', 'Skip total rows']
        );

        expect(ACE_BULLET_REDUNDANCY_PROBABILITY_THRESHOLD).toBe(0.95);
        expect(result).toEqual([true, false]);
    });

    it('batches all new bullets against existing guidance in one request', async () => {
        const { service, evaluateBooleans } = createService({ new_0: 0.99, new_1: 0.1 });

        await service.areAceBulletsRedundant(
            ['Extract dates', 'Extract amounts'],
            ['Read dates', 'Skip headers'],
            { document_kind: 'statement', stage: 'curation', epoch: 3 }
        );

        expect(evaluateBooleans).toHaveBeenCalledTimes(1);
        const request = evaluateBooleans.mock.calls[0][0] as BooleanEvaluationRequest;
        expect(request.evaluationKind).toBe('ace_bullet_redundancy');
        expect(Object.keys(request.questions)).toEqual(['new_0', 'new_1']);
        expect(request.context).toMatchObject({
            document_kind: 'statement',
            stage: 'curation',
            epoch: 3,
        });
    });

    it('fails conservatively on evaluation errors', async () => {
        const evaluateBooleans = mock(async () => {
            throw new BkperAIClientError(502, 'provider_error', 'Safe upstream error.', false);
        });
        const service = new JevEvaluationService({ evaluateBooleans } as unknown as BkperAIEvaluationsClient);

        expect(await service.areInvoiceDescriptionsEquivalent([
            { first: 'A', second: 'B' },
        ])).toEqual([false]);
        expect(await service.areAceBulletsRedundant(['Existing'], ['New'])).toEqual([false]);
    });

    it('propagates aborts instead of converting them to conservative results', async () => {
        const abort = new BkperAIClientError(0, 'request_aborted', 'Bkper AI request was aborted.', false);
        const evaluateBooleans = mock(async () => {
            throw abort;
        });
        const service = new JevEvaluationService({ evaluateBooleans } as unknown as BkperAIEvaluationsClient);

        await expect(service.areInvoiceDescriptionsEquivalent([
            { first: 'A', second: 'B' },
        ])).rejects.toBe(abort);
    });
});
