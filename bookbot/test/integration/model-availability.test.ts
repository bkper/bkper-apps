import { describe, expect, it } from 'bun:test';
import { GEMINI_MODEL_FLASH, GEMINI_MODEL_FLASH_LITE } from '../../src/constants.js';

/**
 * Verifies that every language model selected by Bkper Agent is published by
 * the configured Bkper AI model catalog with the capabilities the agent uses.
 */

const BKPER_AI_BASE_URL = process.env.BKPER_AI_BASE_URL?.replace(/\/$/u, '');
const GENERATION_MODELS = [GEMINI_MODEL_FLASH, GEMINI_MODEL_FLASH_LITE];

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

describe.skipIf(!BKPER_AI_BASE_URL)('Bkper AI model availability (Integration)', () => {
    it('publishes every configured language model with strict structured output', async () => {
        const response = await fetch(`${BKPER_AI_BASE_URL}/models`);
        expect(response.ok).toBe(true);

        const payload: unknown = await response.json();
        expect(isRecord(payload) && Array.isArray(payload.data)).toBe(true);
        if (!isRecord(payload) || !Array.isArray(payload.data)) return;

        for (const modelId of GENERATION_MODELS) {
            const model = payload.data.find(value => isRecord(value) && value.id === modelId);
            expect(model).toBeDefined();
            expect(isRecord(model) && model.type).toBe('language');
            expect(isRecord(model) && isRecord(model.structured_output) && model.structured_output.strict).toBe(true);
        }
    });
});
