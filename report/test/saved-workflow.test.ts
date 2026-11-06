import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportText } from 'report-shared/report-state';
import { savedWorkflow, WORKFLOW_PROMPT } from '../scripts/fixtures/saved-workflow';
import type { AuthSessionCallbacks } from '../client/src/auth/auth-session';
import { createAppApi, type ReportResponse } from '../client/src/api/app-api';
import { AppState } from '../client/src/state/app-state';
import type { RoutePage } from '../client/src/state/route';

// Only in-process Hono requests and injected decision responses are allowed.
beforeEach(() =>
    vi.stubGlobal(
        'fetch',
        vi.fn(() => {
            throw new Error('No live network');
        })
    )
);
afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
});

type Workflow = Awaited<ReturnType<typeof savedWorkflow>>;
type Session = ReturnType<Workflow['session']>;

async function client(session: Session, href = 'http://localhost:5207/?book=fixture-a') {
    const page: RoutePage = {
        location: { href },
        history: {
            state: null,
            pushState: (_data, _unused, url) => void (page.location.href = String(url)),
            replaceState: (_data, _unused, url) => void (page.location.href = String(url)),
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    };
    let callbacks: AuthSessionCallbacks = {};
    const state = new AppState({
        page,
        host: Object.assign(new EventTarget(), {
            parent: { postMessage: () => undefined },
            location: { origin: 'http://localhost:5207' },
        }),
        embedded: false,
        language: 'en',
        createAuthSession: value => {
            callbacks = value;
            return {
                authenticatedFetch: session.request,
                getAccessToken: () => 'fixture-only',
                init: async () => undefined,
                refresh: async () => undefined,
                login: () => undefined,
            };
        },
        createBookService: () => ({
            listBooksDirect: async () => [],
            getBook: async id => ({ id, name: id }),
        }),
        createReportApi: () => session.api,
        createSavedReportsApi: () => session.api,
        loadRenderer: async () => undefined,
        loadStrings: async () => undefined,
    });
    state.connect();
    await callbacks.onLoginSuccess?.();
    await settled(state);
    return { state, page };
}

async function settled(state: AppState) {
    await vi.waitFor(() => {
        expect(state.savedReports.loading).toBe(false);
        expect(state.savedReports.capabilities).toBeDefined();
        expect(state.reports.suggestions).toBeDefined();
        expect(state.reports.pending).toBe(false);
    });
}

async function click(state: AppState, id: string) {
    const previous = state.reports.report;
    state.openSavedReport(id);
    await vi.waitFor(() => {
        expect(state.reports.pending).toBe(false);
        expect(state.reports.report).toBeDefined();
        expect(state.reports.report).not.toBe(previous);
    });
    return state.reports.report!;
}

function answer(report: ReportResponse) {
    const element = Object.values(report.spec.elements).find(item => item.type === 'Answer');
    if (!element || element.type !== 'Answer') throw new Error('Missing answer');
    return element.props;
}

describe('saved-prompt route/service and independent app clients', () => {
    it('shares only original text, reopens it freshly on every click and rolls last month forward', async () => {
        const fixture = await savedWorkflow();
        const owner = fixture.session('owner', 'OWNER');
        const editor = fixture.session('editor', 'EDITOR');
        const a = await client(owner);
        const b = await client(editor);
        a.state.reports.input(WORKFLOW_PROMPT);
        a.state.reports.submit();
        await vi.waitFor(() => expect(a.state.reports.originalPrompt).toBe(WORKFLOW_PROMPT));
        expect(answer(a.state.reports.report!).amount).toBe('1200.5');
        a.state.reports.chooseChart('ranked-bar');
        a.state.reports.input('Draft');
        await a.state.savedReports.save();
        const [item] = a.state.savedReports.items;
        expect(item.prompt).toBe(WORKFLOW_PROMPT);
        expect(fixture.savedValues().map(([, value]) => value)).toEqual([
            JSON.stringify(WORKFLOW_PROMPT),
        ]);
        await b.state.savedReports.load();
        expect(b.state.savedReports.items).toEqual([item]);
        // Independent collaborator's identical save addresses the same per-item key.
        expect(
            await editor.api.saveReport('fixture-a', { prompt: ` ${WORKFLOW_PROMPT} ` })
        ).toEqual(item);
        expect(fixture.savedValues()).toHaveLength(1);
        // Populate this independent client's normal prompt and intent caches first.
        b.state.reports.input(WORKFLOW_PROMPT);
        b.state.reports.submit();
        await vi.waitFor(() => expect(b.state.reports.originalPrompt).toBe(WORKFLOW_PROMPT));
        const first = await click(b.state, item.id);
        expect(answer(first).amount).toBe('1200.5');
        expect(first.query).toContain('after:2026-10-01 before:2026-11-01');
        expect(b.state.reports.chart).toBeUndefined();
        // The cached typed result must not satisfy either repeated saved click.
        const repeat = await click(b.state, item.id);
        expect(repeat.query).toBe(first.query);
        fixture.advance();
        const later = await click(b.state, item.id);
        expect(later.intent.period).toBe('last_month');
        expect(later.query).toContain('after:2026-11-01 before:2026-12-01');
        expect(answer(later).amount).toBe('1050.25');
        expect(fixture.decisions.map(item => item.state)).toEqual([
            { request: WORKFLOW_PROMPT, today: '2026-11-05' },
            { request: WORKFLOW_PROMPT, today: '2026-11-05' },
            { request: WORKFLOW_PROMPT, today: '2026-11-05' },
            { request: WORKFLOW_PROMPT, today: '2026-11-05' },
            { request: WORKFLOW_PROMPT, today: '2026-12-05' },
        ]);
        expect(
            fixture.requests
                .filter(item => item.session === 'editor')
                .slice(-3)
                .map(item => item.body)
        ).toEqual([
            { prompt: WORKFLOW_PROMPT },
            { prompt: WORKFLOW_PROMPT },
            { prompt: WORKFLOW_PROMPT },
        ]);
        expect(fixture.savedValues().map(([, value]) => value)).toEqual([
            JSON.stringify(WORKFLOW_PROMPT),
        ]);
        // Recreate all stores from the URL: intent restoration has no savable source.
        b.state.disconnect();
        const reopened = await client(editor, b.page.location.href);
        expect(reportText(reopened.state.reports.report!.spec)).toBe(reopened.state.reports.text);
        expect(reopened.state.reports.originalPrompt).toBeUndefined();
        expect(reopened.state.savedReports.canSave).toBe(false);
        expect(reopened.state.savedReports.items).toEqual([item]);
        const before = fixture.decisions.length;
        await click(reopened.state, item.id);
        expect(fixture.decisions).toHaveLength(before + 1);
        a.state.select('fixture-b');
        await settled(a.state);
        expect(a.state.savedReports.items).toEqual([]);
        // An id valid in A cannot remove A's prompt through B.
        await owner.api.removeReport('fixture-b', item.id);
        expect((await owner.api.savedReports('fixture-a')).reports).toEqual([item]);
        await editor.api.removeReport('fixture-a', item.id);
        await a.state.savedReports.load();
        a.state.select('fixture-a');
        await settled(a.state);
        expect(a.state.savedReports.items).toEqual([]);
        a.state.disconnect();
        reopened.state.disconnect();
    });

    it('drops a late real report response across A → B → A without restoring its source', async () => {
        const fixture = await savedWorkflow();
        const owner = fixture.session('owner', 'OWNER');
        const saved = await owner.api.saveReport('fixture-a', { prompt: WORKFLOW_PROMPT });
        let hold = true;
        let release: (() => void) | undefined;
        let oldSignal: AbortSignal | undefined;
        const api = createAppApi({
            baseUrl: 'http://fixture.invalid',
            fetch: async request => {
                const prompt = new URL(request.url).pathname.endsWith('/report')
                    ? ((await request.clone().json()) as { prompt?: string }).prompt
                    : undefined;
                const response = await owner.request(request);
                if (hold && prompt) {
                    hold = false;
                    oldSignal = request.signal;
                    // Deliberately ignore cancellation after the real route has answered.
                    await new Promise<void>(resolve => {
                        release = resolve;
                    });
                }
                return response;
            },
        });
        const { state } = await client({ ...owner, api });
        state.openSavedReport(saved.id);
        await vi.waitFor(() => expect(release).toBeDefined());
        state.select('fixture-b');
        await settled(state);
        expect(state.savedReports.items).toEqual([]);
        state.select('fixture-a');
        await settled(state);
        expect(oldSignal?.aborted).toBe(true);
        expect(state.reports.originalPrompt).toBeUndefined();
        fixture.advance();
        const current = await click(state, saved.id);
        expect(answer(current).amount).toBe('1050.25');
        release!();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(state.reports.report).toBe(current);
        expect(state.reports.originalPrompt).toBe(WORKFLOW_PROMPT);
        expect(state.savedReports.items).toEqual([saved]);
        expect(state.savedReports.loadError).toBeUndefined();
        state.disconnect();
    });

    it('rejects stale capabilities after downgrade, retries storage errors and recovers access', async () => {
        const fixture = await savedWorkflow();
        const owner = fixture.session('owner', 'OWNER');
        const viewer = fixture.session('reader', 'RECORDER');
        const a = await client(owner);
        const b = await client(viewer);
        a.state.reports.runSaved(WORKFLOW_PROMPT);
        await vi.waitFor(() => expect(a.state.reports.originalPrompt).toBe(WORKFLOW_PROMPT));
        fixture.failWrites(true);
        await a.state.savedReports.save();
        expect(a.state.savedReports.saveError).toBe('storage_error');
        expect(a.state.savedReports.items).toEqual([]);
        fixture.failWrites(false);
        await a.state.savedReports.save();
        const [item] = a.state.savedReports.items;
        await b.state.savedReports.load();
        expect(b.state.savedReports.items).toEqual([item]);
        expect(b.state.savedReports.canRemove).toBe(false);
        // Shelf listing follows native saved-query roles, not the narrower balances policy.
        const decisionsBefore = fixture.decisions.length;
        await expect(
            viewer.api.report('fixture-a', { prompt: WORKFLOW_PROMPT })
        ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
        expect(fixture.decisions).toHaveLength(decisionsBefore);
        await expect(
            viewer.api.saveReport('fixture-a', { prompt: 'No write' })
        ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
        owner.identity.permission = 'VIEWER';
        const before = fixture.authorizations.length;
        await a.state.savedReports.remove(item.id);
        expect(fixture.authorizations).toHaveLength(before + 1);
        expect(a.state.savedReports.removeError).toBe('forbidden');
        expect(a.state.savedReports.items).toEqual([item]);
        expect(a.state.savedReports.canRemove).toBe(false);
        owner.identity.permission = 'NONE';
        await a.state.savedReports.load();
        expect(a.state.savedReports.items).toEqual([]);
        expect(a.state.savedReports.loadError).toBe('forbidden');
        owner.identity.permission = 'EDITOR';
        await a.state.savedReports.load();
        expect(a.state.savedReports.items).toEqual([item]);
        expect(a.state.savedReports.canRemove).toBe(true);
        expect(a.state.savedReports.loadError).toBeUndefined();
        fixture.failWrites(true);
        await a.state.savedReports.remove(item.id);
        expect(a.state.savedReports.removeError).toBe('storage_error');
        expect(a.state.savedReports.items).toEqual([item]);
        fixture.failWrites(false);
        await a.state.savedReports.remove(item.id);
        await b.state.savedReports.load();
        expect(b.state.savedReports.items).toEqual([]);
        a.state.disconnect();
        b.state.disconnect();
    });
});
