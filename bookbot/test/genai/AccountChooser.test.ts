import { describe, expect, it, mock } from 'bun:test';

import { AccountChooser } from '../../src/genai/AccountChooser.js';
import { BkperAIClientError } from '../../src/genai/BkperAIClientError.js';
import { ACCOUNT_CHOICE_QUESTION, type AccountChoiceRequest } from '../../src/services/AccountChoice.js';

const REQUEST: AccountChoiceRequest = {
    state: { draft: { description: 'DEPOSIT', amount: 5000 }, history: {} },
    questions: {
        [ACCOUNT_CHOICE_QUESTION]: {
            type: 'choice',
            instructions: 'Which option?',
            criteria: { 'From: Owner Contribution': 'From Owner Contribution', 'From: Client Receivable': 'From Client Receivable' },
        },
    },
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return Response.json(body, { status, headers });
}

const ANSWER = {
    model: 'jev-1.13.0',
    answers: { [ACCOUNT_CHOICE_QUESTION]: { type: 'choice', choice: 'From: Owner Contribution', confidence: 0.93, probabilities: {} } },
    usage: { input_tokens: 100, output_tokens: 1 },
};

describe('AccountChooser', () => {
    it('asks Jev at Bkper AI\'s System One endpoint through Platform outbound, and returns the choice', async () => {
        const fetch = mock(async (_input: string, _init?: RequestInit) => json(200, ANSWER));
        const chooser = new AccountChooser({ baseUrl: 'https://ai.bkper.app/v1', fetch });

        expect(await chooser.choose(REQUEST)).toEqual({ choice: 'From: Owner Contribution', confidence: 0.93 });

        const [url, init] = fetch.mock.calls[0];
        const headers = new Headers(init?.headers);
        expect(url).toBe('https://ai.bkper.app/v1/systemone');
        // The placeholder is replaced by Platform outbound; Bookbot never sends a user token.
        expect(headers.get('authorization')).toBe('Bearer bkper-platform-outbound');
        expect(headers.get('bkper-ai-source')).toBe('bookbot');
        expect(headers.get('content-encoding')).toBeNull();
        expect(JSON.parse(String(init?.body))).toEqual({ model: 'jev', ...REQUEST });
    });

    it('reports Bkper AI errors by their code, such as an exhausted allowance', async () => {
        const fetch = mock(async () => json(429, { error: { code: 'usage_limit_exceeded', message: 'Allowance exhausted.' } }, { 'retry-after-ms': '0' }));
        const chooser = new AccountChooser({ fetch });

        const error = await chooser.choose(REQUEST).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BkperAIClientError);
        expect(error).toMatchObject({ status: 429, code: 'usage_limit_exceeded' });
    });

    it('reports an unreachable Bkper AI as a connection error', async () => {
        const fetch = mock(async () => { throw new TypeError('fetch failed'); });
        const chooser = new AccountChooser({ fetch });

        const error = await chooser.choose(REQUEST).catch((caught: unknown) => caught);

        expect(error).toMatchObject({ status: 502, code: 'connection_error' });
    }, 20_000);
});
