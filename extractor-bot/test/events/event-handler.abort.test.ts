import { afterEach, describe, expect, it } from 'bun:test';
import type { Context } from 'hono';

import { createAppContext } from '../../src/events/event-handler.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('event handler request cancellation', () => {
    it('propagates the incoming request signal to routed Bkper AI inference', async () => {
        const controller = new AbortController();
        let outboundSignal: AbortSignal | null | undefined;
        globalThis.fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init);
            outboundSignal = request.signal;
            return Promise.resolve(Response.json({
                status: 'completed',
                output: [{
                    id: 'msg_1',
                    type: 'message',
                    role: 'assistant',
                    content: [{
                        type: 'output_text',
                        text: '{"answer":"ok"}',
                        annotations: [],
                    }],
                }],
            }));
        }, { preconnect: originalFetch.preconnect });
        const headers: Record<string, string> = {
            'bkper-oauth-token': 'oauth-token',
            'bkper-agent-id': 'bookbot',
        };
        const context = {
            env: { BKPER_AI_BASE_URL: 'https://ai-dev.bkper.app/v1' },
            req: {
                header: (name: string) => headers[name],
                raw: { signal: controller.signal },
            },
        } as unknown as Context;

        const appContext = createAppContext(context);
        await appContext.bkperAIResponsesClient.generate({
            operation: 'transaction_extraction',
            model: 'gemini-flash',
            systemPrompt: 'Extract.',
            contents: [{ text: 'invoice' }],
            responseFormat: {
                name: 'answer',
                schema: {
                    type: 'object',
                    properties: { answer: { type: 'string' } },
                    required: ['answer'],
                    additionalProperties: false,
                },
                strict: true,
            },
            reasoningEffort: 'high',
        });

        expect(outboundSignal).toBe(controller.signal);
    });
});
