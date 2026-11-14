import { describe, expect, it } from 'bun:test';
import { ExtractorDescriptionParts } from '../../src/genai/ExtractorDescriptionParts.js';

describe('ExtractorDescriptionParts', () => {
    it('builds the user prompt from the default examples', () => {
        const extractor = new ExtractorDescriptionParts({} as Env);
        const description = 'Diversified Asso DES:WEB PMTS ID:C1Y88G';

        const prompt = extractor.getUserPrompt(description);

        expect(prompt).toContain(extractor.getDefaultUserPrompt());
        expect(prompt).toContain(description);
    });
});
