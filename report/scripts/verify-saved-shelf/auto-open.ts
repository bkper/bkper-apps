/**
 * A Book opened with nothing asked opens its first report by itself, in the real client in an
 * expanded Book panel: the first saved prompt in the shelf's order, else the first suggestion
 * (also when the shelf fails), as a click would, with its text selected and the focus in the
 * input, so the first keystroke replaces it. The person acting first wins (typing, even a
 * request cleared, or a chip), and a request (`q`) or a report state in the URL opens only that.
 * Every request is stubbed; no Book or KV is read or written. Called by verify-saved-shelf.ts.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Browser, Frame, FrameLocator, Page } from 'playwright-core';
import type { ReportResponse, SavedPrompt } from '../../client/src/api/app-api.ts';
import { intentWithParts } from '../../shared/src/report-intent.ts';
import { encodeReportState, reportText } from '../../shared/src/report-state.ts';

export interface Fixture {
    id: string;
    intent: ReportResponse['intent'];
    spec: ReportResponse['spec'];
    lang: string;
}

export interface AutoOpenLayout {
    width: number;
    theme: 'light' | 'dark';
    language: 'en' | 'ar';
}

export interface AutoOpenEnvironment {
    browser: Browser;
    app: string;
    host: string;
    themeUrl: string;
    themeScript: string;
    screenshots: string;
    fixtures: Fixture[];
}

export interface AutoOpenResult {
    name: string;
    cases: number;
    screenshots: number;
}

/** What each request shows: recorded reports of distinct titles, so the screen tells them apart. */
type Role = 'suggestion' | 'saved' | 'state' | 'typed' | 'query';

const REPORTS: Record<AutoOpenLayout['language'], Record<Role, string>> = {
    en: {
        suggestion: 'expenses-by-month',
        saved: 'revenue-pie',
        state: 'loans-today',
        typed: 'bank-accounts-by-month',
        query: 'taxes-donut',
    },
    ar: {
        suggestion: 'expenses-breakdown-ar',
        saved: 'net-result-area-ar',
        state: 'bank-accounts-compare-ar',
        typed: 'targets-compare-ar',
        // The recorded Arabic reports have four titles; the Worker may answer in any language.
        query: 'taxes-donut',
    },
};

const TEXTS = {
    en: {
        suggestion: 'Expenses by month',
        saved: ['Revenue this year as a pie', 'Cash today'],
        typed: 'Bank accounts by month',
        query: 'Taxes last quarter',
        key: 'R',
    },
    ar: {
        suggestion: 'المصروفات حسب الشهر',
        saved: ['صافي النتيجة حسب الشهر', 'النقد اليوم'],
        typed: 'صافي النتيجة في سبتمبر',
        query: 'الإيرادات مقارنة بالمصروفات',
        key: 'ص',
    },
};

/**
 * The shelf's first prompt has the larger id: the Book opens on the first in the shelf's order,
 * never the first by id.
 */
const SAVED_IDS = ['f'.repeat(64), '1'.repeat(64)];

/** Longer than the debounce, so anything the page would still ask has been asked. */
const QUIET_MS = 700;

interface Case {
    name: string;
    shelf: 'saved' | 'empty' | 'fails';
    /** The shelf answers only once the person has acted. */
    held?: boolean;
    /** Opened with a request, or a report's state, in the URL. */
    url?: 'query' | 'state';
}

const CASES: Case[] = [
    { name: 'saved', shelf: 'saved' },
    { name: 'suggestion', shelf: 'empty' },
    { name: 'shelf-fails', shelf: 'fails' },
    { name: 'typed-first', shelf: 'saved', held: true },
    { name: 'cleared-first', shelf: 'saved', held: true },
    { name: 'chip-first', shelf: 'saved', held: true },
    { name: 'query', shelf: 'saved', url: 'query' },
    { name: 'state', shelf: 'saved', url: 'state' },
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function verifyAutoOpen(
    env: AutoOpenEnvironment,
    layout: AutoOpenLayout
): Promise<AutoOpenResult> {
    const { width, theme, language } = layout;
    const name = `auto-open-${width}-${theme}-${language}`;
    const texts = TEXTS[language];
    const reports = Object.fromEntries(
        Object.entries(REPORTS[language]).map(([role, id]) => {
            const fixture = env.fixtures.find(item => item.id === id);
            assert(fixture, `Recorded spec ${id}`);
            return [role, fixture];
        })
    ) as Record<Role, Fixture>;
    const titles = new Set(Object.values(reports).map(titleOf));
    assert.equal(titles.size, Object.keys(reports).length, 'Each report has its own title');
    // A state holds a Bkper language, such as `ar` for a report recorded in `ar-EG`.
    const intent = intentWithParts(reports.state.intent);
    const state = intent && encodeReportState({ intent, language });
    assert(state, 'The state fits the URL');
    const context = await env.browser.newContext({
        viewport: { width, height: 800 },
        locale: language,
        colorScheme: theme,
        reducedMotion: 'no-preference',
        hasTouch: width < 600,
    });
    let shots = 0;
    try {
        for (const item of CASES) {
            const page = await context.newPage();
            const run = await open(env, page, item, layout, reports, state);
            const capture = async (moment: string) => {
                await page.screenshot({
                    path: join(env.screenshots, `${name}-${item.name}${moment}.png`),
                });
                shots++;
            };
            const { panel, frame, field, prompts, errors } = run;
            const shelf = frame.locator('report-shelf');
            const shown = () => shownTitle(frame);
            if (
                item.name === 'saved' ||
                item.name === 'suggestion' ||
                item.name === 'shelf-fails'
            ) {
                const opened = item.shelf === 'saved' ? reports.saved : reports.suggestion;
                const text = item.shelf === 'saved' ? texts.saved[0] : texts.suggestion;
                await waitForTitle(panel, titleOf(opened));
                if (item.shelf === 'fails') await shelf.locator('[role="alert"]').waitFor();
                // Exactly as a click: the request in the input and the URL, its report shown.
                await waitForSelected(field, text);
                assert.equal(await queryOf(panel), text, `${item.name}: the URL holds its text`);
                await sleep(QUIET_MS);
                assert.deepEqual(
                    prompts,
                    item.shelf === 'saved' ? [text] : [],
                    `${item.name}: one Bkper AI call for a saved prompt, none for a suggestion`
                );
                assert.equal(await shown(), titleOf(opened));
                assert.deepEqual(await selection(field), selected(text), 'Still selected');
                await capture('-selected');
                // The first keystroke replaces it; the report stays until another is asked.
                await page.keyboard.type(texts.key);
                assert.equal(await field.inputValue(), texts.key, 'A keystroke replaces it');
                assert.equal(await shown(), titleOf(opened));
                await capture('-replaced');
            } else if (item.held) {
                await field.waitFor();
                await frame.locator('wa-input.prompt:not([disabled])').waitFor();
                if (item.name === 'typed-first') {
                    await field.pressSequentially(texts.typed);
                    await waitForTitle(panel, titleOf(reports.typed));
                } else if (item.name === 'cleared-first') {
                    await field.pressSequentially(texts.typed.slice(0, 3));
                    await field.press('Escape');
                    assert.equal(await field.inputValue(), '');
                } else {
                    const chip = shelf.locator('report-suggestions wa-button').first();
                    await chip.click();
                    await waitForTitle(panel, titleOf(reports.suggestion));
                }
                run.release();
                await shelf.locator('.saved-prompt').nth(1).waitFor();
                await run.suggestions;
                await sleep(QUIET_MS);
                // The person acted before the shelf settled: nothing opens over it.
                const expected = {
                    'typed-first': {
                        prompts: [texts.typed],
                        value: texts.typed,
                        title: titleOf(reports.typed),
                    },
                    'cleared-first': { prompts: [], value: '', title: '' },
                    'chip-first': {
                        prompts: [],
                        value: texts.suggestion,
                        title: titleOf(reports.suggestion),
                    },
                }[item.name];
                assert(expected);
                assert.deepEqual(prompts, expected.prompts, `${item.name}: asks nothing more`);
                assert.equal(await field.inputValue(), expected.value, `${item.name}: input`);
                assert.equal(await shown(), expected.title, `${item.name}: the report shown`);
                if (item.name === 'typed-first') {
                    const now = await selection(field);
                    assert.equal(now.start, now.end, 'Nothing is selected over typing');
                }
                await capture('');
            } else {
                // A request or a state in the URL opens that alone.
                const opened = item.url === 'query' ? reports.query : reports.state;
                await waitForTitle(panel, titleOf(opened));
                await shelf.locator('.saved-prompt').nth(1).waitFor();
                await run.suggestions;
                await sleep(QUIET_MS);
                assert.deepEqual(prompts, item.url === 'query' ? [texts.query] : []);
                assert.equal(await shown(), titleOf(opened), `${item.name}: still its report`);
                assert.equal(
                    await field.inputValue(),
                    item.url === 'query' ? texts.query : reportText(opened.spec),
                    `${item.name}: the input holds its request`
                );
                const now = await selection(field);
                assert(
                    !(now.start === 0 && now.end === now.value.length),
                    `${item.name}: nothing selected for the person`
                );
                await capture('');
            }
            assert.deepEqual(run.blocked, [], `${item.name}: all traffic stubbed`);
            assert.deepEqual(errors, [], `${item.name}: no unexpected browser errors`);
            await page.close();
        }
    } finally {
        await context.close();
    }
    return { name, cases: CASES.length, screenshots: shots };
}

/** Opens the app in a Book panel for one case, its API stubbed. */
async function open(
    env: AutoOpenEnvironment,
    page: Page,
    item: Case,
    { theme, language }: AutoOpenLayout,
    reports: Record<Role, Fixture>,
    state: string
) {
    const texts = TEXTS[language];
    const errors: string[] = [];
    const blocked: string[] = [];
    const prompts: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (
            message.type() === 'error' &&
            !(item.shelf === 'fails' && message.text().includes('502')) &&
            !message.text().includes('Blocked autofocusing')
        )
            errors.push(message.text());
    });
    let release = () => {};
    const held = new Promise<void>(resolve => (release = resolve));
    let answered = () => {};
    const suggestions = new Promise<void>(resolve => (answered = resolve));
    const saved: SavedPrompt[] = texts.saved.map((prompt, at) => ({ id: SAVED_IDS[at], prompt }));
    const search = new URLSearchParams({ book: 'fixture-book' });
    if (item.url === 'query') search.set('q', texts.query);
    if (item.url === 'state') search.set('state', state);
    const src = `${env.app}/?${search}`;
    await page.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
        if (req.url() === env.themeUrl)
            return route.fulfill({ contentType: 'text/javascript', body: env.themeScript });
        if (url.origin === env.host)
            return route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><html><body style="margin:0"><iframe title="Report in Book" src="${src}" style="border:0;width:100%;height:100dvh"></iframe><script>
                    const panel = document.querySelector('iframe');
                    panel.onload = () => {
                        panel.contentWindow.postMessage({type:'bkper:host-ready',supports:['app-state']}, '${env.app}');
                        panel.contentWindow.postMessage({type:'bkper:theme-changed',theme:'${theme}'}, '${env.app}');
                    };
                </script></body></html>`,
            });
        if (url.origin === env.app && url.pathname === '/auth/refresh')
            return json({ accessToken: 'mock-only-token' });
        if (url.origin === 'https://api.bkper.app') {
            assert.equal(req.method(), 'GET', 'No financial writes');
            return json({ id: 'fixture-book', name: 'Mock Studio', permission: 'OWNER' });
        }
        if (url.origin === env.app && url.pathname.startsWith('/api/')) {
            const path = url.pathname;
            if (path.endsWith('/suggestions')) {
                await json({
                    suggestions: [{ text: texts.suggestion, intent: reports.suggestion.intent }],
                });
                answered();
                return;
            }
            if (path.endsWith('/names')) return json({ names: [] });
            if (path.endsWith('/prompts') && req.method() === 'GET') {
                if (item.held) await held;
                if (item.shelf === 'fails')
                    return json(
                        { success: false, error: { code: 'storage_error', message: 'Mock' } },
                        502
                    );
                return json({
                    prompts: item.shelf === 'saved' ? saved : [],
                    capabilities: { list: true, save: true, remove: true, move: true },
                });
            }
            if (path.endsWith('/report')) {
                const body = req.postDataJSON() as {
                    prompt?: string;
                    intent?: ReportResponse['intent'];
                };
                if (body.prompt !== undefined) prompts.push(body.prompt);
                const fixture =
                    body.prompt !== undefined
                        ? {
                              [texts.saved[0]]: reports.saved,
                              [texts.typed]: reports.typed,
                              [texts.query]: reports.query,
                          }[body.prompt]
                        : [reports.suggestion, reports.state].find(
                              candidate => body.intent && sameIntent(candidate.intent, body.intent)
                          );
                if (!fixture) {
                    errors.push(`Unexpected report request ${JSON.stringify(body)}`);
                    return json({ success: false, error: { code: 'internal_error' } }, 500);
                }
                return json(responseOf(fixture, env.app));
            }
            errors.push(`Unmocked API: ${req.method()} ${path}`);
            return route.abort();
        }
        if (url.origin === env.app && req.method() === 'GET') return route.continue();
        blocked.push(`${req.method()} ${url.origin}${url.pathname}`);
        return route.abort();
    });
    await page.goto(`${env.host}/books/fixture-book/transactions?app=report`);
    const frame = page.frameLocator('iframe');
    await frame.locator('report-page').waitFor();
    const panel = page.frames().find(candidate => candidate.url().startsWith(env.app));
    assert(panel, 'The app opens in the Book panel');
    await panel.waitForFunction(
        expected => document.documentElement.style.colorScheme === expected,
        theme
    );
    return {
        panel,
        frame,
        field: frame.locator('wa-input.prompt input'),
        prompts,
        errors,
        blocked,
        release,
        suggestions,
    };
}

type Field = ReturnType<FrameLocator['locator']>;

/** The input's text and selection, and whether it has the focus in its frame. */
function selection(field: Field) {
    return field.evaluate((input: HTMLInputElement) => {
        let active: Element | null = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        return {
            value: input.value,
            start: input.selectionStart,
            end: input.selectionEnd,
            focused: active === input && document.hasFocus(),
        };
    });
}

function selected(text: string) {
    return { value: text, start: 0, end: text.length, focused: true };
}

/** The request opened for the person shows selected, the focus in the input. */
async function waitForSelected(field: Field, text: string): Promise<void> {
    const started = Date.now();
    let now = await selection(field);
    while (JSON.stringify(now) !== JSON.stringify(selected(text)) && Date.now() - started < 3000) {
        await sleep(20);
        now = await selection(field);
    }
    assert.deepEqual(now, selected(text), 'The request shows selected, the focus in the input');
}

async function waitForTitle(panel: Frame, title: string): Promise<void> {
    await panel.waitForFunction(
        expected =>
            document
                .querySelector('report-app')
                ?.shadowRoot?.querySelector('report-page')
                ?.shadowRoot?.querySelector('report-view')
                ?.shadowRoot?.querySelector('h1')
                ?.textContent?.trim() === expected,
        title,
        { timeout: 5000 }
    );
}

/** The title of the report on screen; empty when none shows. */
async function shownTitle(frame: FrameLocator): Promise<string> {
    const view = frame.locator('report-view');
    if ((await view.count()) === 0) return '';
    return view.evaluate(
        element => element.shadowRoot?.querySelector('h1')?.textContent?.trim() ?? ''
    );
}

function queryOf(panel: Frame): Promise<string | null> {
    return panel.evaluate(() => new URL(location.href).searchParams.get('q'));
}

/** The same intent, whatever the order of its fields, with no chart and `auto` alike. */
function sameIntent(a: ReportResponse['intent'], b: ReportResponse['intent']): boolean {
    const canonical = (intent: ReportResponse['intent']) =>
        JSON.stringify(
            Object.entries(intent)
                .filter(([, value]) => value !== undefined && value !== 'auto')
                .sort(([x], [y]) => x.localeCompare(y))
        );
    return canonical(a) === canonical(b);
}

function titleOf(fixture: Fixture): string {
    const root = fixture.spec.elements[fixture.spec.root];
    assert(root?.type === 'Report');
    return root.props.title;
}

/** The API's answer with a recorded spec: its charts as the spec offers them. */
function responseOf(fixture: Fixture, app: string): ReportResponse {
    const choices = Object.values(fixture.spec.elements).find(
        element => element.type === 'Visualizations'
    );
    const fitting =
        choices?.type === 'Visualizations' ? choices.props.views.map(view => view.kind) : [];
    const main = choices?.type === 'Visualizations' ? choices.props.main : 'table';
    return {
        spec: fixture.spec,
        intent: fixture.intent,
        language: fixture.lang,
        query: 'mock-only',
        dataAt: '2025-12-31T21:00:00Z',
        chart: { kind: main === 'table' ? 'none' : main, fallback: false },
        trace: {
            facts: {
                rows: 0,
                negative: 0,
                mixed: false,
                months: 0,
                previous: false,
                net: false,
                permanent: false,
            },
            chart: { fitting, main, rule: 'rules' },
        },
        url: `${app}/?book=fixture-book`,
    };
}
