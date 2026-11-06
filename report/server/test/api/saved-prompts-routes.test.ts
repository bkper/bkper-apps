import { BkperError, Book, User } from 'bkper-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../src/app-context';
import { createApp } from '../../src/index';
import { createTestEnv } from '../test-env';

const BASE = '/api/v1/books/book-a/reports';
const PROMPT = 'Despesas por mês este ano #viagens';

// Every Bkper call is injected. A mistaken SDK write/network call must fail locally.
beforeEach(() =>
    vi.stubGlobal(
        'fetch',
        vi.fn(() => {
            throw new Error('No live requests in saved-prompt tests');
        })
    )
);
afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
});

/** Isolated per-item storage. Small pages exercise the real pagination loop. */
function memoryStorage() {
    const values = new Map<string, string>();
    const kv = {
        get: vi.fn(async (key: string) => values.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
            values.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
            values.delete(key);
        }),
        list: vi.fn(async (options?: { prefix?: string; cursor?: string; limit?: number }) => {
            const keys = [...values.keys()]
                .filter(key => key.startsWith(options?.prefix ?? ''))
                .sort();
            const start = Number(options?.cursor ?? 0);
            const end = start + 2;
            return {
                keys: keys.slice(start, end).map(name => ({ name })),
                list_complete: end >= keys.length,
                cursor: end >= keys.length ? undefined : String(end),
            };
        }),
    };
    return { values, kv };
}

function harness(permission: string | undefined = 'OWNER', storage = memoryStorage()) {
    const state = { permission, failure: undefined as BkperError | undefined };
    const getBook = vi.fn(async (bookId: string) => {
        if (state.failure) throw state.failure;
        const book = new Book({ id: bookId });
        // Deliberately simulate malformed upstream payloads without claiming a new SDK role.
        Object.assign(book.payload, { permission: state.permission });
        return book;
    });
    const getUser = vi.fn(async () => new User({ id: 'unused' }));
    const env = { ...createTestEnv(), KV: storage.kv };
    const app = createApp(c => new AppContext({ getBook, getUser, getConfig: () => ({}) }, c.env));
    const request = (url = BASE, init: RequestInit = {}) => app.request(url, init, env);
    const save = (prompt = PROMPT, url = BASE) =>
        request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
        });
    return { ...storage, state, getBook, getUser, request, save };
}

async function saved(response: Response): Promise<{ id: string; prompt: string }> {
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['report']);
    expect(body.report).toEqual({
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        prompt: expect.any(String),
    });
    return body.report;
}

function expectNoStorage(kv: ReturnType<typeof memoryStorage>['kv']) {
    for (const method of Object.values(kv)) expect(method).not.toHaveBeenCalled();
}

describe('Book-shared saved prompt API', () => {
    it.each(['OWNER', 'EDITOR', 'POSTER', 'VIEWER', 'RECORDER'])(
        'lists for %s with truthful mutation capabilities',
        async permission => {
            const h = harness(permission);
            const response = await h.request();
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                reports: [],
                capabilities: {
                    list: true,
                    save: ['OWNER', 'EDITOR'].includes(permission),
                    remove: ['OWNER', 'EDITOR'].includes(permission),
                },
            });
            expect(h.getBook).toHaveBeenCalledExactlyOnceWith('book-a');
            expect(h.getUser).not.toHaveBeenCalled();
            expect(response.headers.get('Cache-Control')).toBe('no-store');
        }
    );

    it.each(['OWNER', 'EDITOR'])(
        'allows %s to save and remove shared prompts',
        async permission => {
            const storage = memoryStorage();
            const h = harness(permission, storage);
            const report = await saved(await h.save());
            expect(report.prompt).toBe(PROMPT);
            expect([...h.values.values()]).toEqual([JSON.stringify(PROMPT)]); // Only the original prompt, JSON-encoded.
            expect(h.kv.put.mock.calls[0]).toHaveLength(2); // Durable: no TTL or extra metadata.
            const collaborator = harness('RECORDER', storage);
            expect(await (await collaborator.request()).json()).toMatchObject({
                reports: [report],
            });
            const remover = harness('EDITOR', storage);
            const removed = await remover.request(`${BASE}/${report.id}`, { method: 'DELETE' });
            expect(removed.status).toBe(204);
            expect(await removed.text()).toBe('');
            expect(h.values.size).toBe(0);
            expect(
                (await remover.request(`${BASE}/${report.id}`, { method: 'DELETE' })).status
            ).toBe(204);
        }
    );

    it.each(['VIEWER', 'POSTER', 'RECORDER', 'NONE', 'FUTURE_ROLE', undefined])(
        'denies mutations for %s before accessing storage',
        async permission => {
            const h = harness();
            h.state.permission = permission;
            for (const response of [
                await h.save(),
                await h.request(`${BASE}/${'a'.repeat(64)}`, { method: 'DELETE' }),
            ]) {
                expect(response.status).toBe(403);
                expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
            }
            expectNoStorage(h.kv);
        }
    );

    it.each(['NONE', 'FUTURE_ROLE', undefined])('denies listing for %s', async permission => {
        const h = harness();
        h.state.permission = permission;
        const response = await h.request();
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
        expectNoStorage(h.kv);
    });

    it('rechecks authorization on every operation, even after a successful save or list', async () => {
        const h = harness();
        const report = await saved(await h.save());
        expect((await h.request()).status).toBe(200);
        vi.clearAllMocks();
        h.state.permission = 'NONE';
        expect((await h.request()).status).toBe(403);
        expect((await h.save()).status).toBe(403);
        expect((await h.request(`${BASE}/${report.id}`, { method: 'DELETE' })).status).toBe(403);
        expect(h.getBook).toHaveBeenCalledTimes(3);
        expectNoStorage(h.kv);
        expect(h.values.size).toBe(1);
    });

    it('makes identical saves idempotent, including across collaborators and retries', async () => {
        const storage = memoryStorage();
        const owner = harness('OWNER', storage);
        const editor = harness('EDITOR', storage);
        const results = await Promise.all([owner.save(), editor.save(), owner.save()]);
        const reports = await Promise.all(results.map(saved));
        expect(reports[0]).toEqual(reports[1]);
        expect(reports[1]).toEqual(reports[2]);
        expect(storage.values.size).toBe(1);
        expect(await (await editor.request()).json()).toMatchObject({ reports: [reports[0]] });
    });

    it('uses the current trimmed prompt rules but preserves case, internal whitespace and language', async () => {
        const h = harness();
        const prompt = '売上  の推移\n今年 #東京';
        const report = await saved(await h.save(`  ${prompt}  `));
        expect(report.prompt).toBe(prompt);
        expect(await saved(await h.save(prompt))).toEqual(report);
        expect((await h.save('x'.repeat(1000))).status).toBe(200);
        expect((await h.save('x'.repeat(1001))).status).toBe(400);
    });

    it('does not conflate case, internal whitespace or distinct UTF-16 text', async () => {
        const h = harness();
        const prompts = ['X', 'x', 'a  b', 'a b', '\uFFFD', '\uD800', '\uD801'];
        const reports = await Promise.all(prompts.map(async prompt => saved(await h.save(prompt))));
        expect(new Set(reports.map(report => report.id)).size).toBe(prompts.length);
        expect(await (await h.request()).json()).toMatchObject({
            reports: expect.arrayContaining(reports),
        });
    });

    it('isolates Books when the same prompt has the same id', async () => {
        const h = harness();
        const a = await saved(await h.save());
        const other = '/api/v1/books/book-b/reports';
        expect(await (await h.request(other)).json()).toMatchObject({ reports: [] });
        expect((await h.request(`${other}/${a.id}`, { method: 'DELETE' })).status).toBe(204);
        expect(h.values.size).toBe(1);
        const b = await saved(await h.save(PROMPT, other));
        expect(b).toEqual(a);
        expect(h.values.size).toBe(2);
        expect((await h.request(`${BASE}/${a.id}`, { method: 'DELETE' })).status).toBe(204);
        expect(await (await h.request(other)).json()).toMatchObject({ reports: [b] });
    });

    it('does not lose independent concurrent saves or resurrect independent removals', async () => {
        const storage = memoryStorage();
        const a = harness('OWNER', storage);
        const b = harness('EDITOR', storage);
        const old = await saved(await a.save('Remove this prompt'));
        const results = await Promise.all([
            a.save('Expenses this year'),
            b.save('Receitas este ano'),
            a.request(`${BASE}/${old.id}`, { method: 'DELETE' }),
        ]);
        const reports = await Promise.all(results.slice(0, 2).map(saved));
        expect(results[2].status).toBe(204);
        expect(storage.values.size).toBe(2);
        expect(await (await b.request()).json()).toMatchObject({
            reports: expect.arrayContaining(reports),
        });
        // Saves/removes never read or rewrite a shelf-wide list.
        expect(storage.kv.list).toHaveBeenCalledTimes(1);
        expect(storage.kv.get).toHaveBeenCalledTimes(2);
    });

    it('reads every KV page, including an empty non-final page, in stable id order', async () => {
        const h = harness();
        const reports = await Promise.all(
            ['a', 'b', 'c', 'd', 'e'].map(async text => saved(await h.save(text)))
        );
        const prefix = h.kv.put.mock.calls[0][0].slice(0, -64);
        h.kv.list.mockResolvedValueOnce({ keys: [], list_complete: false, cursor: '0' });
        expect(await (await h.request()).json()).toMatchObject({
            reports: reports.sort((a, b) => a.id.localeCompare(b.id)),
        });
        expect(h.kv.list).toHaveBeenCalledTimes(4);
        for (const [options] of h.kv.list.mock.calls) expect(options?.prefix).toBe(prefix);
    });

    it('omits an item deleted between KV listing and reading', async () => {
        const h = harness();
        await h.save();
        h.kv.get.mockResolvedValueOnce(null);
        expect(await (await h.request()).json()).toMatchObject({ reports: [] });
    });

    it.each([
        {},
        { prompt: '' },
        { prompt: ' \n\t' },
        { prompt: null },
        { prompt: 42 },
        { prompt: 'x'.repeat(1001) },
        { prompt: PROMPT, chart: 'pie' },
        { prompt: PROMPT, intent: {} },
        { prompt: PROMPT, language: 'pt' },
        { prompt: PROMPT, id: 'chosen-by-client' },
        { prompt: PROMPT, html: '<html>' },
    ])('rejects invalid or extra saved data: %j', async body => {
        const h = harness();
        const response = await h.request(BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
        expect(h.getBook).not.toHaveBeenCalled();
        expectNoStorage(h.kv);
    });

    it('rejects malformed JSON', async () => {
        const h = harness();
        const response = await h.request(BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{',
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
        expectNoStorage(h.kv);
    });

    it.each([
        'abc',
        'A'.repeat(64),
        '0'.repeat(63),
        '0'.repeat(65),
        `${'a'.repeat(64)}%0A`,
        '%2E%2E%3Asecret',
        'a%2Fb',
    ])('rejects invalid ids: %s', async id => {
        const h = harness();
        const response = await h.request(`${BASE}/${id}`, { method: 'DELETE' });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
        expect(h.getBook).not.toHaveBeenCalled();
        expectNoStorage(h.kv);
    });

    it.each([
        [401, 403, 'forbidden'],
        [403, 403, 'forbidden'],
        [404, 404, 'book_not_found'],
        [503, 502, 'upstream_error'],
    ] as const)('maps Bkper %s to %s without touching storage', async (upstream, status, code) => {
        const h = harness();
        h.state.failure = new BkperError(upstream, 'private upstream details');
        for (const response of [
            await h.request(),
            await h.save(),
            await h.request(`${BASE}/${'0'.repeat(64)}`, { method: 'DELETE' }),
        ]) {
            expect(response.status).toBe(status);
            expect(await response.json()).toMatchObject({ error: { code } });
        }
        expectNoStorage(h.kv);
    });

    it.each(['list', 'get', 'put', 'delete'] as const)(
        'maps KV %s failures without leaking data or claiming success',
        async operation => {
            const h = harness();
            const report = await saved(await h.save());
            h.kv[operation].mockRejectedValueOnce(new Error(`private storage details: ${PROMPT}`));
            const response =
                operation === 'put'
                    ? await h.save('Another prompt')
                    : operation === 'delete'
                      ? await h.request(`${BASE}/${report.id}`, { method: 'DELETE' })
                      : await h.request();
            expect(response.status).toBe(502);
            const body = await response.json();
            expect(body).toMatchObject({ error: { code: 'storage_error' } });
            expect(JSON.stringify(body)).not.toContain(PROMPT);
            expect(JSON.stringify(body)).not.toContain('private');
        }
    );

    it('fails closed on corrupt stored prompts and mismatched ids', async () => {
        const h = harness();
        await h.save();
        for (const invalid of ['', ' ', 'x'.repeat(1001), 'Different prompt under the old id']) {
            h.kv.get.mockResolvedValueOnce(JSON.stringify(invalid));
            const response = await h.request();
            expect(response.status).toBe(502);
            expect(await response.json()).toMatchObject({ error: { code: 'storage_error' } });
        }
    });

    it.each([undefined, 'repeated'])(
        'fails rather than silently truncating when pagination cannot advance: %s',
        async cursor => {
            const h = harness();
            h.kv.list.mockResolvedValue({ keys: [], list_complete: false, cursor });
            const response = await h.request();
            expect(response.status).toBe(502);
            expect(await response.json()).toMatchObject({ error: { code: 'storage_error' } });
            expect(h.kv.list.mock.calls.length).toBeLessThanOrEqual(2);
        }
    );

    it('rejects malformed stored JSON and keys outside the authorized Book prefix', async () => {
        const h = harness();
        await h.save();
        h.kv.get.mockResolvedValueOnce('{ not JSON');
        expect((await h.request()).status).toBe(502);
        h.kv.list.mockResolvedValueOnce({
            keys: [{ name: `saved-prompts:v1:another-book:${'a'.repeat(64)}` }],
            list_complete: true,
            cursor: undefined,
        });
        h.kv.get.mockClear();
        expect((await h.request()).status).toBe(502);
        expect(h.kv.get).not.toHaveBeenCalled();
    });
});
