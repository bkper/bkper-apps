import { describe, expect, it } from 'bun:test';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type {
    AppApi,
    LearnResponse,
    MergeResponse,
    ScanRequest,
    ScanResponse,
    Suggestion,
} from '../src/api/app-api';
import { AppController } from '../src/app/app-controller';
import type { AppUrlChangeHandler, AppUrlSync } from '../src/app/app-url-sync';
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

function suggestion(id: string): Suggestion {
    const transaction = (suffix: string) => ({
        id: `${id}-${suffix}`,
        date: '2026-06-10',
        amount: '10',
        description: `${id} ${suffix}`,
        fromAccount: { id: 'bank', name: 'Bank' },
        toAccount: { id: 'expense', name: 'Expense' },
        properties: {},
        draft: false,
    });
    return {
        id,
        strength: 'Strong',
        explanation: 'Likely duplicate',
        first: transaction('first'),
        second: transaction('second'),
    };
}

function scanResponse(id: string): ScanResponse {
    const match = suggestion(id);
    return {
        permission: 'OWNER',
        suggestions: [match],
        fingerprints: [match.first, match.second],
        scanned: 2,
        candidateCount: 2,
        skipped: { total: 0, checked: 0, trashed: 0, locked: 0 },
        promptVersion: 'merge-duplicates-v3',
    };
}

function setup(api: AppApi) {
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
        logger: { debug: () => undefined, error: () => undefined },
    });

    controller.hostConnected();
    return { controller, urlSync, login: () => authCallbacks.onLoginSuccess?.() };
}

function apiWithScan(scan: (request: ScanRequest) => Promise<ScanResponse>): AppApi {
    return {
        scan,
        merge: async (): Promise<MergeResponse> => ({ mergedTransactionId: 'merged' }),
        learn: async (): Promise<LearnResponse> => ({
            saved: true,
            skipped: false,
            resourceType: 'book',
        }),
    };
}

describe('AppController host context synchronization', () => {
    it('automatically replaces an untouched review with the latest host scope', async () => {
        const scans: ScanRequest[] = [];
        const { controller, urlSync, login } = setup(
            apiWithScan(async request => {
                scans.push(request);
                return scanResponse(request.query);
            })
        );
        await login();

        await urlSync.emit('https://merge-duplicates.bkper.app?bookId=book&query=account%3ANew');

        expect(scans.map(request => request.query)).toEqual(['account:Old', 'account:New']);
        expect(urlSync.replacements).toHaveLength(1);
        expect(controller.state.context.query).toBe('account:New');
        expect(controller.review.suggestions[0]?.id).toBe('account:New');
    });

    it('preserves edited decisions until the user accepts the pending host scope', async () => {
        const scans: ScanRequest[] = [];
        const { controller, urlSync, login } = setup(
            apiWithScan(async request => {
                scans.push(request);
                return scanResponse(request.query);
            })
        );
        await login();
        controller.setSuggestionSelected('account:Old', false);

        await urlSync.emit('https://merge-duplicates.bkper.app?bookId=book&query=account%3ANew');

        expect(controller.state.contextUpdateAvailable).toBe(true);
        expect(controller.state.context.query).toBe('account:Old');
        expect(controller.review.rejected).toHaveLength(1);
        expect(scans).toHaveLength(1);
        expect(urlSync.replacements).toHaveLength(0);

        await controller.updateResults();

        expect(controller.state.contextUpdateAvailable).toBe(false);
        expect(controller.state.context.query).toBe('account:New');
        expect(controller.review.rejected).toHaveLength(0);
        expect(scans).toHaveLength(2);
        expect(urlSync.replacements).toHaveLength(1);
    });

    it('discards a stale scan when the host scope changes during analysis', async () => {
        const oldScan = new Deferred<ScanResponse>();
        const scans: ScanRequest[] = [];
        const { controller, urlSync, login } = setup(
            apiWithScan(request => {
                scans.push(request);
                return request.query === 'account:Old'
                    ? oldScan.promise
                    : Promise.resolve(scanResponse(request.query));
            })
        );

        const initialScan = login();
        await Promise.resolve();
        await urlSync.emit('https://merge-duplicates.bkper.app?bookId=book&query=account%3ANew');
        oldScan.resolve(scanResponse('stale'));
        await initialScan;

        expect(scans.map(request => request.query)).toEqual(['account:Old', 'account:New']);
        expect(controller.state.context.query).toBe('account:New');
        expect(controller.review.suggestions[0]?.id).toBe('account:New');
        expect(controller.state.pages).toBe(1);
    });

    it('keeps completed merge results visible until the pending scope is accepted', async () => {
        const merge = new Deferred<MergeResponse>();
        const api = apiWithScan(async request => scanResponse(request.query));
        api.merge = async () => merge.promise;
        const { controller, urlSync, login } = setup(api);
        await login();

        const applying = controller.confirmApply();
        await Promise.resolve();
        await urlSync.emit('https://merge-duplicates.bkper.app?bookId=book&query=account%3ANew');
        merge.resolve({ mergedTransactionId: 'merged' });
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
});
