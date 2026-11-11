import { beforeEach, describe, expect, it } from 'bun:test';
import { BulletExtractionResult, CuratorBase } from '../../../src/genai/ace/CuratorBase.js';
import { type StructuredGenerationPart } from '../../../src/genai/BkperAIResponsesClient.js';
import { ReflectionResult } from '../../../src/genai/ace/ReflectionResult.js';
import { GenAIRequestContext } from '../../../src/genai/GenAITelemetry.js';

class TestCurator extends CuratorBase {
    queriedContents?: StructuredGenerationPart[];
    queryCount = 0;
    result: BulletExtractionResult | undefined = { bullets: ['Use the corrected amount column'] };

    getUserPrompt(): string {
        return 'Apply invoice-specific curation instructions.';
    }

    public async query(contents: StructuredGenerationPart[], _context: GenAIRequestContext = {}): Promise<BulletExtractionResult | undefined> {
        this.queryCount++;
        this.queriedContents = contents;
        return this.result;
    }
}

function getText(contents: StructuredGenerationPart[] | undefined): string {
    return contents?.map((part) => typeof part === 'object' && part !== null && 'text' in part ? part.text : '').join('') ?? '';
}

describe('CuratorBase text-only curation', () => {
    let reflection: ReflectionResult;
    let curator: TestCurator;

    beforeEach(() => {
        reflection = {
            whatWorked: ['Date extraction successful'],
            whatFailed: ['Amount format incorrect'],
            suggestedImprovements: 'Use the corrected amount column',
        };
        curator = new TestCurator(reflection, {} as Env);
    });

    it('queries with text-only content', async () => {
        expect(await curator.extractNewBullets()).toEqual(['Use the corrected amount column']);
        expect(curator.queriedContents).toHaveLength(1);
        expect(curator.queriedContents?.[0]).toHaveProperty('text');
        expect(curator.queriedContents?.[0]).not.toHaveProperty('inlineData');
    });

    it('includes reflection data and domain context in curation', async () => {
        await curator.extractNewBullets();
        const prompt = getText(curator.queriedContents);

        expect(prompt).toContain('Date extraction successful');
        expect(prompt).toContain('Amount format incorrect');
        expect(prompt).toContain('Use the corrected amount column');
        expect(prompt).toContain('invoice-specific curation instructions');
    });

    it('constructs and executes without a file object or content read', async () => {
        expect(await curator.extractNewBullets()).toEqual(['Use the corrected amount column']);
        expect(curator.queryCount).toBe(1);
    });

    it('returns early without querying when there are no failures', async () => {
        const noFailures = new TestCurator({
            whatWorked: ['Everything worked'],
            whatFailed: [],
            suggestedImprovements: '',
        }, {} as Env);

        expect(await noFailures.extractNewBullets()).toEqual([]);
        expect(noFailures.queryCount).toBe(0);
    });
});
