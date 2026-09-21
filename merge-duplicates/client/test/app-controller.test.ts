import { describe, expect, it } from 'bun:test';
import {
    Permission,
    type Account,
    type Book,
    type Transaction,
    type TransactionList,
} from 'bkper-js';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type {
    AnalyzeRequest,
    AnalyzeResponse,
    AppApi,
    LearnResponse,
    MergeResponse,
    Suggestion,
} from '../src/api/app-api';
import { AppController } from '../src/app/app-controller';
import type { AppUrlChangeHandler, AppUrlSync } from '../src/app/app-url-sync';
import { suggestionKey } from '../src/app/review-session';
import type { AuthSessionCallbacks } from '../src/auth/auth-session';

class TestHost implements ReactiveControllerHost {
    readonly updateComplete = Promise.resolve(true);
    updates = 0;

    addController(_controller: ReactiveController): void {}
    removeController(_controller: ReactiveController): void {}
    requestUpdate(): void {
        this.updates += 1;
    }
}

class TestUrlSync implements AppUrlSync {
    private handler?: AppUrlChangeHandler;
    readonly replacements: string[] = [];

    start(handler: AppUrlChangeHandler): void {
        this.handler = handler;
    }
    stop(): void {
        this.handler = undefined;
    }
    replace(url: URL): void {
        this.replacements.push(url.toString());
    }
    async emit(url: string): Promise<void> {
        await this.handler?.(new URL(url));
    }
}

class Deferred<T> {
    readonly promise: Promise<T>;
    private resolvePromise!: (value: T) => void;

    constructor() {
        this.promise = new Promise(resolve => {
            this.resolvePromise = resolve;
        });
    }
    resolve(value: T): void {
        this.resolvePromise(value);
    }
}

function payload(id: string, description = id): bkper.Transaction {
    return {
        id,
        date: '2026-06-10',
        amount: '10',
        description,
        posted: true,
        creditAccount: { id: 'bank', name: 'Bank' },
        debitAccount: { id: 'expense', name: 'Expense' },
        properties: {},
    };
}

function suggestion(firstId: string, secondId: string): Suggestion {
    return {
        strength: 'Strong',
        explanation: 'Likely duplicate',
        transactions: [payload(firstId), payload(secondId)],
    };
}

function analysis(suggestions: Suggestion[], skipped = 0): AnalyzeResponse {
    return {
        suggestions,
        skipped: { total: skipped, checked: skipped, trashed: 0, locked: 0, invalid: 0 },
    };
}

function page(
    items: bkper.Transaction[],
    accounts: Record<string, bkper.Account> = {}
): TransactionList {
    const resolveAccount = (reference: bkper.Account | undefined): Account | undefined => {
        const resolved = reference?.id ? (accounts[reference.id] ?? reference) : undefined;
        return resolved ? ({ json: () => resolved } as Account) : undefined;
    };
    return {
        getItems: () =>
            items.map(
                item =>
                    ({
                        json: () => item,
                        getCreditAccount: async () => resolveAccount(item.creditAccount),
                        getDebitAccount: async () => resolveAccount(item.debitAccount),
                    }) as Transaction
            ),
    } as unknown as TransactionList;
}

function setup(
    api: AppApi,
    getBook: (bookId: string) => Promise<Book>,
    options: {
        logger?: Pick<Console, 'debug' | 'error'>;
        now?: () => number;
    } = {}
) {
    const host = new TestHost();
    const urlSync = new TestUrlSync();
    let authCallbacks: AuthSessionCallbacks = {};
    const controller = new AppController(host, {
        getSearch: () => '?bookId=book&query=account%3AOld',
        createUrlSync: () => urlSync,
        createAuthSession: callbacks => {
            authCallbacks = callbacks;
            return {
                authenticatedFetch: async () => new Response(),
                getAccessToken: () => 'token',
                init: async () => undefined,
                login: () => undefined,
                refresh: async () => undefined,
            };
        },
        createApi: () => api,
        createBookService: () => ({ getBook }),
        logger: options.logger ?? { debug: () => undefined, error: () => undefined },
        now: options.now,
    });

    controller.hostConnected();
    return { controller, urlSync, login: () => authCallbacks.onLoginSuccess?.() };
}

function apiWithAnalyze(analyze: (request: AnalyzeRequest) => Promise<AnalyzeResponse>): AppApi {
    return {
        analyze,
        merge: async (): Promise<MergeResponse> => payload('merged'),
        learn: async (): Promise<LearnResponse> => ({ book: { id: 'book' } }),
    };
}

describe('AppController single-page analysis and host synchronization', () => {
    it('lists and submits at most two hundred transactions once for the active scope', async () => {
        const analyzeRequests: AnalyzeRequest[] = [];
        const listCalls: Array<[string | undefined, number | undefined]> = [];
        const book = {
            getPermission: () => Permission.OWNER,
            listTransactions: async (query?: string, limit?: number) => {
                listCalls.push([query, limit]);
                return page([payload('a'), payload('b')]);
            },
        } as unknown as Book;
        const { controller, login } = setup(
            apiWithAnalyze(async request => {
                analyzeRequests.push(request);
                return analysis([suggestion('a', 'b')], 1);
            }),
            async () => book
        );

        await login();

        expect(listCalls).toEqual([['account:Old', 200]]);
        expect(analyzeRequests.map(request => request.transactions.map(item => item.id))).toEqual([
            ['a', 'b'],
        ]);
        expect(controller.review.suggestions.map(suggestionKey)).toEqual(['a|b']);
        expect(controller.state.scanned).toBe(2);
        expect(controller.state.analyzed).toBe(true);
        expect(controller.state.skipped.total).toBe(1);
    });

    it('does not inspect pagination cursors after analyzing the first two hundred transactions', async () => {
        const listedPage = page([payload('first'), payload('second')]);
        const book = {
            getPermission: () => Permission.OWNER,
            listTransactions: async () =>
                ({
                    getItems: () => listedPage.getItems(),
                    getCursor: () => {
                        throw new Error('Pagination cursor should not be read.');
                    },
                }) as unknown as TransactionList,
        } as unknown as Book;
        const { controller, login } = setup(
            apiWithAnalyze(async () => analysis([])),
            async () => book
        );

        await login();

        expect(controller.state.error).toBeNull();
        expect(controller.state.analyzed).toBe(true);
    });

    it('hydrates Account names and types before submitting listed transactions for analysis', async () => {
        const analyzeRequests: AnalyzeRequest[] = [];
        const listed = payload('listed');
        listed.creditAccount = { id: 'bank' };
        listed.debitAccount = { id: 'expense' };
        const book = {
            getPermission: () => Permission.OWNER,
            listTransactions: async () =>
                page([listed], {
                    bank: { id: 'bank', name: 'Bank', type: 'ASSET' },
                    expense: { id: 'expense', name: 'Expense', type: 'OUTGOING' },
                }),
        } as unknown as Book;
        const { login } = setup(
            apiWithAnalyze(async request => {
                analyzeRequests.push(request);
                return analysis([]);
            }),
            async () => book
        );

        await login();

        expect(analyzeRequests[0]?.transactions[0]?.creditAccount).toEqual({
            id: 'bank',
            name: 'Bank',
            type: 'ASSET',
        });
        expect(analyzeRequests[0]?.transactions[0]?.debitAccount).toEqual({
            id: 'expense',
            name: 'Expense',
            type: 'OUTGOING',
        });
    });

    it('logs browser Book loading, listing, and API analysis durations', async () => {
        const logs: unknown[][] = [];
        const timestamps = [0, 5, 15, 45];
        const book = {
            getPermission: () => Permission.OWNER,
            listTransactions: async () => page([payload('first'), payload('second')]),
        } as unknown as Book;
        const { login } = setup(
            apiWithAnalyze(async () => analysis([])),
            async () => book,
            {
                logger: {
                    debug: (...values: unknown[]) => logs.push(values),
                    error: () => undefined,
                },
                now: () => timestamps.shift() ?? 45,
            }
        );

        await login();

        expect(logs.at(-1)).toEqual([
            '[merge-duplicates:performance]',
            'analysis completed',
            {
                scanned: 2,
                submittedTransactions: 2,
                suggestions: 0,
                bookMs: 5,
                listingMs: 10,
                apiMs: 30,
                totalMs: 45,
            },
        ]);
    });

    it('rejects Viewers before listing transactions or calling analyze', async () => {
        let listed = false;
        let analyzed = false;
        const book = {
            getPermission: () => Permission.VIEWER,
            listTransactions: async () => {
                listed = true;
                return page([]);
            },
        } as unknown as Book;
        const { controller, login } = setup(
            apiWithAnalyze(async () => {
                analyzed = true;
                return analysis([]);
            }),
            async () => book
        );

        await login();

        expect(listed).toBe(false);
        expect(analyzed).toBe(false);
        expect(controller.state.error).toContain('Owner, Editor, or Post');
    });

    it('automatically replaces an untouched review with the latest host scope', async () => {
        const queries: string[] = [];
        let latestQuery = '';
        const book = {
            getPermission: () => Permission.OWNER,
            listTransactions: async (query = '') => {
                latestQuery = query;
                queries.push(query);
                return page([payload(`${query}-a`), payload(`${query}-b`)]);
            },
        } as unknown as Book;
        const { controller, urlSync, login } = setup(
            apiWithAnalyze(async () =>
                analysis([suggestion(`${latestQuery}-a`, `${latestQuery}-b`)])
            ),
            async () => book
        );
        await login();

        await urlSync.emit('https://merge-duplicates.bkper.app?bookId=book&query=account%3ANew');

        expect(queries).toEqual(['account:Old', 'account:New']);
        expect(urlSync.replacements).toHaveLength(1);
        expect(controller.state.context.query).toBe('account:New');
        expect(controller.review.suggestions.map(suggestionKey)).toEqual([
            'account:New-a|account:New-b',
        ]);
    });

    it('preserves edited decisions until the user accepts the pending host scope', async () => {
        let latestQuery = '';
        const book = {
            getPermission: () => Permission.OWNER,
            listTransactions: async (query = '') => {
                latestQuery = query;
                return page([payload(`${query}-a`), payload(`${query}-b`)]);
            },
        } as unknown as Book;
        const { controller, urlSync, login } = setup(
            apiWithAnalyze(async () =>
                analysis([suggestion(`${latestQuery}-a`, `${latestQuery}-b`)])
            ),
            async () => book
        );
        await login();
        controller.setAllSuggestionsSelected(false);

        await urlSync.emit('https://merge-duplicates.bkper.app?bookId=book&query=account%3ANew');

        expect(controller.state.contextUpdateAvailable).toBe(true);
        expect(controller.state.context.query).toBe('account:Old');
        expect(controller.review.rejected).toHaveLength(1);

        await controller.updateResults();

        expect(controller.state.context.query).toBe('account:New');
        expect(controller.review.rejected).toHaveLength(0);
        expect(urlSync.replacements).toHaveLength(1);
    });

    it('keeps completed merge results visible until a pending host scope is accepted', async () => {
        let latestQuery = '';
        const merge = new Deferred<MergeResponse>();
        const book = {
            getPermission: () => Permission.OWNER,
            listTransactions: async (query = '') => {
                latestQuery = query;
                return page([payload(`${query}-a`), payload(`${query}-b`)]);
            },
        } as unknown as Book;
        const api = apiWithAnalyze(async () =>
            analysis([suggestion(`${latestQuery}-a`, `${latestQuery}-b`)])
        );
        api.merge = async () => merge.promise;
        const { controller, urlSync, login } = setup(api, async () => book);
        await login();

        const applying = controller.confirmApply();
        await Promise.resolve();
        await urlSync.emit('https://merge-duplicates.bkper.app?bookId=book&query=account%3ANew');
        merge.resolve(payload('merged'));
        await applying;

        expect(controller.review.processed).toBe(true);
        expect(controller.state.context.query).toBe('account:Old');
        expect(controller.state.contextUpdateAvailable).toBe(true);
        expect(urlSync.replacements).toHaveLength(0);

        await controller.scanAgain();

        expect(controller.state.context.query).toBe('account:New');
        expect(controller.review.processed).toBe(false);
        expect(controller.state.contextUpdateAvailable).toBe(false);
    });

    it('discards a stale listed page when host scope changes during loading', async () => {
        const oldPage = new Deferred<TransactionList>();
        const queries: string[] = [];
        const book = {
            getPermission: () => Permission.OWNER,
            listTransactions: async (query = '') => {
                queries.push(query);
                return query === 'account:Old'
                    ? oldPage.promise
                    : page([payload('new-a'), payload('new-b')]);
            },
        } as unknown as Book;
        const api = apiWithAnalyze(async request =>
            analysis([
                suggestion(request.transactions[0]?.id ?? '', request.transactions[1]?.id ?? ''),
            ])
        );
        const { controller, urlSync, login } = setup(api, async () => book);

        const initial = login();
        while (queries.length === 0) await Promise.resolve();
        await urlSync.emit('https://merge-duplicates.bkper.app?bookId=book&query=account%3ANew');
        oldPage.resolve(page([payload('old-a'), payload('old-b')]));
        await initial;

        expect(queries).toEqual(['account:Old', 'account:New']);
        expect(controller.state.context.query).toBe('account:New');
        expect(controller.review.suggestions.map(suggestionKey)).toEqual(['new-a|new-b']);
        expect(controller.state.analyzed).toBe(true);
    });
});
