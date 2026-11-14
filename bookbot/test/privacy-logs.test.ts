import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { BkperAIResponsesClient } from '../src/genai/BkperAIResponsesClient.js';
import { ExtractorAmount } from '../src/genai/ExtractorAmount.js';
import { ExtractorDate } from '../src/genai/ExtractorDate.js';

const SECRET = 'SECRET-7781';

// Captures everything the code writes to the console during a scenario.
let logged: string[] = [];
const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;

beforeEach(() => {
    logged = [];
    for (const method of methods) {
        spyOn(console, method).mockImplementation((...args: unknown[]) => {
            logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
        });
    }
});

afterEach(() => {
    for (const method of methods) spyOn(console, method).mockRestore();
});

function aiClient(response: () => Response): BkperAIResponsesClient {
    return new BkperAIResponsesClient({
        baseUrl: 'http://localhost:8792/v1',
        oauthToken: 'token',
        fetch: Object.assign(mock(async () => response()), { preconnect: fetch.preconnect }),
    });
}

function answer(text: string): () => Response {
    return () => Response.json({
        status: 'completed',
        output: [{ id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
    });
}

describe('Event-mode logs keep customer content out', () => {
    it('does not log the transaction description when reading an amount or a date', async () => {
        await new ExtractorAmount({} as Env, aiClient(answer('12.5'))).extract(`Payment ${SECRET} of 12,50`);
        await new ExtractorDate({} as Env, aiClient(answer('2026-11-01'))).extract(`Payment ${SECRET} on 01/11/2026`);

        expect(logged.join('\n')).not.toContain(SECRET);
    });

    it('does not log the transaction description when reading an amount or a date fails', async () => {
        const failure = () => Response.json({ error: { code: 'usage_limit_exceeded', message: 'Allowance exhausted.' } }, { status: 429 });
        expect(await new ExtractorAmount({} as Env, aiClient(failure)).extract(`Payment ${SECRET} of 12,50`)).toBeNull();
        expect(await new ExtractorDate({} as Env, aiClient(failure)).extract(`Payment ${SECRET} on 01/11/2026`)).toBeUndefined();

        expect(logged.length).toBeGreaterThan(0);
        expect(logged.join('\n')).not.toContain(SECRET);
    });
});
