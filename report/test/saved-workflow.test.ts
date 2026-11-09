import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCompletion } from 'report-shared/name-index';
import { reportText } from 'report-shared/report-state';
import { savedWorkflow, WORKFLOW_PROMPT } from '../scripts/fixtures/saved-workflow';
import type { AuthSessionCallbacks } from '../client/src/auth/auth-session';
import { createAppApi, type ReportResponse } from '../client/src/api/app-api';
import { AppState } from '../client/src/state/app-state';
import { CACHE_MS } from '../client/src/state/cache-window';
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

/** The clients' fake clock: report caches last {@link CACHE_MS} of it. */
const clock = { now: 0 };
beforeEach(() => void (clock.now = 1_000_000));

async function client(session: Session, href?: string) {
    const opened = await start(session, href);
    await settled(opened.state);
    return opened;
}

/** A client signed in on `href`, without waiting for anything it asks. */
async function start(session: Session, href = 'http://localhost:5207/?book=fixture-a') {
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
        createBookNamesApi: () => session.api,
        loadRenderer: async () => undefined,
        loadStrings: async () => undefined,
        now: () => clock.now,
    });
    state.connect();
    await callbacks.onLoginSuccess?.();
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

function isIntentBody(body: unknown): boolean {
    return typeof body === 'object' && body !== null && 'intent' in body;
}

function answer(report: ReportResponse) {
    const [first] = answers(report);
    if (!first) throw new Error('Missing answer');
    return first;
}

function answers(report: ReportResponse) {
    return Object.values(report.spec.elements).flatMap(item =>
        item.type === 'Answer' ? [item.props] : []
    );
}

function breakdown(report: ReportResponse) {
    const element = report.spec.elements.breakdown;
    if (element?.type !== 'BreakdownTable') throw new Error('Missing breakdown');
    return element.props;
}

/** The session's API, counting the routes each client calls. */
function counted(session: Session, calls: string[]): Session {
    const request = (input: Request) => {
        calls.push(`${input.method} ${new URL(input.url).pathname}`);
        return session.request(input);
    };
    return {
        ...session,
        request,
        api: createAppApi({ baseUrl: 'http://fixture.invalid', fetch: request }),
    };
}

/**
 * Type `typed` after `text` and accept the completion of `name` from the client's names, as
 * Tab does: the request with the name written as the Book writes it, the rest kept.
 */
function completeName(state: AppState, text: string, typed: string, name: string): string {
    const request = text + typed;
    state.reports.input(request);
    const offered = state.names.complete(request, request.length);
    const completion = offered.find(item => item.text === name);
    if (!completion) throw new Error(`${name} is not offered for "${typed}"`);
    const applied = applyCompletion(request, completion);
    expect(applied.caret).toBe(applied.text.length);
    state.reports.input(applied.text);
    return applied.text;
}

describe('saved-prompt route/service and independent app clients', () => {
    it('shares only original text, reopens it within a minute from memory and rolls last month forward', async () => {
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
        // This independent client's own typed request of the same text answers its saved click.
        b.state.reports.input(WORKFLOW_PROMPT);
        b.state.reports.submit();
        await vi.waitFor(() => expect(b.state.reports.originalPrompt).toBe(WORKFLOW_PROMPT));
        const typed = b.state.reports.report!;
        b.state.reports.chooseChart('ranked-bar');
        b.state.openSavedReport(item.id);
        expect(b.state.reports.report).toBe(typed);
        expect(b.state.reports.pending).toBe(false);
        expect(b.state.reports.chart).toBeUndefined();
        clock.now += CACHE_MS;
        const first = await click(b.state, item.id);
        expect(answer(first).amount).toBe('1200.5');
        expect(first.query).toContain('after:2026-10-01 before:2026-11-01');
        // Within a minute a click shows the same report, though the date has changed since.
        fixture.advance();
        b.state.openSavedReport(item.id);
        expect(b.state.reports.report).toBe(first);
        clock.now += CACHE_MS;
        const later = await click(b.state, item.id);
        expect(later.intent.period).toBe('last_month');
        expect(later.query).toContain('after:2026-11-01 before:2026-12-01');
        expect(answer(later).amount).toBe('1050.25');
        expect(fixture.decisions.map(item => item.state)).toEqual([
            { request: WORKFLOW_PROMPT, today: '2026-11-05' },
            { request: WORKFLOW_PROMPT, today: '2026-11-05' },
            { request: WORKFLOW_PROMPT, today: '2026-11-05' },
            { request: WORKFLOW_PROMPT, today: '2026-12-05' },
        ]);
        // The typed request and the two clicks after a minute each; the suggestions' reports,
        // by intent, are fetched again with the suggestions after each minute.
        const editorBodies = () =>
            fixture.requests.filter(item => item.session === 'editor').map(item => item.body);
        expect(editorBodies().filter(body => !isIntentBody(body))).toEqual([
            { prompt: WORKFLOW_PROMPT },
            { prompt: WORKFLOW_PROMPT },
            { prompt: WORKFLOW_PROMPT },
        ]);
        expect(b.state.reports.suggestions).toHaveLength(3);
        await vi.waitFor(() => expect(editorBodies().filter(isIntentBody)).toHaveLength(9));
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

    it('reports what a saved prompt names, and the root Jev chooses once it is renamed', async () => {
        const fixture = await savedWorkflow();
        const owner = fixture.session('owner', 'OWNER');
        const prompt = 'Food last month';
        const saved = await owner.api.saveReport('fixture-a', { prompt });
        // The Book opens with its first saved prompt, as a click does.
        const { state } = await client(owner);
        const title = (report: ReportResponse) => report.spec.elements[report.spec.root].props;

        const named = state.reports.report!;
        expect(state.reports.originalPrompt).toBe(prompt);
        expect(named.intent).toEqual({
            root: 'g-expenses',
            target: 'a-food',
            period: 'last_month',
            monthly: false,
        });
        expect(title(named)).toMatchObject({ title: 'Food' });
        expect(answer(named).amount).toBe('200.5');
        expect(named.trace.names).toEqual(['Food']);

        // Renamed in the Book: the saved text no longer names it, and Jev's root is read.
        await fixture.renameAccount('a-food', 'Groceries');
        clock.now += CACHE_MS;
        const renamed = await click(state, saved.id);
        expect(renamed.intent).toEqual({
            root: 'g-expenses',
            period: 'last_month',
            monthly: false,
        });
        expect(title(renamed)).toMatchObject({ title: 'Expenses' });
        expect(answer(renamed).amount).toBe('1200.5');
        expect(renamed.trace.names).toBeUndefined();
        expect(fixture.savedValues().map(([, value]) => value)).toEqual([JSON.stringify(prompt)]);
        state.disconnect();
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
        // The Book opens its first saved prompt, as a click does; its answer is held.
        const { state } = await start({ ...owner, api });
        await vi.waitFor(() => expect(release).toBeDefined());
        state.select('fixture-b');
        await settled(state);
        expect(state.savedReports.items).toEqual([]);
        fixture.advance();
        // Back on A, it opens again, read afresh on the new date.
        state.select('fixture-a');
        await settled(state);
        expect(oldSignal?.aborted).toBe(true);
        const current = state.reports.report!;
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

describe('completed names, through the real routes, reports, the shelf and other clients', () => {
    it('completes a name into a report of it, saves its text and reopens it elsewhere', async () => {
        const fixture = await savedWorkflow();
        const ownerCalls: string[] = [];
        const editorCalls: string[] = [];
        const owner = counted(fixture.session('owner', 'OWNER'), ownerCalls);
        const editor = counted(fixture.session('editor', 'EDITOR'), editorCalls);
        const a = await client(owner);
        await a.state.names.loaded;

        // Group or Account, at most five, the shortest first; from memory, with no request.
        const before = ownerCalls.length;
        expect(
            a.state.names
                .complete('Re', 2)
                .map(({ text, name }) => [text, name.kind, name.id, name.root])
        ).toEqual([
            ['Rent', 'account', 'a-rent', 'g-expenses'],
            ['Revenue', 'group', 'g-revenue', 'g-revenue'],
        ]);
        let text = completeName(a.state, '', 'fo', 'Food');
        expect(text).toBe('Food ');
        text += 'last month';
        a.state.reports.input(text);
        expect(ownerCalls.slice(before)).toEqual([]);

        // The debounce asks for the completed request, as for typing.
        await vi.waitFor(() => expect(a.state.reports.originalPrompt).toBe('Food last month'));
        const named = a.state.reports.report!;
        expect(named.intent).toEqual({
            root: 'g-expenses',
            target: 'a-food',
            period: 'last_month',
            monthly: false,
        });
        expect(named.trace.names).toEqual(['Food']);
        expect(named.spec.elements[named.spec.root].props).toMatchObject({ title: 'Food' });
        expect(answer(named)).toMatchObject({ amount: '200.5', label: 'Food' });
        expect(named.query).toBe("account:'Food' after:2026-10-01 before:2026-11-01");
        // Names complete only the text; Jev gets the same single decision request.
        expect(fixture.decisions.map(item => item.state)).toEqual([
            { request: 'Food last month', today: '2026-11-05' },
        ]);

        await a.state.savedReports.save();
        const [item] = a.state.savedReports.items;
        expect(item.prompt).toBe('Food last month');
        expect(fixture.savedValues().map(([, value]) => value)).toEqual([
            JSON.stringify('Food last month'),
        ]);

        // Another collaborator reopens the text: the same Account, from its own query.
        // It opens with the Book, as a click does.
        const b = await client(editor);
        expect(b.state.savedReports.items).toEqual([item]);
        const reopened = b.state.reports.report!;
        expect(reopened.intent).toEqual(named.intent);
        expect(answer(reopened).amount).toBe('200.5');
        expect(b.state.reports.originalPrompt).toBe('Food last month');
        const asked = fixture.requests.filter(request => request.session === 'editor').length;
        b.state.openSavedReport(item.id);
        expect(b.state.reports.report).toBe(reopened);
        expect(fixture.requests.filter(request => request.session === 'editor')).toHaveLength(
            asked
        );

        // After a minute, the text is read again and the period rolls forward.
        fixture.advance();
        clock.now += CACHE_MS;
        const later = await click(b.state, item.id);
        expect(later.intent).toEqual(named.intent);
        expect(later.query).toBe("account:'Food' after:2026-11-01 before:2026-12-01");
        expect(answer(later).amount).toBe('50.25');
        // Each client asked for the names once, and again only when typing after a minute.
        expect(ownerCalls.filter(call => call.endsWith('/names'))).toHaveLength(1);
        expect(editorCalls.filter(call => call.endsWith('/names'))).toHaveLength(2);
        a.state.disconnect();
        b.state.disconnect();
    });

    it('completes two names into a report of both side by side, never added up', async () => {
        const fixture = await savedWorkflow();
        const owner = fixture.session('owner', 'OWNER');
        const viewer = fixture.session('viewer', 'VIEWER');
        const a = await client(owner);
        await a.state.names.loaded;
        let text = completeName(a.state, '', 'Fo', 'Food');
        text = completeName(a.state, `${text}versus `, 're', 'Rent');
        expect(text).toBe('Food versus Rent ');
        a.state.reports.input(`${text}last month`);
        await vi.waitFor(() =>
            expect(a.state.reports.originalPrompt).toBe('Food versus Rent last month')
        );
        const shown = a.state.reports.report!;
        expect(shown.intent).toMatchObject({
            root: 'g-expenses',
            target: 'a-food',
            alongside: [{ root: 'g-expenses', target: 'a-rent' }],
            period: 'last_month',
        });
        expect(shown.trace.names).toEqual(['Food', 'Rent']);
        expect(shown.query).toBe(
            "(account:'Food' OR account:'Rent') after:2026-10-01 before:2026-11-01"
        );
        // Each its own Bkper balance; nothing for them together (their group is 1200.5).
        expect(answers(shown).map(({ label, amount }) => [label, amount])).toEqual([
            ['Food', '200.5'],
            ['Rent', '1000'],
        ]);
        const table = breakdown(shown);
        expect(table.total).toBeUndefined();
        expect(table.rows.map(row => [row.label, row.amount, row.share])).toEqual([
            ['Food', '200.5', undefined],
            ['Rent', '1000', undefined],
        ]);
        expect(shown.trace.chart.fitting).not.toContain('donut');
        expect(shown.trace.chart.fitting).not.toContain('pie');
        expect(shown.trace.chart.fitting).not.toContain('stacked');

        await a.state.savedReports.save();
        const [item] = a.state.savedReports.items;
        expect(item.prompt).toBe('Food versus Rent last month');

        // "and" or "versus": the same report, reopened from the saved text by a viewer.
        const b = await client(viewer);
        b.state.reports.input('Food and Rent last month');
        b.state.reports.submit();
        await vi.waitFor(() =>
            expect(b.state.reports.originalPrompt).toBe('Food and Rent last month')
        );
        const typed = b.state.reports.report!;
        const reopened = await click(b.state, item.id);
        expect(reopened.intent).toEqual(typed.intent);
        expect(reopened.query).toBe(shown.query);
        expect(answers(reopened)).toEqual(answers(typed));
        expect(b.state.savedReports.canSave).toBe(false);
        expect(fixture.savedValues()).toHaveLength(1);
        a.state.disconnect();
        b.state.disconnect();
    });
});
