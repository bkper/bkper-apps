/**
 * Opens a report from the Bkper Agent in the Report app, end to end, in headless Chromium:
 * the real report file, from the running app's API, in the Agent's file frame, and the real
 * Report app, in the Book's panel. Read-only, with your `bkper auth token`.
 *
 *     npx tsx scripts/verify-open-in-report.ts [--app=<url>] [--api=<url>] <bookId>
 *
 * Needs the app running locally (`npm run dev`: `--app` defaults to the client at
 * http://localhost:5207, `--api` to the Worker at http://localhost:8809) and Playwright's
 * Chromium headless shell. This page plays the two hosts, as bkper-clients implements them:
 *
 * - The Book (`https://bkper.app/books/<bookId>/transactions`, served here) shows the app the
 *   URL names (`app`, `appState`) in its panel, from the menu URL of `bkper.yaml` with
 *   `${book.id}` and `${app.state}` replaced, and tells it `bkper:host-ready` with `app-state`.
 *   It follows `bkper:navigate` from the panel, keeps `bkper:app-state` in its URL without a
 *   history entry, and tells the app `bkper:app-url-changed`.
 * - The Agent (`https://agent.bkper.app/`, served here) shows the file in its sandboxed
 *   `srcdoc` frame with its policy, tells it `bkper:host-ready` with `navigate` and the Bkper
 *   origin, and passes on a `bkper:navigate` only from that frame while it has focus, for a
 *   link on the Bkper origin.
 *
 * It checks that a chart chosen in the file, then a click on the file's link, opens the Report
 * app in place of the Agent with the state of the report as that chart; that the app shows
 * that report by intent, without AI, as that chart, with its title and period in the input;
 * that choosing another chart, then another report, sends each state to the Book; that a
 * state the Book goes back to shows that report again; and that the file reaches no network
 * and sends nothing before the click.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium, type Frame, type Page, type Request } from 'playwright-core';
import type { ViewKind } from '../shared/src/catalog.ts';
import type { ReportFileData } from '../shared/src/report-file.ts';
import { decodeReportState, reportText, type ReportState } from '../shared/src/report-state.ts';

const BKPER = 'https://bkper.app';
const AGENT = 'https://agent.bkper.app/';

/** The Agent's frame policy and document (bkper-clients `packages/agent`, `file-views.ts`). */
const HTML_VIEW_POLICY =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
    "font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

/** `bkper app dev` appends a live-reload script to HTML; deployed Workers do not. */
const DEV_RELOAD =
    /\n?<script defer type="application\/javascript">\s*\(function \(\) \{\s*\/\/ Miniflare Live Reload[\s\S]*?<\/script>\s*$/;

const TIMEOUT_MS = 30_000;

function option(name: string, fallback: string): string {
    const prefix = `--${name}=`;
    return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

/** The Agent, as far as a published file uses it (bkper-clients `file-host.ts`). */
function agentPage(): string {
    return `<!doctype html><html><head><style>
    html, body { height: 100%; margin: 0; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: white; }
</style></head><body><iframe sandbox="allow-scripts" title="report.html"></iframe><script>
    const BKPER = ${JSON.stringify(BKPER)};
    const POLICY = ${JSON.stringify(HTML_VIEW_POLICY)};
    const frame = document.querySelector('iframe');
    let navigable = false;
    let loaded = false;
    window.agentLog = [];
    const announce = () => {
        if (navigable && loaded) {
            frame.contentWindow.postMessage(
                { type: 'bkper:host-ready', supports: ['navigate'], origin: BKPER }, '*');
        }
    };
    frame.addEventListener('load', () => { loaded = !!frame.srcdoc; announce(); });
    window.showFile = html => {
        frame.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="' +
            POLICY + '">' + html;
    };
    window.addEventListener('message', event => {
        const data = event.data;
        if (event.source === window.parent && event.origin === BKPER) {
            if (data && data.type === 'bkper:host-ready' && Array.isArray(data.supports)) {
                navigable = data.supports.includes('navigate');
                announce();
            }
            return;
        }
        if (event.source !== frame.contentWindow) return;
        const focused = document.activeElement === frame && document.hasFocus();
        window.agentLog.push({ data, focused });
        if (!focused || !data || data.type !== 'bkper:navigate' || typeof data.url !== 'string') return;
        let url;
        try { url = new URL(data.url); } catch { return; }
        if (url.origin !== BKPER || url.username || url.password) return;
        window.parent.postMessage({ type: 'bkper:navigate', url: url.href }, BKPER);
    });
</script></body></html>`;
}

/** The Book page with its app panel (bkper-clients `app-controller.ts`, `AppBuilder.ts`). */
function bookPage(menuUrl: string): string {
    return `<!doctype html><html><head><style>
    html, body { height: 100%; margin: 0; }
    iframe { display: block; width: 100%; height: 100%; border: 0; }
</style></head><body><iframe id="panel" title="App"></iframe><script>
    const MENU_URL = ${JSON.stringify(menuUrl)};
    const AGENT = ${JSON.stringify(AGENT)};
    const SUPPORTS = ['navigate', 'show-book', 'expand', 'login', 'app-state'];
    const panel = document.getElementById('panel');
    let shown;
    window.bookLog = [];
    const param = name => new URL(location.href).searchParams.get(name);
    const appUrl = () => MENU_URL
        .split('\${book.id}').join(encodeURIComponent(location.pathname.split('/')[2]))
        .split('\${app.state}').join(encodeURIComponent(param('appState') || ''));
    const open = () => {
        const app = param('app');
        shown = { app, url: app === 'report' ? appUrl() : AGENT };
        panel.src = shown.url;
    };
    const setState = state => {
        const url = new URL(location.href);
        if (state) url.searchParams.set('appState', state);
        else url.searchParams.delete('appState');
        history.replaceState(history.state, '', url);
        const next = appUrl();
        if (shown.app === 'report' && next !== shown.url) {
            shown.url = next;
            panel.contentWindow.postMessage({ type: 'bkper:app-url-changed', url: next },
                new URL(next).origin);
        }
    };
    window.goToState = setState;
    panel.addEventListener('load', () => {
        panel.contentWindow.postMessage({ type: 'bkper:host-ready', supports: SUPPORTS },
            new URL(shown.url).origin);
    });
    window.addEventListener('message', event => {
        if (!shown || event.source !== panel.contentWindow
            || event.origin !== new URL(shown.url).origin) return;
        const data = event.data;
        window.bookLog.push({ app: shown.app, data });
        if (data && data.type === 'bkper:navigate' && typeof data.url === 'string') {
            const url = new URL(data.url);
            if (url.origin !== location.origin || url.username || url.password) return;
            history.pushState(null, '', url);
            open();
        } else if (data && data.type === 'bkper:app-state' && typeof data.state === 'string'
            && /^[A-Za-z0-9_-]{0,128}$/.test(data.state) && param('app') === shown.app) {
            setState(data.state);
        }
    });
    open();
</script></body></html>`;
}

interface ReportFile {
    html: string;
    data: ReportFileData;
}

async function api(base: string, token: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(new URL(path, base), {
        method: body ? 'POST' : 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept-Language': 'en',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
        throw new Error(`${path}: ${response.status} ${await response.text()}`);
    }
    return response;
}

/** The report file the API gives the Agent for the Book's first suggestion. */
async function reportFile(base: string, token: string, bookId: string): Promise<ReportFile> {
    const { suggestions } = (await (
        await api(base, token, `/api/v1/books/${bookId}/suggestions?language=en`)
    ).json()) as { suggestions?: { intent: unknown }[] };
    const intent = suggestions?.[0]?.intent;
    if (!intent) throw new Error('The Book has no suggestions');
    const response = await api(base, token, `/api/v1/books/${bookId}/report`, {
        intent,
        language: 'en',
        format: 'html',
    });
    const html = (await response.text()).replace(DEV_RELOAD, '\n');
    const json = /<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(html);
    if (!json) throw new Error('The file carries no report data');
    return { html, data: JSON.parse(json[1]) as ReportFileData };
}

async function frameOf(page: Page, matches: (url: string) => boolean): Promise<Frame> {
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
        const frame = page.frames().find(candidate => matches(candidate.url()));
        if (frame) return frame;
        if (Date.now() > deadline) {
            throw new Error(
                `A frame did not load: ${page
                    .frames()
                    .map(f => f.url())
                    .join(', ')}`
            );
        }
        await page.waitForTimeout(50);
    }
}

/** The chart a report view shows, `table` for none. */
const shownChart = (frame: Frame): Promise<string> =>
    frame
        .locator('report-view')
        .evaluate(
            view => view.shadowRoot?.querySelector('.chart')?.getAttribute('data-kind') ?? 'table'
        );

/** Clicks the first preview of a chart not shown, other than the table; its kind. */
async function choosePreview(frame: Frame): Promise<string> {
    const preview = frame
        .locator('report-view .preview[aria-pressed="false"]:not([data-kind="table"])')
        .first();
    await preview.waitFor({ timeout: TIMEOUT_MS });
    const kind = (await preview.getAttribute('data-kind')) ?? '';
    await preview.click();
    return kind;
}

const inputValue = async (frame: Frame): Promise<unknown> =>
    frame.locator('report-page wa-input.prompt').evaluate(input => Reflect.get(input, 'value'));

/** What a host page recorded: `bookLog` in the Book, `agentLog` in the Agent. */
const log = (target: Page | Frame, name: 'bookLog' | 'agentLog') =>
    target.evaluate(key => Reflect.get(window, key) as { app?: string; data: unknown }[], name);

/** Waits until `ready` holds, or the time is up; whether it held. */
async function until(ready: () => Promise<boolean>, timeout = TIMEOUT_MS): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (!(await ready())) {
        if (Date.now() > deadline) return false;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
}

async function main(): Promise<void> {
    const appOrigin = new URL(option('app', 'http://localhost:5207')).origin;
    const apiBase = option('api', 'http://localhost:8809');
    const [bookId] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
    if (!bookId) {
        throw new Error(
            'Usage: npx tsx scripts/verify-open-in-report.ts [--app=<url>] [--api=<url>] <bookId>'
        );
    }
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const yaml = await readFile('bkper.yaml', 'utf8');
    const menu = /^menuUrlDev:\s*(\S+)\s*$/m.exec(yaml)?.[1];
    if (!menu?.includes('${app.state}'))
        throw new Error('bkper.yaml menuUrlDev has no ${app.state}');
    // The menu URL as the local app serves it.
    const menuUrl =
        appOrigin + menu.slice(new URL(menu.replace(/\$\{[^}]+\}/g, 'x')).origin.length);

    const file = await reportFile(apiBase, token, bookId);
    const open = file.data.open;
    const fileState = open && decodeReportState(open.state);
    if (!open || !fileState)
        throw new Error(`The file carries no valid report state: ${JSON.stringify(open)}`);
    const fileLabel = reportText(file.data.spec);
    if (!open.charts) throw new Error('The file carries no state for other charts');

    let failed = 0;
    const check = (ok: boolean, what: string, detail = '') => {
        failed += ok ? 0 : 1;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || !detail ? '' : `: ${detail}`}`);
    };

    // The hosts are served here, as public pages, so Chrome would keep them from framing the
    // app on localhost; Bkper and the deployed app are both public.
    const browser = await chromium.launch({
        args: ['--disable-features=LocalNetworkAccessChecks'],
    });
    try {
        const context = await browser.newContext({
            viewport: { width: 1200, height: 900 },
            locale: 'en-US',
        });
        await context.route(`${BKPER}/**`, route =>
            new URL(route.request().url()).pathname.startsWith('/books/')
                ? route.fulfill({ contentType: 'text/html', body: bookPage(menuUrl) })
                : route.fulfill({ status: 404, body: '' })
        );
        await context.route(`${AGENT}**`, route =>
            route.fulfill({ contentType: 'text/html', body: agentPage() })
        );
        const page = await context.newPage();
        const fileRequests: string[] = [];
        const reportBodies: unknown[] = [];
        const errors: string[] = [];
        page.on('request', (request: Request) => {
            const frameUrl = request.frame().url();
            if (frameUrl === 'about:srcdoc') fileRequests.push(request.url());
            if (
                request.url().startsWith(`${appOrigin}/api/v1/books/`) &&
                request.method() === 'POST'
            ) {
                reportBodies.push(request.postDataJSON());
            }
        });
        page.on('console', message => {
            // Chrome blocks the `autofocus` attribute in a frame of another origin, as in the
            // Book; the app focuses its input itself.
            if (message.type() === 'error' && !message.text().includes('Blocked autofocusing')) {
                errors.push(`${message.location().url}: ${message.text()}`);
            }
        });

        await page.goto(`${BKPER}/books/${bookId}/transactions?app=bkper-agent&appState=session-1`);
        const agent = await frameOf(page, url => url === AGENT);
        await agent.waitForFunction(() => 'showFile' in window);
        await agent.evaluate(html => Reflect.get(window, 'showFile')(html), file.html);
        const fileFrame = await frameOf(page, url => url === 'about:srcdoc');
        await fileFrame.locator('report-view .answer-amount').waitFor({ timeout: TIMEOUT_MS });
        await page.waitForTimeout(300);
        check((await log(agent, 'agentLog')).length === 0, 'the file sends nothing before a click');

        // A chart chosen in the file: it shows there, and the link opens the report as it.
        const fileChart = await choosePreview(fileFrame);
        const chosenState = open.charts[fileChart as ViewKind] ?? '';
        const fileChosen = decodeReportState(chosenState);
        check(
            (await shownChart(fileFrame)) === fileChart &&
                fileChosen?.intent.chart === fileChart &&
                (await log(agent, 'agentLog')).length === 0 &&
                fileRequests.length === 0,
            `choosing ${fileChart} in the file shows it there, sending and loading nothing`,
            `${await shownChart(fileFrame)} ${chosenState}`
        );
        if (!fileChosen) throw new Error(`No state for ${fileChart}`);

        await fileFrame.locator('report-view .source-footer a').click();
        await page.waitForURL(url => url.searchParams.get('app') === 'report', {
            timeout: TIMEOUT_MS,
        });
        const bookUrl = new URL(page.url());
        check(
            bookUrl.pathname === `/books/${bookId}/transactions` &&
                bookUrl.searchParams.get('appState') === chosenState,
            'a click opens the Report app in the Book with the state of the chart chosen',
            bookUrl.href
        );

        const app = await frameOf(page, url => url.startsWith(appOrigin));
        check(
            new URL(app.url()).searchParams.get('state') === chosenState,
            'the app opens at its menu URL with the state',
            app.url()
        );
        await app.locator('report-view').waitFor({ timeout: TIMEOUT_MS });
        await until(async () => (await inputValue(app)) === fileLabel);
        check(
            (await inputValue(app)) === fileLabel,
            'the app shows the report, its title and period in the input',
            String(await inputValue(app))
        );
        check(
            JSON.stringify(reportBodies[0]) === JSON.stringify(withLanguage(fileChosen)),
            'the app asks for the file’s report by intent, as the chart chosen, without AI',
            JSON.stringify(reportBodies[0])
        );
        await until(async () => (await shownChart(app)) === fileChart);
        check(
            (await shownChart(app)) === fileChart,
            `the app shows the chart chosen in the file (${fileChart})`,
            await shownChart(app)
        );

        // Another chart, in the app: its state goes to the Book, with no new report.
        const requested = reportBodies.length;
        const appChart = await choosePreview(app);
        await until(async () => new URL(page.url()).searchParams.get('appState') !== chosenState);
        const appChartState = new URL(page.url()).searchParams.get('appState') ?? '';
        const appChosen = decodeReportState(appChartState);
        const chartSent = (await log(page, 'bookLog')).filter(entry => entry.app === 'report');
        check(
            (await shownChart(app)) === appChart &&
                appChosen?.intent.chart === appChart &&
                JSON.stringify({ ...appChosen.intent, chart: fileChosen.intent.chart }) ===
                    JSON.stringify(fileChosen.intent),
            `choosing ${appChart} in the app keeps its state in the Book URL`,
            appChartState
        );
        check(
            chartSent.length === 1 &&
                JSON.stringify(chartSent[0].data) ===
                    JSON.stringify({ type: 'bkper:app-state', state: appChartState }) &&
                new URL(app.url()).searchParams.get('state') === appChartState,
            'the app sends one bkper:app-state for it and keeps it in its own URL',
            JSON.stringify(chartSent)
        );
        check(reportBodies.length === requested, 'choosing a chart asks for no report');

        // Another report, from a suggestion: its state goes to the Book.
        await app.locator('report-page wa-input.prompt').click();
        await page.keyboard.press('Escape');
        const chips = app.locator('report-suggestions wa-button');
        await chips.first().waitFor({ timeout: TIMEOUT_MS });
        // The file is the first suggestion's report, and the app lists them in the same order.
        const chosen = ((await chips.nth(1).textContent()) ?? '').trim();
        if (chosen) await chips.nth(1).click();
        check(chosen !== '', 'another suggestion to choose');
        await until(async () => new URL(page.url()).searchParams.get('appState') !== appChartState);
        const next = new URL(page.url()).searchParams.get('appState') ?? '';
        const nextState = decodeReportState(next);
        const sent = (await log(page, 'bookLog')).filter(entry => entry.app === 'report');
        check(
            !!nextState && JSON.stringify(nextState) !== JSON.stringify(fileState),
            'choosing another report keeps its state in the Book URL',
            next
        );
        check(
            sent.length === 2 &&
                JSON.stringify(sent[1].data) ===
                    JSON.stringify({ type: 'bkper:app-state', state: next }),
            'the app sends one bkper:app-state for it',
            JSON.stringify(sent)
        );
        check(
            new URL(app.url()).searchParams.get('state') === next,
            'the app keeps the state in its own URL',
            app.url()
        );

        // Back in the Book to the file's report: the app shows it again, by intent.
        await page.evaluate(state => Reflect.get(window, 'goToState')(state), open.state);
        await until(async () => (await inputValue(app)) === fileLabel);
        check(
            (await inputValue(app)) === fileLabel,
            'a state the Book goes back to shows that report again',
            String(await inputValue(app))
        );
        await page.waitForTimeout(500);
        const after = (await log(page, 'bookLog')).filter(entry => entry.app === 'report');
        check(
            after.length === 2,
            'the app does not send back the state it is given',
            JSON.stringify(after)
        );
        check(
            reportBodies.every(
                body => typeof body === 'object' && body !== null && !('prompt' in body)
            ),
            'every report is asked for by intent',
            JSON.stringify(reportBodies)
        );
        check(fileRequests.length === 0, 'the file reaches no network', fileRequests.join(', '));
        check(errors.length === 0, 'no console errors', errors.join(' | '));
        await context.close();
    } finally {
        await browser.close();
    }
    console.log(failed === 0 ? 'All checks passed' : `${failed} checks failed`);
    process.exitCode = failed > 0 ? 1 : 0;
}

/** The body the app sends for a state: its intent, in its language. */
function withLanguage(state: ReportState): { intent: ReportState['intent']; language?: string } {
    return { intent: state.intent, ...(state.language ? { language: state.language } : {}) };
}

await main();
