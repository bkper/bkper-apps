import { describe, it, expect } from 'bun:test';
import { ExtractorStatementCSV } from '../../../../src/genai/statement/csv/ExtractorStatementCSV.js';
import { File } from 'bkper-js';

describe('ExtractorStatementCSV.getDefaultUserPrompt', () => {
    it('instructs the model to preserve the source amount sign verbatim', () => {
        const extractor = new ExtractorStatementCSV({} as unknown as File, {} as Env);
        const prompt = extractor.getDefaultUserPrompt();

        // The exact wording matters: without this, Gemini flips signs based on
        // account-type interpretation (e.g. credit-card charges become negative),
        // which inverts the side that setAccountBasedOnAmount picks.
        expect(prompt).toMatch(/Preserve the amount sign EXACTLY/);
        expect(prompt).toMatch(/Do NOT flip or infer the sign/);
    });
});
