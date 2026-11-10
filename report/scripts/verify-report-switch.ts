/**
 * Browser verification of changing reports from the shelf, in an expanded Book panel.
 * Run with the Vite client running: npx tsx scripts/verify-report-switch.ts
 * Screenshots: /tmp/report-switch (override with --screenshots=<directory>).
 *
 * The API is stubbed with recorded specs (client/dev/specs/studio.json); no Book, Worker or KV
 * is read. At desktop and phone widths, light and dark, and with reports hundreds of rows tall on a
 * 2x screen (a snapshot larger than the browser takes is captured smaller, then shown scaled
 * up), it changes reports with the
 * suggestions, the saved prompts, quick successive clicks and a typed request, and checks every
 * view transition as the browser captures it: scoped to the report's scroll area (the input
 * stays live and still), the next report in place with its chart drawn at its size (not still
 * blank, nor the last chart's drawing in the next one's box), its snapshot as tall as the visible
 * area however tall the report, both
 * snapshots at their own size from the top (never scaled to the box), a prefetched report within 150 ms of the click, and the last report clicked shown
 * at the end. A chart chosen from the previews shows within 50 ms, with no transition; with
 * reduced motion, reports change with none. In the panel, the previews sit beside the title,
 * level with it. It saves the frames of one change per layout.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Frame, type FrameLocator, type Page } from 'playwright-core';
import type { ReportResponse, SavedPrompt } from '../client/src/api/app-api.ts';
import { reportText } from '../shared/src/report-text.ts';

const APP = 'http://localhost:5207';
const HOST = 'https://bkper.app';
/** From a click on a report already in memory to the transition showing it. */
const PREFETCHED_MS = 150;
/** From a click on a preview to the chosen chart's first frame. */
const CHART_MS = 50;
const screenshots =
    process.argv.find(arg => arg.startsWith('--screenshots='))?.split('=')[1] ??
    '/tmp/report-switch';

interface Fixture {
    id: string;
    spec: ReportResponse['spec'];
    lang: string;
}

/**
 * Reports of distinct titles whose changes cover the charts' cases: a new chart element of
 * another kind (bar → donut → line → bar), the same element with other data and height
 * (compare → bar), a report without a chart and back.
 */
const ORDER = [
    'expenses-by-month',
    'taxes-donut',
    'bank-accounts-by-month',
    'net-result-by-month-pt',
    'revenue-total',
    'loans-today',
    'net-result-compare',
    'targets-by-month',
];
const recorded = JSON.parse(await readFile('client/dev/specs/studio.json', 'utf8')) as Fixture[];
const fixtures = ORDER.map(id => {
    const fixture = recorded.find(item => item.id === id);
    assert(fixture, `Recorded spec ${id}`);
    return fixture;
});
/** Reports hundreds of rows tall, on a 2x screen. */
let tall = false;

const themeUrl =
    'https://cdn.jsdelivr.net/npm/@bkper/web-components@0.2.0/dist/theme-init.global.js';
const themeResponse = await fetch(themeUrl);
assert(themeResponse.ok, 'The shared first-paint theme script is available');
const themeScript = await themeResponse.text();

/** The page as a view transition captures it, read in the app's frame. */
interface PageState {
    title: string;
    /** The report's height, the visible scroll area's, and its new snapshot's while a transition scoped to it runs. */
    height: number;
    areaHeight: number;
    snapshotHeight: number;
    /** How the old and new snapshots fit their box: `object-fit` and `object-position`. */
    snapshotFit: string[];
    /** The chart shown: whether Chart.js drew it, at what size, in what box. */
    chart: {
        element: string;
        drawn: boolean;
        width: number;
        height: number;
        boxWidth: number;
        boxHeight: number;
    } | null;
    inputTop: number;
    inputFocused: boolean;
}

/** A view transition the page started, timed from the click or key that asked for it. */
interface SwitchRecord {
    scope: string;
    action: number;
    started: number;
    before: PageState;
    ready?: number;
    captured?: PageState;
    skipped?: boolean;
    finished?: number;
    after?: PageState;
}

/**
 * Records every view transition in the app's frame. A string, so the page runs it as written
 * (tsx would wrap named functions in a helper the page lacks).
 */
const RECORD_TRANSITIONS = `(() => {
    if (location.origin !== ${JSON.stringify(APP)}) return;
    const records = [];
    window.reportSwitches = records;
    let action = 0;
    for (const type of ['click', 'keydown']) {
        addEventListener(type, () => { action = performance.now(); }, true);
    }
    const state = () => {
        const page = document.querySelector('report-app')?.shadowRoot?.querySelector('report-page')?.shadowRoot;
        const view = page?.querySelector('report-view');
        const report = view?.shadowRoot;
        const host = report?.querySelector('.chart > *');
        const chart = host?.chart;
        const input = page?.querySelector('wa-input');
        const area = page?.querySelector('.scroll');
        const snapshot = area ? parseFloat(getComputedStyle(area, '::view-transition-new(root)').height) : NaN;
        const fit = part => {
            const style = getComputedStyle(area, part);
            return style.objectFit + ' ' + style.objectPosition;
        };
        return {
            title: report?.querySelector('h1')?.textContent?.trim() ?? '',
            height: view ? view.getBoundingClientRect().height : 0,
            areaHeight: area ? area.getBoundingClientRect().height : 0,
            snapshotHeight: snapshot,
            snapshotFit: area
                ? ['::view-transition-old(root)', '::view-transition-new(root)'].map(fit)
                : [],
            chart: host ? {
                element: host.localName,
                drawn: !!chart,
                width: chart?.width ?? 0,
                height: chart?.height ?? 0,
                boxWidth: host.clientWidth,
                boxHeight: host.clientHeight,
            } : null,
            inputTop: input ? input.getBoundingClientRect().top : NaN,
            inputFocused: !!input && page.activeElement === input,
        };
    };
    for (const prototype of [Element.prototype, Document.prototype]) {
        const original = prototype.startViewTransition;
        if (typeof original !== 'function') continue;
        prototype.startViewTransition = function (update) {
            const record = {
                scope: this instanceof Document ? 'document' : this.localName,
                action,
                started: performance.now(),
                before: state(),
            };
            records.push(record);
            const transition = original.call(this, update);
            transition.ready.then(
                () => { record.ready = performance.now(); record.captured = state(); },
                () => { record.skipped = true; }
            );
            transition.finished.then(() => { record.finished = performance.now(); record.after = state(); });
            return transition;
        };
    }
})()`;

/** Frames of the screen while a report changes, as Chrome draws them (DevTools screencast). */
const film = {
    frames: [] as { at: number; data: string }[],
    stop: undefined as (() => Promise<void>) | undefined,
    async start(page: Page): Promise<void> {
        const session = await page.context().newCDPSession(page);
        this.frames = [];
        session.on('Page.screencastFrame', frame => {
            this.frames.push({ at: frame.metadata.timestamp ?? 0, data: frame.data });
            void session.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
        });
        await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
        this.stop = async () => {
            await session.send('Page.stopScreencast');
            await session.detach();
        };
    },
    async save(page: Page, name: string): Promise<void> {
        await page.waitForTimeout(200);
        await this.stop?.();
        const first = this.frames[0]?.at ?? 0;
        for (const [index, frame] of this.frames.entries()) {
            const ms = Math.round((frame.at - first) * 1000);
            await writeFile(
                join(screenshots, `${name}-${String(index).padStart(3, '0')}-${ms}ms.png`),
                Buffer.from(frame.data, 'base64')
            );
            screenshotCount++;
        }
    },
};

const failures: string[] = [];
const readyTimes: number[] = [];
const chartTimes: number[] = [];
let transitions = 0;
let screenshotCount = 0;
await rm(screenshots, { recursive: true, force: true });
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    args: ['--disable-features=LocalNetworkAccessChecks'],
});
try {
    for (const width of [1100, 390])
        for (const theme of ['light', 'dark'] as const) {
            const name = `${width}-${theme}`;
            await suggestions(name, width, theme);
            await savedPrompts(name, width, theme);
        }
    // Reports hundreds of rows tall on a 2x screen, as large Books have.
    tall = true;
    await suggestions('1100-dark-tall-2x', 1100, 'dark');
    tall = false;
    await reducedMotion();
} finally {
    await browser.close();
}

const summary = (times: number[]) => {
    const sorted = [...times].sort((a, b) => a - b);
    const at = (q: number) =>
        Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
    return `p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${Math.round(sorted.at(-1) ?? 0)} ms`;
};
console.log(`${transitions} transitions checked; ${screenshotCount} screenshots in ${screenshots}`);
console.log(`Prefetched report, click to transition: ${summary(readyTimes)}`);
console.log(`Chosen chart, click to first frame: ${summary(chartTimes)}`);
if (failures.length) {
    console.error(
        `FAIL ${failures.length}:\n${failures.map(failure => `- ${failure}`).join('\n')}`
    );
    process.exit(1);
}
console.log('PASS report switching');

/** Changes reports with the suggestions, quickly, by typing, and chooses a chart. */
async function suggestions(name: string, width: number, theme: 'light' | 'dark'): Promise<void> {
    const { page, frame, panel, errors, close } = await open(width, theme, []);
    const chips = frame.locator('report-shelf report-suggestions wa-button');
    await chips.nth(fixtures.length - 1).waitFor();
    await prefetched(panel);
    // Opened with nothing asked, the Book shows its first suggestion by itself; the others
    // change into one another.
    await panel.waitForFunction(title => window.shownTitle() === title, titleOf(fixtures[0]), {
        polling: 'raf',
    });
    for (let index = 1; index <= fixtures.length; index++) {
        const fixture = fixtures[index % fixtures.length];
        const filmed = index === 2;
        if (filmed) await film.start(page);
        await switchTo(panel, `${name} suggestion → ${fixture.id}`, fixture, true, () =>
            chips.nth(index % fixtures.length).click()
        );
        if (filmed) await film.save(page, `${name}-suggestion`);
    }
    // Two quick clicks: the second report follows once the first is in place.
    const count = await records(panel).then(list => list.length);
    await chips.nth(1).click();
    await chips.nth(2).click();
    await panel.waitForFunction(
        title => window.shownTitle() === title && !window.transitionRunning(),
        titleOf(fixtures[2]),
        { polling: 'raf', timeout: 5000 }
    );
    const quick = (await records(panel)).slice(count);
    check(quick.length >= 1, `${name} quick clicks: no transition`);
    for (const record of quick) checkRecord(`${name} quick clicks`, record, undefined, false);
    // A typed request, answered by the network.
    const field = frame.locator('wa-input.prompt input');
    await field.fill(`typed ${fixtures[3].id}`);
    await switchTo(panel, `${name} typed → ${fixtures[3].id}`, fixtures[3], false, () =>
        field.press('Enter')
    );
    await chooseChart(panel, frame, name);
    await page.screenshot({ path: join(screenshots, `${name}-suggestions.png`) });
    screenshotCount++;
    check(errors.length === 0, `${name}: browser errors ${errors.join(' | ')}`);
    await close();
}

/** Changes reports with the saved prompts: asked the first time, then from memory. */
async function savedPrompts(name: string, width: number, theme: 'light' | 'dark'): Promise<void> {
    const saved = fixtures.slice(0, 3).map((fixture, index) => ({
        id: String(index + 1).repeat(64),
        prompt: `saved ${fixture.id}`,
    }));
    const { page, frame, panel, errors, close } = await open(width, theme, saved);
    const prompts = frame.locator('report-shelf .saved-prompt');
    await prompts.nth(saved.length - 1).waitFor();
    await prefetched(panel);
    // Opened with nothing asked, the Book asks for its first saved prompt by itself.
    await panel.waitForFunction(title => window.shownTitle() === title, titleOf(fixtures[0]), {
        polling: 'raf',
    });
    for (const [index, memory] of [
        [1, false],
        [2, false],
        [0, true],
        [1, true],
    ] as const) {
        await switchTo(
            panel,
            `${name} saved → ${fixtures[index].id}`,
            fixtures[index],
            memory,
            () => prompts.nth(index).click()
        );
    }
    await page.screenshot({ path: join(screenshots, `${name}-saved.png`) });
    screenshotCount++;
    check(errors.length === 0, `${name} saved: browser errors ${errors.join(' | ')}`);
    await close();
}

/** With reduced motion, reports change with no transition. */
async function reducedMotion(): Promise<void> {
    const { frame, panel, errors, close } = await open(1100, 'light', [], 'reduce');
    const chips = frame.locator('report-shelf report-suggestions wa-button');
    await chips.nth(fixtures.length - 1).waitFor();
    await prefetched(panel);
    for (const index of [0, 1, 2]) {
        await chips.nth(index).click();
        await panel.waitForFunction(
            title => window.shownTitle() === title,
            titleOf(fixtures[index]),
            {
                polling: 'raf',
            }
        );
    }
    check((await records(panel)).length === 0, 'Reduced motion: reports changed with a transition');
    check(errors.length === 0, `Reduced motion: browser errors ${errors.join(' | ')}`);
    await close();
}

/** Run `act`, wait for the transition it starts to finish, and check it. */
async function switchTo(
    panel: Frame,
    label: string,
    fixture: Fixture,
    memory: boolean,
    act: () => Promise<unknown>
): Promise<void> {
    const count = (await records(panel)).length;
    await act();
    await panel.waitForFunction(expected => window.reportSwitches.length > expected, count, {
        polling: 'raf',
        timeout: 5000,
    });
    await panel.waitForFunction(
        title => window.shownTitle() === title && !window.transitionRunning(),
        titleOf(fixture),
        { polling: 'raf', timeout: 5000 }
    );
    const list = (await records(panel)).slice(count);
    check(list.length === 1, `${label}: ${list.length} transitions`);
    for (const record of list) checkRecord(label, record, fixture, memory);
}

/** What the transition captured, and how long it took to start. */
function checkRecord(
    label: string,
    record: SwitchRecord,
    fixture: Fixture | undefined,
    memory: boolean
): void {
    transitions++;
    check(record.scope === 'main', `${label}: transition scoped to ${record.scope}`);
    if (record.skipped) return;
    const captured = record.captured;
    if (!captured || record.ready === undefined) {
        failures.push(`${label}: the transition never captured the next report`);
        return;
    }
    if (fixture) {
        check(
            captured.title === titleOf(fixture),
            `${label}: captured "${captured.title}", not the next report "${titleOf(fixture)}"`
        );
        check(
            !!captured.chart === hasChart(fixture),
            `${label}: captured ${captured.chart ? 'a' : 'no'} chart`
        );
    }
    const chart = captured.chart;
    if (chart) {
        check(
            drawnAtSize(chart),
            `${label}: captured before its ${chart.element} was drawn at its size (` +
                (chart.drawn
                    ? `drawn ${Math.round(chart.width)}×${Math.round(chart.height)} in a ${chart.boxWidth}×${chart.boxHeight} box)`
                    : `not drawn yet, its box ${chart.boxWidth}×${chart.boxHeight})`)
        );
    }
    const after = record.after?.chart;
    check(!after || drawnAtSize(after), `${label}: its chart is not drawn at its size at the end`);
    // Never larger than the screen: a whole tall report is captured smaller, then scaled up.
    check(
        Math.abs(captured.snapshotHeight - captured.areaHeight) <= 1,
        `${label}: the next report's snapshot is ${Math.round(captured.snapshotHeight)} px tall, the visible area ${Math.round(captured.areaHeight)} px (the report ${Math.round(captured.height)} px)`
    );
    // Browsers scale snapshots to fit the transition's box by default, which stretched the old
    // report while the next one was prepared: each keeps its own size, from the top.
    check(
        captured.snapshotFit.length === 2 &&
            captured.snapshotFit.every(fit => /^none \S+ 0%$/.test(fit)),
        `${label}: snapshots fit their box as ${captured.snapshotFit.join(' / ')}, not at their own size from the top`
    );
    for (const state of [captured, record.after]) {
        check(
            !!state && Math.abs(state.inputTop - record.before.inputTop) <= 0.5,
            `${label}: the input moved`
        );
    }
    check(!!record.after?.inputFocused, `${label}: the input lost the focus`);
    if (memory) {
        const ms = record.ready - record.action;
        readyTimes.push(ms);
        check(
            ms <= PREFETCHED_MS,
            `${label}: ${Math.round(ms)} ms from the click to the next report`
        );
    }
}

/** A chart chosen from the previews shows at once, with no transition. */
async function chooseChart(panel: Frame, frame: FrameLocator, name: string): Promise<void> {
    const preview = frame.locator('report-view .preview[aria-pressed="false"]').first();
    if ((await preview.count()) === 0) return;
    // In the Book's panel the previews sit beside the title, their tops level with it.
    if (name.startsWith('1100')) {
        const level = await frame.locator('report-view .report-header h1').evaluate(title => {
            const root = title.getRootNode() as ShadowRoot;
            const card = root.querySelector('.preview')?.getBoundingClientRect();
            const intro = root.querySelector('.report-intro')?.getBoundingClientRect();
            const box = title.getBoundingClientRect();
            return (
                !!card &&
                !!intro &&
                Math.abs(card.top - box.top) <= 1 &&
                (card.left >= intro.right || card.right <= intro.left)
            );
        });
        check(level, `${name}: the previews are not beside the title, level with it`);
    }
    const count = (await records(panel)).length;
    const kind = await preview.getAttribute('data-kind');
    // Timed in the page: the click, the report's update, the chart's, then its first frame.
    const ms = await preview.evaluate(async button => {
        const view = document
            .querySelector('report-app')
            ?.shadowRoot?.querySelector('report-page')
            ?.shadowRoot?.querySelector('report-view');
        const start = performance.now();
        (button as HTMLElement).click();
        await (view as unknown as { updateComplete: Promise<unknown> }).updateComplete;
        const chart = view?.shadowRoot?.querySelector('.chart > *');
        await (chart as unknown as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
        await new Promise(resolve => requestAnimationFrame(resolve));
        return performance.now() - start;
    });
    chartTimes.push(ms);
    check(ms <= CHART_MS, `${name}: choosing ${kind} took ${Math.round(ms)} ms`);
    await panel.waitForTimeout(400);
    check(
        (await records(panel)).length === count,
        `${name}: choosing ${kind} started a transition`
    );
    check(
        (await frame
            .locator(`report-view .preview[data-kind="${kind}"]`)
            .getAttribute('aria-pressed')) === 'true',
        `${name}: ${kind} is not pressed after choosing it`
    );
}

/** Opens the app in an expanded Book panel with the API stubbed. */
async function open(
    width: number,
    theme: 'light' | 'dark',
    saved: SavedPrompt[],
    reducedMotion: 'reduce' | 'no-preference' = 'no-preference'
) {
    const context = await browser.newContext({
        viewport: { width, height: 800 },
        deviceScaleFactor: tall ? 2 : 1,
        colorScheme: theme,
        reducedMotion,
        locale: 'en-US',
        hasTouch: width < 600,
    });
    await context.addInitScript(RECORD_TRANSITIONS);
    await context.addInitScript(`(() => {
        window.shownTitle = () => document.querySelector('report-app')?.shadowRoot
            ?.querySelector('report-page')?.shadowRoot?.querySelector('report-view')
            ?.shadowRoot?.querySelector('h1')?.textContent?.trim() ?? '';
        window.transitionRunning = () => (window.reportSwitches ?? []).some(record => record.finished === undefined);
    })()`);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`${error.message} ${error.stack ?? ''}`));
    page.on('console', message => {
        if (message.type() === 'error' && !message.text().includes('Blocked autofocusing'))
            errors.push(message.text());
    });
    await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        const json = (body: unknown) => route.fulfill({ json: body });
        if (req.url() === themeUrl)
            return route.fulfill({ contentType: 'text/javascript', body: themeScript });
        if (url.origin === HOST)
            return route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><html><body style="margin:0"><iframe title="Report in Book" src="${APP}/?book=fixture-book" style="border:0;width:100%;height:100dvh"></iframe><script>
                    const panel = document.querySelector('iframe');
                    panel.onload = () => {
                        panel.contentWindow.postMessage({type:'bkper:host-ready',supports:['app-state']}, '${APP}');
                        panel.contentWindow.postMessage({type:'bkper:theme-changed',theme:'${theme}'}, '${APP}');
                    };
                </script></body></html>`,
            });
        if (url.origin === APP && url.pathname === '/auth/refresh')
            return json({ accessToken: 'mock-only-token' });
        if (url.origin === 'https://api.bkper.app') {
            assert.equal(req.method(), 'GET', 'No financial writes');
            return json({ id: 'fixture-book', name: 'Mock Studio', permission: 'OWNER' });
        }
        if (url.origin === APP && url.pathname.startsWith('/api/')) {
            const path = url.pathname;
            if (path.endsWith('/suggestions'))
                return json({ suggestions: fixtures.map(fixture => fixture.id) });
            if (path.endsWith('/names')) return json({ names: [] });
            if (path.endsWith('/prompts') && req.method() === 'GET')
                return json({
                    prompts: saved,
                    capabilities: { list: true, save: true, remove: true, move: true },
                });
            if (path.endsWith('/report')) {
                const body = req.postDataJSON() as { prompt: string };
                // A suggestion's text is its report; another request the network answers takes
                // a moment, as Bkper AI's would.
                const suggested = fixtures.find(item => body.prompt === item.id);
                if (!suggested) await new Promise(resolve => setTimeout(resolve, 200));
                const fixture =
                    suggested ?? fixtures.find(item => body.prompt.endsWith(` ${item.id}`));
                assert(fixture, `A recorded report for ${JSON.stringify(body)}`);
                return json(responseOf(tall ? tallOf(fixture) : fixture));
            }
            throw new Error(`Unmocked API: ${req.method()} ${path}`);
        }
        if (url.origin === APP && req.method() === 'GET') return route.continue();
        return route.abort();
    });
    await page.goto(`${HOST}/books/fixture-book/transactions?app=report`);
    const frame = page.frameLocator('iframe');
    await frame.locator('report-page').waitFor();
    const panel = page.frames().find(candidate => candidate.url().startsWith(APP));
    assert(panel, 'The app opens in the Book panel');
    await panel.waitForFunction(
        expected => document.documentElement.style.colorScheme === expected,
        theme
    );
    return { page, frame, panel, errors, close: () => context.close() };
}

/** Waits until every suggestion's report is in memory (one request each, answered). */
async function prefetched(panel: Frame): Promise<void> {
    await panel.waitForFunction(
        count =>
            performance.getEntriesByType('resource').filter(entry => entry.name.endsWith('/report'))
                .length >= count,
        fixtures.length,
        { timeout: 10000 }
    );
    await panel.waitForTimeout(300);
}

async function records(panel: Frame): Promise<SwitchRecord[]> {
    return panel.evaluate(() => window.reportSwitches);
}

declare global {
    interface Window {
        /** The transitions recorded in the app's frame. */
        reportSwitches: SwitchRecord[];
        /** The title of the report on screen. */
        shownTitle(): string;
        /** A transition has started and not finished. */
        transitionRunning(): boolean;
    }
}

/** The API's answer with a recorded spec: its main chart as the spec offers it. */
function responseOf(fixture: Fixture): ReportResponse {
    const choices = Object.values(fixture.spec.elements).find(
        element => element.type === 'Visualizations'
    );
    const main = choices?.type === 'Visualizations' ? choices.props.main : 'table';
    return {
        spec: fixture.spec,
        text: reportText(fixture.spec),
        language: fixture.lang,
        query: 'mock-only',
        dataAt: '2025-12-31T21:00:00Z',
        chart: { kind: main === 'table' ? 'none' : main, fallback: false },
        url: `${APP}/?book=fixture-book`,
    };
}

/** The report with its breakdown repeated 60 times, each row under its own id. */
function tallOf(fixture: Fixture): Fixture {
    const copy = structuredClone(fixture);
    for (const element of Object.values(copy.spec.elements)) {
        if (element.type !== 'BreakdownTable') continue;
        const rows = element.props.rows;
        element.props.rows = Array.from({ length: 60 }, (_, index) =>
            rows.map(row => renamed(structuredClone(row), index))
        ).flat();
    }
    return copy;
}

function renamed<T extends { id: string; children?: T[] }>(row: T, index: number): T {
    row.id = `${row.id}-${index}`;
    row.children?.forEach(child => renamed(child, index));
    return row;
}

function titleOf(fixture: Fixture): string {
    const root = fixture.spec.elements[fixture.spec.root];
    assert(root?.type === 'Report');
    return root.props.title;
}

function drawnAtSize(chart: NonNullable<PageState['chart']>): boolean {
    return (
        chart.drawn &&
        Math.abs(chart.width - chart.boxWidth) <= 1 &&
        Math.abs(chart.height - chart.boxHeight) <= 1
    );
}

function hasChart(fixture: Fixture): boolean {
    return Object.values(fixture.spec.elements).some(element => element.type === 'Chart');
}

function check(condition: boolean, failure: string): void {
    if (!condition) failures.push(failure);
}
