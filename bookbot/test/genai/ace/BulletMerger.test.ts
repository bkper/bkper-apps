import { describe, expect, it, mock } from 'bun:test';

import { BulletMerger } from '../../../src/genai/ace/BulletMerger.js';
import type { SemanticEvaluationService } from '../../../src/genai/JevEvaluationService.js';

function createMerger(results: boolean[]): { merger: BulletMerger; areAceBulletsRedundant: ReturnType<typeof mock> } {
    const areAceBulletsRedundant = mock(async () => results);
    const evaluator = { areAceBulletsRedundant } as unknown as SemanticEvaluationService;
    return { merger: new BulletMerger(evaluator), areAceBulletsRedundant };
}

describe('BulletMerger', () => {
    it('preserves existing bullets without a remote call when no new bullets are provided', async () => {
        const { merger, areAceBulletsRedundant } = createMerger([]);
        const existing = ['Look for date in column 1', 'Extract amount from column 3'];

        expect(await merger.mergeBullets(existing, [])).toEqual(existing);
        expect(areAceBulletsRedundant).not.toHaveBeenCalled();
    });

    it('appends new bullets without a remote call when no guidance exists', async () => {
        const { merger, areAceBulletsRedundant } = createMerger([]);
        const additions = ['Look for date in column 1', 'Extract amount from column 3'];

        expect(await merger.mergeBullets([], additions)).toEqual(additions);
        expect(areAceBulletsRedundant).not.toHaveBeenCalled();
    });

    it('preserves existing guidance, removes redundant bullets, and retains distinct bullets', async () => {
        const { merger, areAceBulletsRedundant } = createMerger([true, false, true]);
        const existing = ['Look for date in column 1', 'Extract amount from column 3'];
        const additions = ['Get date from first column', 'Skip header rows', 'Parse amount in third column'];
        const context = { document_kind: 'statement' as const, stage: 'curation' as const, epoch: 2 };

        expect(await merger.mergeBullets(existing, additions, context)).toEqual([
            'Look for date in column 1',
            'Extract amount from column 3',
            'Skip header rows',
        ]);
        expect(areAceBulletsRedundant).toHaveBeenCalledTimes(1);
        expect(areAceBulletsRedundant).toHaveBeenCalledWith(existing, additions, context);
    });

    it('retains every new bullet when evaluation fails conservatively', async () => {
        const { merger } = createMerger([false, false]);

        expect(await merger.mergeBullets(
            ['Extract dates'],
            ['Read dates from column one', 'Skip totals']
        )).toEqual(['Extract dates', 'Read dates from column one', 'Skip totals']);
    });

    it('fails closed if an evaluator returns an incomplete decision list', async () => {
        const { merger } = createMerger([true]);

        expect(await merger.mergeBullets(
            ['Extract dates'],
            ['Read dates from column one', 'Skip totals']
        )).toEqual(['Extract dates', 'Read dates from column one', 'Skip totals']);
    });
});
