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

/** Isolated per-item storage with KV metadata. Small pages exercise the real pagination loop. */
function memoryStorage() {
    const values = new Map<string, string>();
    const metadata = new Map<string, Record<string, unknown>>();
    const kv = {
        get: vi.fn(async (key: string) => values.get(key) ?? null),
        put: vi.fn(
            async (
                key: string,
                value: string,
                options?: { metadata?: Record<string, unknown> }
            ) => {
                values.set(key, value);
                // Like KV, a put without metadata leaves the key with none.
                if (options?.metadata) metadata.set(key, options.metadata);
                else metadata.delete(key);
            }
        ),
        delete: vi.fn(async (key: string) => {
            values.delete(key);
            metadata.delete(key);
        }),
        list: vi.fn(async (options?: { prefix?: string; cursor?: string; limit?: number }) => {
            const keys = [...values.keys()]
                .filter(key => key.startsWith(options?.prefix ?? ''))
                .sort();
            const start = Number(options?.cursor ?? 0);
            const end = start + 2;
            return {
                keys: keys.slice(start, end).map(name => {
                    const stored = metadata.get(name);
                    return stored ? { name, metadata: stored } : { name };
                }),
                list_complete: end >= keys.length,
                cursor: end >= keys.length ? undefined : String(end),
            };
        }),
    };
    return { values, metadata, kv };
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
    const move = (id: string, before: string | null, url = BASE) =>
        request(`${url}/${id}/position`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ before }),
        });
    /** The shelf's order as GET lists it. */
    const order = async (url = BASE) =>
        ((await (await request(url)).json()) as { reports: { id: string; prompt: string }[] })
            .reports;
    return { ...storage, state, getBook, getUser, request, save, move, order };
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
                    move: ['OWNER', 'EDITOR'].includes(permission),
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
            // Durable: no TTL, and only its place on the shelf as metadata.
            expect(h.kv.put.mock.calls[0][2]).toEqual({ metadata: { position: 'a0' } });
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
                await h.move('a'.repeat(64), null),
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
        expect((await h.move(report.id, null)).status).toBe(403);
        expect(h.getBook).toHaveBeenCalledTimes(4);
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
        // Saves list keys for their place but never read prompts or rewrite other items.
        expect(storage.kv.get).toHaveBeenCalledTimes(2);
        expect(storage.kv.put).toHaveBeenCalledTimes(3);
    });

    it('reads every KV page, including an empty non-final page, in stable id order', async () => {
        const h = harness();
        const reports = await Promise.all(
            ['a', 'b', 'c', 'd', 'e'].map(async text => saved(await h.save(text)))
        );
        // Saved before ordering existed: no position.
        h.metadata.clear();
        const prefix = h.kv.put.mock.calls[0][0].slice(0, -64);
        h.kv.list.mockClear();
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
        for (const response of [
            await h.request(`${BASE}/${id}`, { method: 'DELETE' }),
            await h.move(id, null),
        ]) {
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
        }
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
            await h.move('0'.repeat(64), null),
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

describe('Saved prompt order', () => {
    /** Saves prompts one at a time, so each goes after the last. */
    async function shelf(h: ReturnType<typeof harness>, prompts: string[]) {
        const reports = [];
        for (const prompt of prompts) reports.push(await saved(await h.save(prompt)));
        return reports;
    }

    async function moved(response: Response) {
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        return (await response.json()) as {
            reports: { id: string; prompt: string }[];
            capabilities: Record<string, boolean>;
        };
    }

    const key = (id: string, book = 'book-a') => `saved-prompts:v1:${book}:${id}`;
    const writes = (h: ReturnType<typeof harness>) =>
        h.kv.put.mock.calls.map(([name, value, options]) => [name, value, options]);

    it('saves a new prompt after the last one, not in id order', async () => {
        const h = harness();
        const reports = await shelf(h, ['c', 'a', 'b', 'z', 'y']);
        expect(h.kv.get).not.toHaveBeenCalled(); // Saves read no prompts.
        expect(await h.order()).toEqual(reports);
        expect(h.kv.put.mock.calls.map(([, , options]) => options)).toEqual([
            { metadata: { position: 'a0' } },
            { metadata: { position: 'a1' } },
            { metadata: { position: 'a2' } },
            { metadata: { position: 'a3' } },
            { metadata: { position: 'a4' } },
        ]);
    });

    it('keeps the place of a prompt saved again, positioned or not', async () => {
        const h = harness();
        const [a, b] = await shelf(h, ['First', 'Second']);
        h.kv.put.mockClear();
        expect(await saved(await h.save(' First '))).toEqual(a);
        expect(writes(h)).toEqual([
            [key(a.id), JSON.stringify('First'), { metadata: { position: 'a0' } }],
        ]);
        expect(await h.order()).toEqual([a, b]);
        // Saved before ordering existed: saved again, it still has no position.
        h.metadata.delete(key(b.id));
        h.kv.put.mockClear();
        await saved(await h.save('Second'));
        expect(h.kv.put).toHaveBeenCalledExactlyOnceWith(key(b.id), JSON.stringify('Second'));
        expect(await h.order()).toEqual([b, a]);
        // A new prompt goes after the last positioned one.
        const [c] = await shelf(h, ['Third']);
        expect(h.metadata.get(key(c.id))).toEqual({ position: 'a1' });
        expect(await h.order()).toEqual([b, a, c]);
    });

    it('moves a prompt first, into the middle and to the end, writing only that prompt', async () => {
        const h = harness();
        const [a, b, c, d] = await shelf(h, ['a', 'b', 'c', 'd']);
        const cases = [
            { id: d.id, before: a.id, order: [d, a, b, c] },
            { id: a.id, before: c.id, order: [d, b, a, c] },
            { id: d.id, before: null, order: [b, a, c, d] },
            { id: c.id, before: b.id, order: [c, b, a, d] },
        ];
        for (const { id, before, order } of cases) {
            h.kv.put.mockClear();
            const body = await moved(await h.move(id, before));
            expect(body.reports).toEqual(order);
            expect(body.capabilities).toEqual({ list: true, save: true, remove: true, move: true });
            expect(h.kv.put).toHaveBeenCalledExactlyOnceWith(
                key(id),
                JSON.stringify(order.find(item => item.id === id)!.prompt),
                { metadata: { position: expect.any(String) } }
            );
            expect(await h.order()).toEqual(order);
        }
    });

    it('writes nothing when the prompt is already in place', async () => {
        const h = harness();
        const [a, b, c] = await shelf(h, ['a', 'b', 'c']);
        h.metadata.delete(key(a.id)); // A move in place never normalizes either.
        h.kv.put.mockClear();
        for (const [id, before] of [
            [b.id, b.id],
            [a.id, b.id],
            [b.id, c.id],
            [c.id, null],
        ] as const) {
            expect((await moved(await h.move(id, before))).reports).toEqual([a, b, c]);
        }
        expect(h.kv.put).not.toHaveBeenCalled();
        expect(h.kv.delete).not.toHaveBeenCalled();
    });

    it('gives prompts saved before ordering a position once, in their order, on the first move', async () => {
        const h = harness();
        const reports = await shelf(h, ['p', 'q', 'r', 's']);
        const [x] = await shelf(h, ['Positioned']);
        for (const report of reports) h.metadata.delete(key(report.id));
        h.metadata.set(key(x.id), { position: 'a0' });
        const legacy = [...reports].sort((a, b) => (a.id < b.id ? -1 : 1));
        expect(await h.order()).toEqual([...legacy, x]);
        h.kv.put.mockClear();
        const [first, second, third, fourth] = legacy;
        const body = await moved(await h.move(fourth.id, second.id));
        expect(body.reports).toEqual([first, fourth, second, third, x]);
        // The others before the first positioned one ('a0'), then the moved one between.
        expect(writes(h)).toEqual([
            [key(first.id), JSON.stringify(first.prompt), { metadata: { position: 'Zx' } }],
            [key(second.id), JSON.stringify(second.prompt), { metadata: { position: 'Zy' } }],
            [key(third.id), JSON.stringify(third.prompt), { metadata: { position: 'Zz' } }],
            [key(fourth.id), JSON.stringify(fourth.prompt), { metadata: { position: 'ZxV' } }],
        ]);
        expect(await h.order()).toEqual(body.reports);
        // Once: the next move writes only the moved prompt.
        h.kv.put.mockClear();
        await moved(await h.move(first.id, null));
        expect(h.kv.put).toHaveBeenCalledOnce();
        expect(await h.order()).toEqual([fourth, second, third, x, first]);
    });

    it('orders equal positions by id and moves a prompt between them', async () => {
        const h = harness();
        const [a, b, c] = await shelf(h, ['a', 'b', 'c']);
        // Concurrent moves can give two prompts the same position.
        h.metadata.set(key(b.id), { position: 'a0' });
        const [low, high] = a.id < b.id ? [a, b] : [b, a];
        expect(await h.order()).toEqual([low, high, c]);
        h.kv.put.mockClear();
        const body = await moved(await h.move(c.id, high.id));
        expect(body.reports).toEqual([low, c, high]);
        expect(await h.order()).toEqual([low, c, high]);
        expect(writes(h)).toEqual([
            [key(c.id), JSON.stringify('c'), { metadata: { position: 'a1' } }],
            [key(high.id), JSON.stringify(high.prompt), { metadata: { position: 'a2' } }],
        ]);
    });

    it('answers a prompt not on the shelf with 404 and an unknown place with 409, writing nothing', async () => {
        const h = harness();
        const [a] = await shelf(h, ['a', 'b']);
        h.kv.put.mockClear();
        const missing = 'f'.repeat(64);
        const notFound = await h.move(missing, a.id);
        expect(notFound.status).toBe(404);
        expect(await notFound.json()).toMatchObject({ error: { code: 'report_not_found' } });
        const changed = await h.move(a.id, missing);
        expect(changed.status).toBe(409);
        expect(await changed.json()).toMatchObject({ error: { code: 'shelf_changed' } });
        expect(changed.headers.get('Cache-Control')).toBe('no-store');
        expect(h.kv.put).not.toHaveBeenCalled();
    });

    it('never writes a prompt removed between listing and reading', async () => {
        const h = harness();
        const [a, b, c] = await shelf(h, ['a', 'b', 'c']);
        for (const report of [a, b, c]) h.metadata.delete(key(report.id));
        h.kv.put.mockClear();
        const removed = [a, b, c].sort((x, y) => (x.id < y.id ? -1 : 1))[0];
        h.kv.get.mockImplementation(async name =>
            name === key(removed.id) ? null : (h.values.get(name) ?? null)
        );
        const [stays, moving] = [a, b, c].filter(report => report !== removed);
        const body = await moved(await h.move(moving.id, stays.id));
        expect(body.reports).toEqual([moving, stays]);
        expect(h.kv.put.mock.calls.map(([name]) => name)).not.toContain(key(removed.id));
    });

    it.each(['OWNER', 'EDITOR'])('allows %s to move', async permission => {
        const storage = memoryStorage();
        const [a, b] = await shelf(harness('OWNER', storage), ['a', 'b']);
        const h = harness(permission, storage);
        expect((await moved(await h.move(b.id, a.id))).reports).toEqual([b, a]);
    });

    it.each([
        {},
        { before: undefined },
        { before: 'abc' },
        { before: 'A'.repeat(64) },
        { before: 42 },
        { before: null, position: 'a0' },
    ])('rejects invalid move bodies: %j', async body => {
        const h = harness();
        const response = await h.request(`${BASE}/${'a'.repeat(64)}/position`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
        expect(h.getBook).not.toHaveBeenCalled();
        expectNoStorage(h.kv);
    });

    it.each([
        {},
        { position: '' },
        { position: 42 },
        { position: 'a' },
        { position: 'a00' },
        { position: 'a0!' },
        { position: '0a' },
        { position: 'a0', more: true },
    ])('fails closed on an invalid stored position: %j', async metadata => {
        const h = harness();
        const [a, b] = await shelf(h, ['a', 'b']);
        h.metadata.set(key(a.id), metadata);
        h.kv.put.mockClear();
        for (const response of [await h.request(), await h.save('c'), await h.move(b.id, a.id)]) {
            expect(response.status).toBe(502);
            expect(await response.json()).toMatchObject({ error: { code: 'storage_error' } });
        }
        expect(h.kv.put).not.toHaveBeenCalled();
    });

    it.each(['list', 'get', 'put'] as const)('maps KV %s failures of a move', async operation => {
        const h = harness();
        const [a, b] = await shelf(h, ['a', 'b']);
        h.kv[operation].mockRejectedValueOnce(new Error('private storage details'));
        const response = await h.move(b.id, a.id);
        expect(response.status).toBe(502);
        const body = await response.json();
        expect(body).toMatchObject({ error: { code: 'storage_error' } });
        expect(JSON.stringify(body)).not.toContain('private');
    });

    it('isolates the order of each Book', async () => {
        const h = harness();
        const other = '/api/v1/books/book-b/reports';
        const [a, b] = await shelf(h, ['a', 'b']);
        await saved(await h.save('b', other));
        await saved(await h.save('a', other));
        expect((await moved(await h.move(b.id, a.id))).reports).toEqual([b, a]);
        expect(await h.order(other)).toEqual([b, a]);
        expect(await h.order()).toEqual([b, a]);
        expect((await h.move(a.id, b.id, other)).status).toBe(200);
        expect(await h.order(other)).toEqual([a, b]);
        expect(await h.order()).toEqual([b, a]);
    });
});
