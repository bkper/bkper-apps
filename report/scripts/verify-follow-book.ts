/**
 * Browser verification of the report following the query a Book shows its transactions with.
 * Run with the Vite client running: npx tsx scripts/verify-follow-book.ts
 * Screenshots: /tmp/report-follow-book (override with --screenshots=<directory>).
 * `--app=https://report-preview.bkper.app` runs the client build that was deployed there
 * (`--client`, default `dist/client`) at its own origin instead (see `deployed-app.ts`).
 *
 * The API is stubbed with recorded specs (client/dev/specs/studio.json); no Book, Worker or KV
 * is read. This page plays the Book as bkper-clients implements it (`AppBuilder.ts`,
 * `app-controller.ts`): it opens the app in its panel from `bkper.yaml`'s `menuUrlDev`, with
 * `${book.id}`, `${app.state}` and `${transactions.query}` replaced (the query left unreplaced
 * when the Book shows none), tells it `bkper:host-ready` with `app-state`, keeps the
 * `bkper:app-state` it sends, and tells it `bkper:app-url-changed` whenever its URL changes: after
 * a state, or when the person shows another query in the Book. At desktop and phone widths, light
 * and dark, it checks that:
 *
 * - opened on a query of a group, the app shows that query's report (asked for by the query,
 *   never its first saved prompt), with its text in the input and its state kept by the Book;
 * - the Book telling the URL back with that state asks for nothing;
 * - another query (an Account, another period) shows its report with a view transition scoped to
 *   the report's scroll area, the input showing its text and its state sent once, keeping the
 *   chart chosen from the previews when the next report offers it, else showing its main one;
 * - a query of no group or Account, or of balances side by side with activity, leaves the report and the input
 *   as they are, with no notice and no state sent;
 * - a URL repeated by the Book never asks again, so a typed request stays, while a real change of
 *   the query replaces it (from memory within a minute);
 * - opened on a query of no report, it opens its first saved prompt as with nothing asked, and,
 *   standalone, a query in the app's URL opens its report.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Frame, type Page } from 'playwright-core';
import type { ReportResponse, SavedPrompt } from '../client/src/api/app-api.ts';
import { reportText } from '../shared/src/report-text.ts';
import { decodeUrlState, type UrlState } from '../shared/src/url-state.ts';
import { serveDeployedApp } from './deployed-app.ts';

const option = (name: string): string | undefined =>
    process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const APP = new URL(option('app') ?? 'http://localhost:5207').origin;
const HOST = 'https://bkper.app';
const BOOK = 'fixture-book';
const TIMEOUT_MS = 10_000;
const screenshots = option('screenshots') ?? '/tmp/report-follow-book';

interface Fixture {
    id: string;
    spec: ReportResponse['spec'];
    lang: string;
}

/** The Book's queries and the recorded report each answers; `null` for an API error. */
const QUERIES = {
    group: "group:'Expenses'",
    account: "account:'Taxes'",
    period: "group:'Expenses' after:01/01/2025 before:01/01/2026",
    other: "group:'Net result'",
    none: 'is:draft amount>10',
    mixed: "group:'Expenses' group:'Assets'",
} as const;
const ANSWERS: Record<string, string | { status: number; code: string }> = {
    [QUERIES.group]: 'expenses-by-month',
    [QUERIES.account]: 'taxes-donut',
    [QUERIES.period]: 'expenses-breakdown',
    [QUERIES.other]: 'net-result-compare',
    [QUERIES.none]: { status: 422, code: 'query_not_a_report' },
    [QUERIES.mixed]: { status: 422, code: 'mixed_targets' },
};
/** Suggestions, and the report a typed request asks for. */
const SUGGESTED = ['revenue-donut', 'loans-today'];
const TYPED = 'revenue-total';
/**
 * The chart chosen from the previews: offered by the group's, Account's and period's reports,
 * none of which shows it first, and not by the other group's.
 */
const CHOSEN = 'stacked';

const recorded = JSON.parse(await readFile('client/dev/specs/studio.json', 'utf8')) as Fixture[];
const fixture = (id: string): Fixture => {
    const found = recorded.find(item => item.id === id);
    assert(found, `Recorded spec ${id}`);
    return found;
};

const yaml = await readFile('bkper.yaml', 'utf8');
const menu = /^menuUrlDev:\s*(\S+)\s*$/m.exec(yaml)?.[1];
assert(menu?.includes('${transactions.query}'), 'bkper.yaml menuUrlDev passes the Book’s query');
// The menu URL as the local app serves it.
const menuUrl = APP + menu.slice(new URL(menu.replace(/\$\{[^}]+\}/g, 'x')).origin.length);

const themeUrl =
    'https://cdn.jsdelivr.net/npm/@bkper/web-components@0.2.0/dist/theme-init.global.js';
const themeResponse = await fetch(themeUrl);
assert(themeResponse.ok, 'The shared first-paint theme script is available');
const themeScript = await themeResponse.text();

/** In the app's frame: the request of the report shown, and the transitions started. */
const PAGE_HELPERS = `(() => {
    if (location.origin !== ${JSON.stringify(APP)}) return;
    const page = () => document.querySelector('report-app')?.shadowRoot?.querySelector('report-page')?.shadowRoot;
    window.shownRequest = () => {
        const spec = page()?.querySelector('report-view')?.spec;
        return spec ? spec.elements[spec.root]?.props?.request ?? '' : '';
    };
    window.pressedChart = () => page()?.querySelector('report-view')?.shadowRoot
        ?.querySelector('.preview[aria-pressed="true"]')?.getAttribute('data-kind') ?? '';
    window.inputValue = () => page()?.querySelector('wa-input.prompt')?.value ?? '';
    window.noticeText = () => page()?.querySelector('.notice, .problem')?.textContent?.trim() ?? '';
    window.transitions = [];
    const original = Element.prototype.startViewTransition;
    if (typeof original === 'function') {
        Element.prototype.startViewTransition = function (update) {
            window.transitions.push(this.localName);
            return original.call(this, update);
        };
    }
})()`;

/** The Book page with the app in its panel, showing transactions with `query`. */
function bookPage(query: string, theme: 'light' | 'dark'): string {
    return `<!doctype html><html><head><style>
    html, body { height: 100%; margin: 0; }
    iframe { display: block; width: 100%; height: 100dvh; border: 0; }
</style></head><body><iframe id="panel" title="Report in Book"></iframe><script>
    const MENU_URL = ${JSON.stringify(menuUrl)};
    const APP = ${JSON.stringify(APP)};
    const panel = document.getElementById('panel');
    let query = ${JSON.stringify(query)};
    let appState = '';
    let current;
    window.bookLog = [];
    window.appUrls = [];
    const appUrl = () => {
        let url = MENU_URL.split('\${book.id}').join(${JSON.stringify(BOOK)})
            .split('\${app.state}').join(encodeURIComponent(appState));
        // Bkper leaves the expression unreplaced when the Book shows no query.
        if (query) url = url.split('\${transactions.query}').join(encodeURIComponent(query));
        return url;
    };
    const deliver = force => {
        const next = appUrl();
        if (!force && next === current) return;
        current = next;
        window.appUrls.push(next);
        panel.contentWindow.postMessage({ type: 'bkper:app-url-changed', url: next }, APP);
    };
    window.showQuery = next => { query = next; deliver(false); };
    window.repeatUrl = () => deliver(true);
    window.bookState = () => appState;
    panel.addEventListener('load', () => {
        panel.contentWindow.postMessage({ type: 'bkper:host-ready', supports: ['app-state'] }, APP);
        panel.contentWindow.postMessage({ type: 'bkper:theme-changed', theme: '${theme}' }, APP);
    });
    window.addEventListener('message', event => {
        if (event.source !== panel.contentWindow || event.origin !== APP) return;
        const data = event.data;
        window.bookLog.push(data);
        if (data && data.type === 'bkper:app-state' && typeof data.state === 'string'
            && /^[A-Za-z0-9_-]{0,1024}$/.test(data.state)) {
            appState = data.state;
            deliver(false);
        }
    });
    panel.src = current = appUrl();
</script></body></html>`;
}

const failures: string[] = [];
let checks = 0;
let screenshotCount = 0;
await rm(screenshots, { recursive: true, force: true });
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    args: ['--disable-features=LocalNetworkAccessChecks'],
});
try {
    for (const [width, theme] of [
        [1100, 'light'],
        [390, 'dark'],
    ] as const)
        await following(`${width}-${theme}`, width, theme);
    await openedOnNoReport();
    await standalone();
} finally {
    await browser.close();
}

console.log(`${checks} checks; ${screenshotCount} screenshots in ${screenshots}`);
if (failures.length) {
    console.error(
        `FAIL ${failures.length}:\n${failures.map(failure => `- ${failure}`).join('\n')}`
    );
    process.exit(1);
}
console.log('PASS following the Book');

/** Opens on a group's query, then follows the Book's changes of its query. */
async function following(name: string, width: number, theme: 'light' | 'dark'): Promise<void> {
    const saved = [{ id: '1'.repeat(64), prompt: `saved ${SUGGESTED[0]}` }];
    const app = await open({ width, theme, saved, query: QUERIES.group });
    const { page, panel, bodies } = app;

    await shows(panel, `${name} opened`, 'expenses-by-month');
    check(
        bodies.length === 1 && bodies[0].query === QUERIES.group && !bodies[0].prompt,
        `${name} opened: asked ${JSON.stringify(bodies)}, not the group’s query alone`
    );
    await stateKept(page, `${name} opened`, 'expenses-by-month');
    await shot(page, `${name}-1-group`);

    // The Book tells the app its URL with the state it keeps: nothing more is asked.
    await panel.waitForTimeout(300);
    const urls = await page.evaluate(() => window.appUrls.length);
    check(urls >= 1, `${name}: the Book never told the app its URL with the state kept`);
    check(bodies.length === 1, `${name}: the Book’s URL with its state asked again`);

    await panel.locator(`report-view .preview[data-kind="${CHOSEN}"]`).click();
    await waitFor(
        panel,
        chosen => window.pressedChart() === chosen,
        `${name}: choosing ${CHOSEN}`,
        CHOSEN
    );
    await stateKept(page, `${name} chose ${CHOSEN}`, 'expenses-by-month', CHOSEN);

    await follow(app, `${name} Account`, QUERIES.account, 'taxes-donut', CHOSEN);
    await shot(page, `${name}-2-account`);
    await follow(app, `${name} period`, QUERIES.period, 'expenses-breakdown', CHOSEN);
    await follow(app, `${name} other group`, QUERIES.other, 'net-result-compare');
    await shot(page, `${name}-3-main-chart`);

    for (const query of [QUERIES.none, QUERIES.mixed]) await unchanged(app, `${name}`, query);
    await shot(page, `${name}-4-no-report`);

    // A typed request stays when the Book repeats its URL, and a real change replaces it.
    const field = panel.locator('wa-input.prompt input');
    await field.fill(`typed ${TYPED}`);
    await field.press('Enter');
    await shows(panel, `${name} typed`, TYPED, `typed ${TYPED}`);
    await shot(page, `${name}-5-typed`);
    const asked = bodies.length;
    await page.evaluate(() => window.repeatUrl());
    await panel.waitForTimeout(400);
    check(bodies.length === asked, `${name}: a repeated URL asked again`);
    await shows(panel, `${name} repeated URL`, TYPED, `typed ${TYPED}`);
    await follow(app, `${name} Account again`, QUERIES.account, 'taxes-donut', undefined, true);
    await shot(page, `${name}-6-account-again`);

    check(app.errors.length === 0, `${name}: browser errors ${app.errors.join(' | ')}`);
    await app.close();
}

/** Opened on a query of no report, the Book opens its first saved prompt, as with none. */
async function openedOnNoReport(): Promise<void> {
    const saved = [{ id: '1'.repeat(64), prompt: `saved ${SUGGESTED[1]}` }];
    const app = await open({ width: 1100, theme: 'light', saved, query: QUERIES.none });
    await shows(app.panel, 'Opened on no report', SUGGESTED[1], saved[0].prompt);
    check(
        app.bodies[0]?.query === QUERIES.none &&
            app.bodies.some(body => body.prompt === saved[0].prompt),
        `Opened on no report: asked ${JSON.stringify(app.bodies)}`
    );
    check((await notice(app.panel)) === '', 'Opened on no report: a notice shows');
    await shot(app.page, 'no-report-opens-saved');
    check(app.errors.length === 0, `Opened on no report: browser errors ${app.errors.join(' | ')}`);
    await app.close();
}

/** Standalone, a query in the app's URL opens its report too. */
async function standalone(): Promise<void> {
    const app = await open({
        width: 1100,
        theme: 'dark',
        saved: [],
        query: QUERIES.account,
        embedded: false,
    });
    await shows(app.panel, 'Standalone', 'taxes-donut');
    check(app.bodies[0]?.query === QUERIES.account, 'Standalone: the query was not asked');
    const state = await waitFor(
        app.panel,
        () => new URL(location.href).searchParams.get('state') ?? '',
        'Standalone: the state kept in the app’s URL'
    );
    const decoded = decodeUrlState(String(state));
    check(
        decoded?.text === textOf(fixture('taxes-donut')),
        `Standalone: the app’s URL keeps ${JSON.stringify(decoded)}`
    );
    await shot(app.page, 'standalone');
    check(app.errors.length === 0, `Standalone: browser errors ${app.errors.join(' | ')}`);
    await app.close();
}

type App = Awaited<ReturnType<typeof open>>;

/** The Book shows `query`: the app shows `id`'s report, as `chart` when it is kept. */
async function follow(
    app: App,
    label: string,
    query: string,
    id: string,
    chart?: string,
    memory = false
): Promise<void> {
    const { page, panel, bodies } = app;
    const asked = bodies.length;
    const transitions = await panel.evaluate(() => window.transitions.length);
    const sent = await states(page);
    await page.evaluate(next => window.showQuery(next), query);
    await shows(panel, label, id);
    const fit = fixture(id);
    const main = mainOf(fit);
    await waitFor(
        panel,
        expected => window.pressedChart() === expected,
        `${label}: shows ${chart ?? main}`,
        chart ?? main
    );
    check(
        memory ? bodies.length === asked : bodies.at(-1)?.query === query,
        `${label}: asked ${JSON.stringify(bodies.slice(asked))}`
    );
    const scopes = (await panel.evaluate(() => window.transitions)).slice(transitions);
    check(
        scopes.length === 1 && scopes[0] === 'main',
        `${label}: transitions ${JSON.stringify(scopes)}, not one scoped to the report`
    );
    await stateKept(page, label, id, chart);
    const after = await states(page);
    check(after.length === sent.length + 1, `${label}: ${after.length - sent.length} states sent`);
    check((await notice(panel)) === '', `${label}: a notice shows`);
}

/** The Book shows `query`, which has no report: nothing changes, nothing is said. */
async function unchanged(app: App, name: string, query: string): Promise<void> {
    const { page, panel, bodies } = app;
    const label = `${name} ${query}`;
    const before = await panel.evaluate(() => ({
        request: window.shownRequest(),
        input: window.inputValue(),
        chart: window.pressedChart(),
    }));
    const sent = (await states(page)).length;
    await page.evaluate(next => window.showQuery(next), query);
    const deadline = Date.now() + TIMEOUT_MS;
    while (bodies.at(-1)?.query !== query && Date.now() < deadline) await panel.waitForTimeout(50);
    check(bodies.at(-1)?.query === query, `${label}: not asked`);
    await panel.waitForTimeout(500);
    const after = await panel.evaluate(() => ({
        request: window.shownRequest(),
        input: window.inputValue(),
        chart: window.pressedChart(),
    }));
    check(
        JSON.stringify(after) === JSON.stringify(before),
        `${label}: ${JSON.stringify(before)} became ${JSON.stringify(after)}`
    );
    check((await notice(panel)) === '', `${label}: a notice shows`);
    check((await states(page)).length === sent, `${label}: a state was sent`);
}

/** The report shown is `id`'s, and the input shows `input`, by default its text. */
async function shows(panel: Frame, label: string, id: string, input?: string): Promise<void> {
    const request = requestOf(fixture(id));
    const text = input ?? textOf(fixture(id));
    await waitFor(
        panel,
        ([request, text]) => window.shownRequest() === request && window.inputValue() === text,
        `${label}: shows ${id} with "${text}" in the input`,
        [request, text]
    );
}

/** The Book keeps the state of `id`'s report, as `chart`, by default the one it shows first. */
async function stateKept(page: Page, label: string, id: string, chart?: string): Promise<void> {
    const fit = fixture(id);
    const expected: UrlState = {
        text: textOf(fit),
        language: fit.lang,
        chart: (chart ?? mainOf(fit)) as UrlState['chart'],
    };
    const deadline = Date.now() + TIMEOUT_MS;
    let kept: UrlState | undefined;
    do {
        kept = decodeUrlState(await page.evaluate(() => window.bookState()));
        if (JSON.stringify(kept) === JSON.stringify(expected)) break;
        await page.waitForTimeout(50);
    } while (Date.now() < deadline);
    check(
        JSON.stringify(kept) === JSON.stringify(expected),
        `${label}: the Book keeps ${JSON.stringify(kept)}, not ${JSON.stringify(expected)}`
    );
}

/** The states the app sent the Book. */
async function states(page: Page): Promise<string[]> {
    const log = await page.evaluate(() => window.bookLog);
    return log.flatMap(data =>
        typeof data === 'object' &&
        data !== null &&
        'type' in data &&
        data.type === 'bkper:app-state' &&
        'state' in data &&
        typeof data.state === 'string'
            ? [data.state]
            : []
    );
}

async function notice(panel: Frame): Promise<string> {
    return panel.evaluate(() => window.noticeText());
}

/** Waits in the app's frame until `predicate` holds; its value, or a failure. */
async function waitFor<T>(
    panel: Frame,
    predicate: (arg: T) => unknown,
    label: string,
    arg?: T
): Promise<unknown> {
    checks++;
    try {
        const handle = await panel.waitForFunction(predicate, arg as T, {
            polling: 100,
            timeout: TIMEOUT_MS,
        });
        return handle.jsonValue();
    } catch {
        const seen = await panel.evaluate(() => ({
            request: window.shownRequest(),
            input: window.inputValue(),
            chart: window.pressedChart(),
        }));
        failures.push(`${label}: timed out, seeing ${JSON.stringify(seen)}`);
        return undefined;
    }
}

/**
 * Opens the app with the API stubbed: in the Book's panel showing `query`, or standalone with it
 * in the URL.
 */
async function open(options: {
    width: number;
    theme: 'light' | 'dark';
    saved: SavedPrompt[];
    query: string;
    embedded?: boolean;
}) {
    const embedded = options.embedded ?? true;
    const context = await browser.newContext({
        viewport: { width: options.width, height: 800 },
        colorScheme: options.theme,
        locale: 'en-US',
        hasTouch: options.width < 600,
    });
    await context.addInitScript(PAGE_HELPERS);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`${error.message} ${error.stack ?? ''}`));
    page.on('console', message => {
        const text = message.text();
        // Answers of no report fail their request, which the browser logs.
        if (message.type() === 'error' && !/Blocked autofocusing|status of 422/.test(text))
            errors.push(text);
    });
    const bodies: { prompt?: string; query?: string; language?: string; chart?: string }[] = [];
    await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
        if (req.url() === themeUrl)
            return route.fulfill({ contentType: 'text/javascript', body: themeScript });
        if (url.origin === HOST)
            return route.fulfill({
                contentType: 'text/html',
                body: bookPage(options.query, options.theme),
            });
        if (url.origin === APP && url.pathname === '/auth/refresh')
            return json({ accessToken: 'mock-only-token' });
        if (url.origin === 'https://api.bkper.app') {
            assert.equal(req.method(), 'GET', 'No financial writes');
            return json({ id: BOOK, name: 'Mock Studio', permission: 'OWNER' });
        }
        if (url.origin === APP && url.pathname.startsWith('/api/')) {
            const path = url.pathname;
            if (path.endsWith('/suggestions')) return json({ suggestions: SUGGESTED });
            if (path.endsWith('/names')) return json({ names: [] });
            if (path.endsWith('/prompts') && req.method() === 'GET')
                return json({
                    prompts: options.saved,
                    capabilities: { list: true, save: true, remove: true, move: true },
                });
            if (path.endsWith('/report')) {
                const body = req.postDataJSON() as (typeof bodies)[number];
                // The chart is the app's to show: a request never names one.
                if ('chart' in body)
                    failures.push(`A request asks for a chart: ${JSON.stringify(body)}`);
                // Suggestions' reports are fetched ahead, as the client does; not the Book's.
                const suggested = body.prompt && SUGGESTED.includes(body.prompt);
                if (!suggested) bodies.push(body);
                await new Promise(resolve => setTimeout(resolve, 150));
                if (body.query !== undefined) {
                    const answer = ANSWERS[body.query];
                    assert(answer, `A recorded answer for ${JSON.stringify(body)}`);
                    if (typeof answer !== 'string')
                        return json(
                            { success: false, error: { code: answer.code, message: 'Stub' } },
                            answer.status
                        );
                    return json(responseOf(fixture(answer)));
                }
                const id =
                    SUGGESTED.find(item => body.prompt === item) ??
                    [...SUGGESTED, TYPED].find(item => body.prompt?.endsWith(` ${item}`));
                assert(id, `A recorded report for ${JSON.stringify(body)}`);
                return json(responseOf(fixture(id)));
            }
            throw new Error(`Unmocked API: ${req.method()} ${path}`);
        }
        if (url.origin === APP && req.method() === 'GET') return route.continue();
        return route.abort();
    });
    await serveDeployedApp(context, APP, 'mock-only-token', option('client'));
    if (embedded) await page.goto(`${HOST}/books/${BOOK}/transactions?app=report`);
    else await page.goto(`${APP}/?book=${BOOK}&bookQuery=${encodeURIComponent(options.query)}`);
    const panel = embedded ? await appFrame(page) : page.mainFrame();
    await panel.locator('report-page').waitFor();
    return { page, panel, bodies, errors, close: () => context.close() };
}

async function appFrame(page: Page): Promise<Frame> {
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
        const frame = page.frames().find(candidate => candidate.url().startsWith(APP));
        if (frame) return frame;
        assert(Date.now() < deadline, 'The app opens in the Book panel');
        await page.waitForTimeout(50);
    }
}

async function shot(page: Page, name: string): Promise<void> {
    // Once the report has changed in: a transition takes a moment.
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(screenshots, `${name}.png`) });
    screenshotCount++;
}

declare global {
    interface Window {
        shownRequest(): string;
        pressedChart(): string;
        inputValue(): string;
        noticeText(): string;
        transitions: string[];
        bookLog: unknown[];
        appUrls: string[];
        showQuery(query: string): void;
        repeatUrl(): void;
        bookState(): string;
    }
}

/** The API's answer with a recorded spec, its main chart as the spec offers it. */
function responseOf(fit: Fixture): ReportResponse {
    const main = mainOf(fit);
    return {
        spec: fit.spec,
        text: textOf(fit),
        language: fit.lang,
        query: 'mock-only',
        dataAt: '2025-12-31T21:00:00Z',
        chart: { kind: main === 'table' ? 'none' : main, fallback: false },
        url: `${APP}/?book=${BOOK}`,
    };
}

function mainOf(fit: Fixture) {
    const choices = Object.values(fit.spec.elements).find(
        element => element.type === 'Visualizations'
    );
    return choices?.type === 'Visualizations' ? choices.props.main : 'table';
}

function textOf(fit: Fixture): string {
    return reportText(fit.spec);
}

function requestOf(fit: Fixture): string {
    const root = fit.spec.elements[fit.spec.root];
    assert(root?.type === 'Report');
    return root.props.request ?? '';
}

function check(condition: boolean, failure: string): void {
    checks++;
    if (!condition) failures.push(failure);
}
