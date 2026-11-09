/**
 * Isolated route-to-client fixture: real HTTP validation, authorization, KV service,
 * prompt resolution, calculation and generated client boundary. No live SDK or fetch.
 * The Book and its transactions are made up, and its balances queries answered by a fake
 * ledger; moving today from November to December makes last month read October then
 * November, without changing the saved text or decision's relative period.
 */
import assert from 'node:assert/strict';
import { BalancesReport, Book, User } from 'bkper-js';
import { createAppApi } from '../../client/src/api/app-api';
import { AppContext } from '../../server/src/app-context';
import { createApp } from '../../server/src/index';
import { createDecisionClient } from '../../server/src/services/decision-client';
import { snapshotKey } from '../../server/src/services/snapshot-loader';
import { fixtureLedger, ledgerSnapshot } from '../../server/test/fixtures/snapshot-book';
import { createTestEnv } from '../../server/test/test-env';

export const WORKFLOW_PROMPT = 'Expenses last month';
export const WORKFLOW_BOOKS = ['fixture-a', 'fixture-b'] as const;
type Role = NonNullable<bkper.Book['permission']>;

export async function savedWorkflow() {
    const ledger = fixtureLedger();
    let snapshot = await ledgerSnapshot(ledger);
    let today = '2026-11-05';
    const values = new Map<string, string>();
    const metadata = new Map<string, Record<string, unknown>>();
    let failWrite = false;
    const env = {
        ...createTestEnv(),
        KV: {
            get: async (key: string) => values.get(key) ?? null,
            put: async (
                key: string,
                value: string,
                options?: { metadata?: Record<string, unknown> }
            ) => {
                if (failWrite) throw new Error('Isolated storage unavailable');
                values.set(key, value);
                // Like KV, a put without metadata leaves the key with none.
                if (options?.metadata) metadata.set(key, options.metadata);
                else metadata.delete(key);
            },
            delete: async (key: string) => {
                if (failWrite) throw new Error('Isolated storage unavailable');
                values.delete(key);
                metadata.delete(key);
            },
            list: async (options?: { prefix?: string; cursor?: string }) => {
                const names = [...values.keys()]
                    .filter(key => key.startsWith(options?.prefix ?? ''))
                    .sort();
                // Tiny pages also exercise service pagination across independent items.
                const start = Number(options?.cursor ?? 0);
                const end = start + 1;
                return {
                    keys: names.slice(start, end).map(name => {
                        const stored = metadata.get(name);
                        return stored ? { name, metadata: stored } : { name };
                    }),
                    list_complete: end >= names.length,
                    cursor: end >= names.length ? undefined : String(end),
                };
            },
        },
    };
    const decisions: { session: string; state: { request: string; today: string } }[] = [];
    const requests: { session: string; book: string; body: unknown }[] = [];
    const authorizations: { session: string; book: string; permission: Role }[] = [];
    const sessions: { id: string; permission: Role }[] = [];

    function seed(session: (typeof sessions)[number]) {
        for (const id of WORKFLOW_BOOKS) {
            values.set(
                snapshotKey(session.id, id),
                JSON.stringify({
                    ...snapshot,
                    book: { ...snapshot.book, id, permission: session.permission },
                    today,
                    dataAt: `${today}T15:00:00.000Z`,
                })
            );
        }
    }

    function session(id: string, permission: Role) {
        assert(!sessions.some(item => item.id === id), 'Independent session identity');
        const identity = { id, permission };
        sessions.push(identity);
        seed(identity);
        const app = createApp(
            c =>
                new AppContext(
                    {
                        getConfig: () => ({}),
                        getUser: async () => new User({ id }),
                        getBook: async book => {
                            assert(
                                WORKFLOW_BOOKS.includes(book as (typeof WORKFLOW_BOOKS)[number])
                            );
                            authorizations.push({
                                session: id,
                                book,
                                permission: identity.permission,
                            });
                            return new Book({ id: book, permission: identity.permission });
                        },
                    },
                    c.env,
                    {
                        readBalances: async (book, query) =>
                            new BalancesReport(new Book({ id: book.id }), ledger.balances(query)),
                        decisions: createDecisionClient({
                            fetch: async (_url, init) => {
                                const body = JSON.parse(String(init?.body)) as {
                                    state: { request: string; today: string };
                                };
                                decisions.push({ session: id, state: body.state });
                                const choice = (value: string) => ({
                                    type: 'choice',
                                    choice: value,
                                    confidence: 0.99,
                                    probabilities: { [value]: 0.99 },
                                });
                                return Response.json({
                                    model: 'jev',
                                    answers: {
                                        root: choice('Expenses'),
                                        period: choice('last_month'),
                                        language: choice('en'),
                                        chart_named: choice('none'),
                                        over_time: { type: 'noul', noul: 0.01 },
                                        composition: { type: 'noul', noul: 0.01 },
                                        versus_earlier: { type: 'noul', noul: 0.01 },
                                        year_earlier: { type: 'noul', noul: 0.01 },
                                        bridge: { type: 'noul', noul: 0.01 },
                                    },
                                    usage: { input_tokens: 1, output_tokens: 1 },
                                });
                            },
                        }),
                    }
                )
        );
        const request = async (input: Request) => {
            const url = new URL(input.url);
            assert(url.pathname.startsWith('/api/v1/books/'), 'Only fixture Book API routes');
            if (url.pathname.endsWith('/report')) {
                requests.push({
                    session: id,
                    book: url.pathname.split('/')[4],
                    body: await input.clone().json(),
                });
            }
            return app.request(input, undefined, env);
        };
        return {
            identity,
            request,
            api: createAppApi({ baseUrl: 'http://fixture.invalid', fetch: request }),
        };
    }

    return {
        session,
        decisions,
        requests,
        authorizations,
        failWrites: (fail: boolean) => (failWrite = fail),
        advance: () => {
            // The map is the Book's structure, which a new day does not change.
            today = '2026-12-05';
            for (const identity of sessions) seed(identity);
        },
        /** Renames an account in the Book, so its map and balances know only the new name. */
        renameAccount: async (id: string, name: string) => {
            ledger.renameAccount(id, name);
            snapshot = await ledgerSnapshot(ledger);
            for (const identity of sessions) seed(identity);
        },
        savedValues: () =>
            [...values.entries()].filter(([key]) => key.startsWith('saved-prompts:v1:')),
    };
}
