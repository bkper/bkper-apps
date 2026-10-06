import { describe, expect, it } from 'bun:test';
import { ExtractorDescriptionParts } from '../../src/genai/ExtractorDescriptionParts.js';

describe('ExtractorDescriptionParts', () => {
    it('uses custom examples instead of the default examples when building the user prompt', () => {
        const extractor = new ExtractorDescriptionParts({} as Env);
        const description = 'WF HOME MTG DES:AUTO PAY ID:XXXXX37704 INDN:AMIN MOGHADDAS GHOLAMI CO ID:XXXXX87461 WEB';
        const customExamples = `${description} -> WF HOME MTG DES`;

        const prompt = extractor.getUserPrompt(description, customExamples);

        expect(prompt).toContain(customExamples);
        expect(prompt).toContain(description);
        expect(prompt).not.toContain(extractor.getDefaultUserPrompt());
    });

    it('uses the default examples when custom examples are absent', () => {
        const extractor = new ExtractorDescriptionParts({} as Env);
        const description = 'Diversified Asso DES:WEB PMTS ID:C1Y88G';

        const prompt = extractor.getUserPrompt(description);

        expect(prompt).toContain(extractor.getDefaultUserPrompt());
        expect(prompt).toContain(description);
    });
});
