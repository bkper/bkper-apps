import { describe, expect, it, spyOn } from 'bun:test';
import { CuratorStatementCSV } from '../../../../src/genai/statement/csv/CuratorStatementCSV.js';
import { ReflectionResult } from '../../../../src/genai/ace/ReflectionResult.js';

describe('CuratorStatementCSV', () => {
    it('returns CSV curation bullets without reading a source file', async () => {
        const reflection: ReflectionResult = {
            whatWorked: ['Date column correctly mapped'],
            whatFailed: ['Amount in wrong column'],
            suggestedImprovements: 'Map amount to column 4 instead of column 3',
        };
        const curator = new CuratorStatementCSV(reflection, {} as Env);
        const bullets = ['Map amount from column 4'];
        const query = spyOn(curator, 'query').mockResolvedValue({ bullets });

        expect(await curator.extractNewBullets()).toEqual(bullets);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toHaveLength(1);
        expect(query.mock.calls[0][0][0]).toHaveProperty('text');
    });
});
