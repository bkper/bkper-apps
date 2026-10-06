import type { GenAIRequestContext } from '../GenAITelemetry.js';
import type { SemanticEvaluationService } from '../JevEvaluationService.js';

/**
 * Merges ACE guidance while preserving existing bullets.
 *
 * Jev evaluates every new bullet against the complete existing guidance in one
 * request. Only high-probability redundancy removes a new bullet; uncertain or
 * failed evaluations retain all new guidance.
 */
export class BulletMerger {
    constructor(private readonly evaluator: SemanticEvaluationService) {}

    async mergeBullets(
        existingBullets: string[],
        newBullets: string[],
        context: GenAIRequestContext = {}
    ): Promise<string[]> {
        if (existingBullets.length === 0) return [...newBullets];
        if (newBullets.length === 0) return [...existingBullets];

        const redundant = await this.evaluator.areAceBulletsRedundant(
            existingBullets,
            newBullets,
            context
        );
        if (redundant.length !== newBullets.length) {
            return [...existingBullets, ...newBullets];
        }

        return [
            ...existingBullets,
            ...newBullets.filter((_, index) => redundant[index] !== true),
        ];
    }
}
