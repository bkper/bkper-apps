import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { CuratorStatementIMG } from '../../../src/genai/statement/img/CuratorStatementIMG.js';
import { ReflectionResult } from '../../../src/genai/ace/ReflectionResult.js';

describe('CuratorStatementIMG', () => {
    let curator: CuratorStatementIMG;

    beforeEach(() => {
        const reflection: ReflectionResult = {
            whatWorked: ['Date extraction was accurate'],
            whatFailed: ['Amount column was wrong'],
            suggestedImprovements: 'Specify which column contains amounts',
        };
        curator = new CuratorStatementIMG(reflection, {} as Env);
    });

    it('returns bullets produced by text-only curation', async () => {
        const bullets = ['Use the right-side amount column'];
        const query = spyOn(curator, 'query').mockResolvedValue({ bullets });

        expect(await curator.extractNewBullets()).toEqual(bullets);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toHaveLength(1);
        expect(query.mock.calls[0][0][0]).toHaveProperty('text');
    });

    it('does not query when reflection contains no failures', async () => {
        const noFailureCurator = new CuratorStatementIMG({
            whatWorked: ['Everything worked'],
            whatFailed: [],
            suggestedImprovements: '',
        }, {} as Env);
        const query = spyOn(noFailureCurator, 'query');

        expect(await noFailureCurator.extractNewBullets()).toEqual([]);
        expect(query).not.toHaveBeenCalled();
    });
});
