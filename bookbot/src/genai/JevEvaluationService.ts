import { BkperAIClientError } from './BkperAIClientError.js';
import {
    BkperAIEvaluationsClient,
    type BooleanEvaluationQuestion,
    type EvaluationKind,
} from './BkperAIEvaluationsClient.js';
import type { GenAIRequestContext } from './GenAITelemetry.js';

export interface InvoiceDescriptionPair {
    first: string;
    second: string;
}

export interface SemanticEvaluationService {
    areInvoiceDescriptionsEquivalent(pairs: InvoiceDescriptionPair[], context?: GenAIRequestContext): Promise<boolean[]>;
    areAceBulletsRedundant(existingBullets: string[], newBullets: string[], context?: GenAIRequestContext): Promise<boolean[]>;
}

// Material equivalence can affect whether corrected financial records are accepted as unchanged.
// Start at 90% so ambiguous descriptions are treated as different rather than masking a correction.
export const INVOICE_DESCRIPTION_EQUIVALENCE_PROBABILITY_THRESHOLD = 0.9;

// A false positive here discards useful learned guidance, so redundancy requires stronger evidence.
export const ACE_BULLET_REDUNDANCY_PROBABILITY_THRESHOLD = 0.95;

function isAbort(error: unknown): boolean {
    return (error instanceof BkperAIClientError && error.code === 'request_aborted') ||
        (error instanceof DOMException && error.name === 'AbortError');
}

function safeErrorCode(error: unknown): string {
    return error instanceof BkperAIClientError ? error.code : 'unexpected_error';
}

export class JevEvaluationService implements SemanticEvaluationService {
    constructor(private readonly client: BkperAIEvaluationsClient) {}

    async areInvoiceDescriptionsEquivalent(
        pairs: InvoiceDescriptionPair[],
        context: GenAIRequestContext = {}
    ): Promise<boolean[]> {
        if (pairs.length === 0) return [];

        const questionIds = pairs.map((_, index) => `pair_${index}`);
        const questions = Object.fromEntries(questionIds.map((id, index) => [
            id,
            {
                instructions: `For the description pair identified as ${id}, decide whether both descriptions materially identify the same purchased goods, services, or invoice subject. Ignore harmless wording, order, casing, abbreviations, and formatting differences. Return false when a description adds, removes, or changes material subject matter, or when equivalence is uncertain.`,
                criteria: {
                    true: 'The descriptions are materially equivalent for invoice validation.',
                    false: 'The descriptions are materially different, incomplete relative to each other, or equivalence is uncertain.',
                },
            } satisfies BooleanEvaluationQuestion,
        ]));
        const probabilities = await this.evaluateConservatively(
            'invoice_description_equivalence',
            { pairs: pairs.map((pair, index) => ({ id: questionIds[index], ...pair })) },
            questions,
            questionIds,
            context
        );

        return questionIds.map(id =>
            (probabilities[id] ?? 0) >= INVOICE_DESCRIPTION_EQUIVALENCE_PROBABILITY_THRESHOLD
        );
    }

    async areAceBulletsRedundant(
        existingBullets: string[],
        newBullets: string[],
        context: GenAIRequestContext = {}
    ): Promise<boolean[]> {
        if (newBullets.length === 0) return [];
        if (existingBullets.length === 0) return newBullets.map(() => false);

        const questionIds = newBullets.map((_, index) => `new_${index}`);
        const questions = Object.fromEntries(questionIds.map(id => [
            id,
            {
                instructions: `For the new guidance item identified as ${id}, decide whether its complete actionable instruction is already covered by any existing guidance item. Related subject matter alone is not redundant. Return false if it adds any distinct condition, exception, field, source, transformation, or action, or when redundancy is uncertain.`,
                criteria: {
                    true: 'At least one existing guidance item already covers the complete actionable meaning of the new item.',
                    false: 'The new item adds distinct guidance, is only partially related, or redundancy is uncertain.',
                },
            } satisfies BooleanEvaluationQuestion,
        ]));
        const probabilities = await this.evaluateConservatively(
            'ace_bullet_redundancy',
            {
                existing_guidance: existingBullets.map((text, index) => ({ id: `existing_${index}`, text })),
                new_guidance: newBullets.map((text, index) => ({ id: questionIds[index], text })),
            },
            questions,
            questionIds,
            context
        );

        return questionIds.map(id =>
            (probabilities[id] ?? 0) >= ACE_BULLET_REDUNDANCY_PROBABILITY_THRESHOLD
        );
    }

    private async evaluateConservatively(
        evaluationKind: EvaluationKind,
        state: Parameters<BkperAIEvaluationsClient['evaluateBooleans']>[0]['state'],
        questions: Record<string, BooleanEvaluationQuestion>,
        questionIds: string[],
        context: GenAIRequestContext
    ): Promise<Record<string, number>> {
        try {
            const result = await this.client.evaluateBooleans({
                evaluationKind,
                state,
                questions,
                context,
            });
            return result.probabilities;
        } catch (error) {
            if (isAbort(error)) throw error;
            console.warn('JEV_EVALUATION_FALLBACK', JSON.stringify({
                evaluation_kind: evaluationKind,
                outcome: safeErrorCode(error),
            }));
            return Object.fromEntries(questionIds.map(id => [id, 0]));
        }
    }
}
