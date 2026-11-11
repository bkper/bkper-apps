import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import type { Context } from 'hono';

import { createAppContext } from '../../src/events/event-handler.js';

afterEach(() => mock.restore());

it('ignores event credential headers and relies on Platform outbound authentication', async () => {
    const outbound: Request[] = [];
    spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        outbound.push(new Request(input, init));
        return Response.json({ error: { code: 'usage_limit_exceeded', message: 'Allowance exhausted.' } }, { status: 429 });
    }, { preconnect: globalThis.fetch.preconnect }));
    const headers: Record<string, string> = {
        'bkper-oauth-token': 'never-forward-this',
        'bkper-agent-id': 'untrusted-app',
    };
    const context = {
        env: { BKPER_AI_BASE_URL: 'https://ai.bkper.app/v1', BKPER_API_KEY: 'never-use-this' },
        req: {
            header: (name: string) => headers[name],
            raw: { signal: new AbortController().signal },
        },
    } as unknown as Context;

    const appContext = createAppContext(context);
    const config = appContext.bkper.getConfig();
    await appContext.createExtractorAmount().extract('Synthetic purchase 12.34').catch(() => undefined);

    expect(config.oauthTokenProvider).toBeUndefined();
    expect(config.apiKeyProvider).toBeUndefined();
    expect(config.agentIdProvider).toBeUndefined();
    expect(outbound.length).toBeGreaterThan(0);
    expect(outbound[0].headers.get('Authorization')).toBe('Bearer bkper-platform-outbound');
    expect(outbound[0].headers.get('bkper-agent-id')).not.toBe('untrusted-app');
});

it('calls Bkper AI on the Platform, where no BKPER_AI_BASE_URL variable is configured', async () => {
    const outbound: Request[] = [];
    spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        outbound.push(new Request(input, init));
        return Response.json({ error: { code: 'usage_limit_exceeded', message: 'Allowance exhausted.' } }, { status: 429 });
    }, { preconnect: globalThis.fetch.preconnect }));
    const context = {
        env: {},
        req: { header: () => undefined, raw: { signal: new AbortController().signal } },
    } as unknown as Context;

    await createAppContext(context).createExtractorAmount().extract('Synthetic purchase 12.34').catch(() => undefined);

    expect(outbound.length).toBeGreaterThan(0);
    expect(new URL(outbound[0].url).origin).toBe('https://ai.bkper.app');
    expect(new URL(outbound[0].url).pathname.startsWith('/v1/')).toBe(true);
});
