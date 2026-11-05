import { describe, it, expect } from 'bun:test';
import { ExtractorDescriptionParts } from '../../src/genai/ExtractorDescriptionParts.js';
import { BkperAIResponsesClient } from '../../src/genai/BkperAIResponsesClient.js';

/**
 * Integration test for Bookbot's description-part extraction (account discovery key terms).
 *
 * These tests make real API calls through Bkper AI
 * with synthetic data to validate that:
 * - Prompts produce correct structured output
 * - Schema validation works end-to-end
 * - Models handle real-world input patterns
 * - The ACE pipeline (reflector + curator) generates useful output
 *
 * No Bkper API calls are made — only GenAI services with mock File objects
 * and plain text inputs.
 *
 * Run manually:   bun run test:integration
 * CI:             Runs on weekly schedule + manual trigger
 *
 * Requires BKPER_AI_BASE_URL and BKPER_AI_OAUTH_TOKEN in the environment.
 * Skips gracefully when Bkper AI credentials are not set.
 */

const BKPER_AI_BASE_URL = process.env.BKPER_AI_BASE_URL;
const BKPER_AI_OAUTH_TOKEN = process.env.BKPER_AI_OAUTH_TOKEN;

const env = { BKPER_AI_BASE_URL } as unknown as Env;

// Attribute live test usage to a test source instead of the production `bookbot` source.
const testSourceFetch: typeof fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('bkper-ai-source', 'bkper-agent-test');
    return fetch(input, { ...init, headers });
}, { preconnect: fetch.preconnect });

const bkperAIClient = BKPER_AI_BASE_URL && BKPER_AI_OAUTH_TOKEN
    ? new BkperAIResponsesClient({
        baseUrl: BKPER_AI_BASE_URL,
        oauthToken: BKPER_AI_OAUTH_TOKEN,
        fetch: testSourceFetch,
    })
    : undefined;

describe('GenAI Extraction (Integration)', () => {
    describe.skipIf(!bkperAIClient)('ExtractorDescriptionParts through Bkper AI', () => {
        it(
            'extracts stable searchable parts from a transaction description',
            async () => {
                const extractor = new ExtractorDescriptionParts(env, bkperAIClient);
                const result = await extractor.extract('Amazon AMAZON RETA* NJ1JM7QA0 #goodies');

                expect(result).toBeArray();
                expect(result.length).toBeGreaterThan(0);

                // Should contain something referencing AMAZON — the stable merchant identifier
                const joined = result.join(' ').toUpperCase();
                expect(joined).toContain('AMAZON');
            },
            { timeout: 30_000 }
        );
    });
});
