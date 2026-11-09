/**
 * Mock-only browser verification of the saved-prompt shelf in an expanded Book panel.
 * Run with the Vite client running: npx tsx scripts/verify-saved-shelf.ts
 * Screenshots: /tmp/report-saved-shelf (override with --screenshots=<directory>).
 * Eight layout scenarios stub the API; ten more drag saved prompts along the shelf by mouse
 * and finger (see verify-saved-shelf/drag.ts); four open a Book with nothing asked, which then
 * opens its first report by itself unless the person acted first or the URL asks for one (see
 * verify-saved-shelf/auto-open.ts); a two-collaborator scenario bridges the browsers to real
 * app routes/services with isolated KV, snapshots and decision responses, and completes a
 * Book name into a report that it saves and another collaborator reopens.
 * Every auth and Bkper request is intercepted; no real Book or KV is accessed.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { ReportResponse, SavedPrompt } from '../client/src/api/app-api.ts';
import { withoutIsolates } from 'report-shared/bidi';
import { CACHE_MS } from '../client/src/state/cache-window.ts';
import { savedWorkflow, WORKFLOW_PROMPT } from './fixtures/saved-workflow.ts';
import { verifyAutoOpen, type AutoOpenLayout } from './verify-saved-shelf/auto-open.ts';
import { summarize, verifyDrag, type DragLayout } from './verify-saved-shelf/drag.ts';

const APP = 'http://localhost:5207';
const HOST = 'https://bkper.app';
const screenshots =
    process.argv.find(arg => arg.startsWith('--screenshots='))?.split('=')[1] ??
    '/tmp/report-saved-shelf';
const fixtures = JSON.parse(await readFile('client/dev/specs/studio.json', 'utf8')) as {
    id: string;
    intent: ReportResponse['intent'];
    spec: ReportResponse['spec'];
    lang: string;
}[];
const themeUrl =
    'https://cdn.jsdelivr.net/npm/@bkper/web-components@0.2.0/dist/theme-init.global.js';
const themeResponse = await fetch(themeUrl);
assert(themeResponse.ok, 'The shared first-paint theme script is available');
const themeScript = await themeResponse.text();
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    args: ['--disable-features=LocalNetworkAccessChecks'],
});
let scenarios = 0;
let screenshotCount = 0;
try {
    for (const width of [1100, 390])
        for (const theme of ['light', 'dark'] as const)
            for (const language of ['en', 'ar']) {
                const name = `${width}-${theme}-${language}`;
                const context = await browser.newContext({
                    viewport: { width, height: 800 },
                    locale: language,
                    colorScheme: theme,
                    reducedMotion: 'reduce',
                });
                const page = await context.newPage();
                const errors: string[] = [];
                const blocked: string[] = [];
                page.on('pageerror', error => errors.push(error.message));
                // HTTP failures are intentional below; unexpected browser errors still fail the run.
                page.on('console', message => {
                    if (
                        message.type() === 'error' &&
                        !message.text().includes('502') &&
                        !message.text().includes('Blocked autofocusing')
                    )
                        errors.push(message.text());
                });
                const fixture = fixtures.find(
                    item =>
                        item.id ===
                        (language === 'ar' ? 'expenses-breakdown-ar' : 'expenses-by-month')
                );
                assert(fixture);
                const response: ReportResponse = {
                    spec: fixture.spec,
                    intent: fixture.intent,
                    language: fixture.lang,
                    query: 'mock-only',
                    dataAt: '2025-12-31T21:00:00Z',
                    chart: { kind: language === 'ar' ? 'ranked-bar' : 'bar', fallback: false },
                    trace: {
                        facts: {
                            rows: 7,
                            negative: 0,
                            mixed: false,
                            months: 12,
                            previous: true,
                            net: false,
                            permanent: false,
                        },
                        chart: {
                            fitting: ['bar', 'ranked-bar', 'table'],
                            main: language === 'ar' ? 'ranked-bar' : 'bar',
                            rule: 'rules',
                        },
                    },
                    url: `${APP}/?book=fixture-book`,
                };
                const prompt =
                    language === 'ar'
                        ? 'المصروفات هذا العام حسب الشهر 日本語 مع تفاصيل طويلة '.repeat(8)
                        : 'Expenses this year by month — 日本語 receitas e despesas '.repeat(8);
                let items: SavedPrompt[] = [];
                const requested: unknown[] = [];
                let saveFails = true;
                let removeFails = true;
                let writable = true;
                await context.route('**/*', async route => {
                    const req = route.request();
                    const url = new URL(req.url());
                    const json = (body: unknown, status = 200) =>
                        route.fulfill({ status, json: body });
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
                window.send = data => panel.contentWindow.postMessage(data, '${APP}');
            </script></body></html>`,
                        });
                    if (url.origin === APP && url.pathname === '/auth/refresh')
                        return json({ accessToken: 'mock-only-token' });
                    if (url.origin === 'https://api.bkper.app') {
                        assert.equal(req.method(), 'GET', 'No financial writes');
                        return json({
                            id: 'fixture-book',
                            name: 'Mock Studio',
                            permission: 'OWNER',
                        });
                    }
                    if (url.origin === APP && url.pathname.startsWith('/api/')) {
                        const path = url.pathname;
                        if (path.endsWith('/suggestions'))
                            return json({
                                suggestions: [
                                    {
                                        text:
                                            language === 'ar'
                                                ? 'المصروفات حسب الشهر'
                                                : 'Expenses by month',
                                        intent: fixture.intent,
                                    },
                                ],
                            });
                        if (path.endsWith('/names')) return json({ names: [] });
                        if (path.endsWith('/report')) {
                            requested.push(req.postDataJSON());
                            return json(response);
                        }
                        if (path.endsWith('/reports') && req.method() === 'GET')
                            return json({
                                reports: items,
                                capabilities: {
                                    list: true,
                                    save: writable,
                                    remove: writable,
                                    move: writable,
                                },
                            });
                        if (path.endsWith('/reports') && req.method() === 'POST') {
                            await new Promise(resolve => setTimeout(resolve, 350));
                            if (saveFails) {
                                saveFails = false;
                                return json(
                                    {
                                        success: false,
                                        error: { code: 'storage_error', message: 'Mock failure' },
                                    },
                                    502
                                );
                            }
                            assert.deepEqual(
                                req.postDataJSON(),
                                { prompt: prompt.trim() },
                                'Save uses the shown original, not the later draft'
                            );
                            const item = { id: 'a'.repeat(64), prompt: prompt.trim() };
                            items = [
                                item,
                                ...[
                                    'Receitas por mês',
                                    '日本語の収入レポート',
                                    'المصروفات هذا الشهر',
                                    'Cash position today',
                                ].map((text, index) => ({
                                    id: String(index + 1).repeat(64),
                                    prompt: text,
                                })),
                            ];
                            return json({ report: item });
                        }
                        if (path.endsWith('/position') && req.method() === 'PUT') {
                            const id = path.split('/').at(-2);
                            const { before } = req.postDataJSON() as { before: string | null };
                            const item = items.find(entry => entry.id === id);
                            assert(item, 'Moves only a prompt on the shelf');
                            const rest = items.filter(entry => entry !== item);
                            const at =
                                before === null
                                    ? rest.length
                                    : rest.findIndex(entry => entry.id === before);
                            items = [...rest.slice(0, at), item, ...rest.slice(at)];
                            return json({
                                reports: items,
                                capabilities: { list: true, save: true, remove: true, move: true },
                            });
                        }
                        if (path.includes('/reports/') && req.method() === 'DELETE') {
                            if (removeFails) {
                                removeFails = false;
                                return json(
                                    {
                                        success: false,
                                        error: { code: 'storage_error', message: 'Mock failure' },
                                    },
                                    502
                                );
                            }
                            items = items.filter(item => !path.endsWith(item.id));
                            return route.fulfill({ status: 204 });
                        }
                        throw new Error(`Unmocked API: ${req.method()} ${path}`);
                    }
                    if (url.origin === APP && req.method() === 'GET') return route.continue();
                    blocked.push(`${req.method()} ${url.origin}${url.pathname}`);
                    return route.abort();
                });
                // A fake clock that runs on its own, moved ahead to expire the report cache.
                await context.clock.install();
                await page.goto(`${HOST}/books/fixture-book/transactions?app=report`);
                const frame = page.frameLocator('iframe');
                const shelf = frame.locator('report-shelf');
                const field = frame.locator('wa-input.prompt input');
                const save = shelf.locator('.save');
                const capture = async (state: string) => {
                    await page.screenshot({ path: join(screenshots, `${name}-${state}.png`) });
                    screenshotCount++;
                };
                await shelf.locator('report-suggestions wa-button').waitFor();
                const initialPanel = page
                    .frames()
                    .find(candidate => candidate.url().startsWith(APP));
                assert(initialPanel);
                await initialPanel.waitForFunction(
                    expected => document.documentElement.style.colorScheme === expected,
                    theme
                );
                await capture('initial');
                assert.equal(await frame.locator('book-picker').count(), 0);
                await field.fill(prompt);
                await field.press('Enter');
                await frame.locator('report-view').waitFor();
                await save.waitFor();
                await field.fill('Draft');
                await save.click();
                await page.waitForTimeout(50);
                assert.equal(await save.getAttribute('loading'), '');
                await capture('saving');
                await shelf.locator('[role="alert"]').waitFor();
                await capture('save-error');
                await save.click();
                await shelf.locator('.saved-prompt').waitFor();
                assert.equal(await shelf.locator('report-suggestions').count(), 0);
                assert.equal(
                    await shelf.locator('.saved-prompt').getAttribute('aria-label'),
                    prompt.trim()
                );
                assert.equal(await save.getAttribute('disabled'), '');
                await capture('saved');
                // Reload sees the full Book-shared shelf; this is a new HTTP list, not browser persistence.
                const panel = page.frames().find(candidate => candidate.url().startsWith(APP));
                assert(panel);
                await panel.goto(panel.url());
                await shelf.locator('.saved-prompt').first().waitFor();
                assert.equal(await shelf.locator('.saved-prompt').count(), 5);
                const savedPrompt = shelf
                    .locator('.saved-prompt')
                    .filter({ hasText: prompt.trim() });
                const prompted = () => requested.filter(isPromptBody).length;
                const promptsBefore = prompted();
                await savedPrompt.click();
                await page.waitForTimeout(100);
                await savedPrompt.click();
                await page.waitForTimeout(100);
                assert.equal(
                    prompted(),
                    promptsBefore + 1,
                    'A saved click within a minute shows its report from memory'
                );
                await context.clock.fastForward(CACHE_MS);
                await savedPrompt.click();
                await page.waitForTimeout(100);
                assert.equal(
                    prompted(),
                    promptsBefore + 2,
                    'After a minute a saved click resolves its text again'
                );
                assert.deepEqual(requested.filter(isPromptBody).slice(-2), [
                    { prompt: prompt.trim() },
                    { prompt: prompt.trim() },
                ]);
                const geometry = await frame.locator('report-page').evaluate(element => {
                    const root = element.shadowRoot!;
                    const input = root.querySelector('wa-input')!.getBoundingClientRect();
                    const shelf = root.querySelector('report-shelf')!;
                    const row = shelf.shadowRoot!.querySelector('.items')!;
                    return {
                        inputBottom: input.bottom,
                        shelfBottom: shelf.getBoundingClientRect().bottom,
                        inputTop: input.top,
                        rowHeight: row.getBoundingClientRect().height,
                        overflow: row.scrollWidth > row.clientWidth,
                        pageWidth: root.querySelector('.page')!.getBoundingClientRect().width,
                        viewport: innerWidth,
                    };
                });
                assert(geometry.shelfBottom <= geometry.inputTop, 'Shelf stays above the input');
                assert(geometry.inputBottom <= 800, 'Input is in the viewport');
                assert(geometry.rowHeight < 70, 'Shelf is one bounded row');
                assert(geometry.pageWidth <= geometry.viewport, 'No horizontal page overflow');
                if (width === 390) assert(geometry.overflow, 'Narrow shelf scrolls sideways');
                assert.equal(
                    await frame.locator('.page').getAttribute('dir'),
                    language === 'ar' ? 'rtl' : 'ltr'
                );
                // The menu, by keyboard: it opens on the second prompt, moves it by what the
                // person sees (left is earlier in LTR, later in RTL), and keeps focus on it.
                const chips = shelf.locator('wa-button-group');
                const order = () =>
                    chips.evaluateAll(groups => groups.map(group => group.getAttribute('data-id')));
                const shown = await order();
                const trigger = chips.nth(1).locator('.options');
                const triggerBox = (await trigger.boundingBox())!;
                const promptBox = (await chips.nth(1).locator('.saved-prompt').boundingBox())!;
                assert(
                    Math.abs(triggerBox.height - promptBox.height) < 0.5 &&
                        Math.abs(triggerBox.y - promptBox.y) < 0.5,
                    'The menu button is the chip’s own segment, as tall as the prompt'
                );
                await trigger.focus();
                await page.keyboard.press('Enter');
                const menu = shelf.locator('wa-dropdown[open]');
                await menu.waitFor();
                assert.deepEqual(
                    await menu
                        .locator('wa-dropdown-item')
                        .evaluateAll(entries =>
                            entries.map(entry => [
                                entry.getAttribute('value'),
                                entry.hasAttribute('disabled'),
                            ])
                        ),
                    [
                        ['first', false],
                        [language === 'ar' ? 'later' : 'earlier', false],
                        [language === 'ar' ? 'earlier' : 'later', false],
                        ['remove', false],
                    ]
                );
                const menuBox = (await menu.locator('[part="menu"]').boundingBox())!;
                assert(menuBox.y + menuBox.height <= triggerBox.y + 1, 'The menu opens above');
                assert(menuBox.x >= 0 && menuBox.x + menuBox.width <= width, 'Menu fits');
                await page.waitForTimeout(250);
                await capture('menu');
                // The first enabled item has focus; one step down is "Move left".
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Enter');
                await menu.waitFor({ state: 'detached' });
                const expected =
                    language === 'ar'
                        ? [shown[0], shown[2], shown[1], ...shown.slice(3)]
                        : [shown[1], shown[0], ...shown.slice(2)];
                await panel.waitForFunction(
                    ids =>
                        JSON.stringify(
                            Array.from(
                                document
                                    .querySelector('report-app')!
                                    .shadowRoot!.querySelector('report-page')!
                                    .shadowRoot!.querySelector('report-shelf')!
                                    .shadowRoot!.querySelectorAll('wa-button-group')
                            ).map(group => group.getAttribute('data-id'))
                        ) === JSON.stringify(ids),
                    expected
                );
                assert.equal(
                    await panel.evaluate(
                        () =>
                            Array.from(
                                document
                                    .querySelector('report-app')!
                                    .shadowRoot!.querySelector('report-page')!
                                    .shadowRoot!.querySelector('report-shelf')!
                                    .shadowRoot!.querySelectorAll('wa-dropdown')
                            ).filter(menu => menu.shadowRoot!.querySelector('wa-popup[active]'))
                                .length
                    ),
                    0,
                    'The menu has closed before its chip moves'
                );
                const status = shelf.locator('[role="status"]');
                const position = language === 'ar' ? 3 : 1;
                const announced = await panel.evaluate(
                    ([lang, at, count]) => {
                        const number = new Intl.NumberFormat(lang);
                        return [number.format(at), number.format(count)];
                    },
                    [language, position, shown.length] as const
                );
                await status.filter({ hasText: announced[0] }).waitFor();
                assert((await status.textContent())!.includes(announced[1]));
                const focused = await panel.evaluate(() => {
                    let active: Element | null = document.activeElement;
                    const path: string[] = [];
                    while (active) {
                        path.push(active.localName);
                        const group = active.closest('wa-button-group');
                        if (group)
                            return {
                                id: group.getAttribute('data-id'),
                                control: active.closest('.options') ? 'options' : 'other',
                            };
                        active = active.shadowRoot?.activeElement ?? null;
                    }
                    return { id: null, control: path.join('>') };
                });
                assert.deepEqual(
                    focused,
                    { id: shown[1], control: 'options' },
                    'Focus stays on the moved prompt’s menu button'
                );
                await capture('moved');
                const remove = async () => {
                    await chips.first().locator('.options').click();
                    await shelf
                        .locator('wa-dropdown[open] wa-dropdown-item[value="remove"]')
                        .click();
                };
                await remove();
                await shelf.locator('[role="alert"]').waitFor();
                assert.equal(await shelf.locator('.saved-prompt').count(), 5);
                await capture('remove-error');
                await remove();
                await page.waitForTimeout(100);
                assert.equal(await shelf.locator('.saved-prompt').count(), 4);
                // Clear remains a separate usable control; Escape and viewport resize keep the input usable.
                await frame.locator('wa-input.prompt').locator('[part~="clear-button"]').click();
                assert.equal(await field.inputValue(), '');
                await field.fill('draft');
                await field.press('Escape');
                assert.equal(await field.inputValue(), '');
                await page.setViewportSize({ width, height: 500 });
                await panel.waitForFunction(() => {
                    const root = document
                        .querySelector('report-app')
                        ?.shadowRoot?.querySelector('report-page')?.shadowRoot;
                    return (
                        (root?.querySelector('wa-input')?.getBoundingClientRect().bottom ??
                            Infinity) <= innerHeight
                    );
                });
                assert((await field.boundingBox())!.y < 500);
                // The actual host font-scale listener still works in this embedded context.
                await page.evaluate(() =>
                    Reflect.get(
                        window,
                        'send'
                    )({ type: 'bkper:font-scale-changed', fontSizeScale: 1.25 })
                );
                await panel.waitForFunction(
                    () =>
                        document.documentElement.style.getPropertyValue('--wa-font-size-scale') ===
                        '1.25'
                );
                await capture('compact-viewport');
                writable = false;
                await panel.goto(panel.url());
                await shelf.locator('.saved-prompt').first().waitFor();
                assert.equal(await save.count(), 0);
                assert.equal(await shelf.locator('.options').count(), 0);
                await capture('read-only');
                assert.deepEqual(blocked, [], 'All external API traffic was mocked');
                assert.deepEqual(errors, [], 'No unexpected browser errors');
                console.log(
                    `PASS ${name}: shelf, Save/retry, saved clicks within and after a minute, menu move by keyboard, remove/retry from the menu, reload, read-only, input and viewport`
                );
                scenarios++;
                await context.close();
            }
    // Dragging prompts along the shelf, with motion and, at both widths, reduced motion.
    const dragLayouts: DragLayout[] = [];
    for (const width of [1100, 390])
        for (const theme of ['light', 'dark'] as const)
            for (const language of ['en', 'ar'] as const)
                dragLayouts.push({ width, theme, language, reducedMotion: false });
    dragLayouts.push(
        { width: 1100, theme: 'light', language: 'en', reducedMotion: true },
        { width: 390, theme: 'dark', language: 'ar', reducedMotion: true }
    );
    const dragFixture = fixtures.find(item => item.id === 'expenses-by-month');
    assert(dragFixture);
    const drags = { intervals: [] as number[], costs: [] as number[], settles: [] as number[] };
    for (const layout of dragLayouts) {
        const result = await verifyDrag(
            {
                browser,
                app: APP,
                host: HOST,
                themeUrl,
                themeScript,
                screenshots,
                report: {
                    spec: dragFixture.spec,
                    intent: dragFixture.intent,
                    language: dragFixture.lang,
                    query: 'mock-only',
                    dataAt: '2025-12-31T21:00:00Z',
                    chart: { kind: 'bar', fallback: false },
                    trace: {
                        facts: {
                            rows: 7,
                            negative: 0,
                            mixed: false,
                            months: 12,
                            previous: true,
                            net: false,
                            permanent: false,
                        },
                        chart: { fitting: ['bar', 'table'], main: 'bar', rule: 'rules' },
                    },
                    url: `${APP}/?book=fixture-book`,
                },
            },
            layout
        );
        drags.intervals.push(...result.intervals);
        drags.costs.push(...result.costs);
        drags.settles.push(...result.settles);
        screenshotCount += result.screenshots;
        scenarios++;
        console.log(
            `PASS ${result.name}: click/tap open, mouse and long-press drags open the gap where they land, Escape, leaving and re-entering, swipe scrolls, auto-scroll, rollback, menu, read-only; frames ${summarize(result.intervals)}, drop to settled ${summarize(result.settles)}`
        );
    }
    console.log(
        `Dragging: frame intervals ${summarize(drags.intervals)}; the drag's work per frame ${summarize(drags.costs)}; drop to settled ${summarize(drags.settles)}`
    );
    // A Book opened with nothing asked: each width, theme and language at least once.
    const autoOpenLayouts: AutoOpenLayout[] = [
        { width: 1100, theme: 'light', language: 'en' },
        { width: 1100, theme: 'dark', language: 'ar' },
        { width: 390, theme: 'dark', language: 'en' },
        { width: 390, theme: 'light', language: 'ar' },
    ];
    for (const layout of autoOpenLayouts) {
        const result = await verifyAutoOpen(
            { browser, app: APP, host: HOST, themeUrl, themeScript, screenshots, fixtures },
            layout
        );
        screenshotCount += result.screenshots;
        scenarios++;
        console.log(
            `PASS ${result.name}: the first saved prompt, else the first suggestion (also when the shelf fails), opens selected with the focus in the input and a keystroke replaces it; typing, a cleared request or a chip first wins; a request or a state in the URL opens alone (${result.cases} cases)`
        );
    }
    // Independent browser contexts share only the real saved-prompt service's isolated KV.
    // They do not share browser state, report caches or a mocked shelf response.
    const workflow = await savedWorkflow();
    const owner = workflow.session('browser-owner', 'OWNER');
    const editor = workflow.session('browser-editor', 'EDITOR');
    const collaborators = await Promise.all(
        [owner, editor].map(async session => {
            const context = await browser.newContext({
                viewport: { width: 1100, height: 800 },
                reducedMotion: 'reduce',
            });
            const errors: string[] = [];
            const prompts = { count: 0 };
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => {
                if (
                    message.type() === 'error' &&
                    !message.text().includes('403') &&
                    !message.text().includes('Blocked autofocusing')
                )
                    errors.push(message.text());
            });
            await context.route('**/*', async route => {
                const req = route.request();
                const url = new URL(req.url());
                if (req.url() === themeUrl)
                    return route.fulfill({ contentType: 'text/javascript', body: themeScript });
                if (url.origin === HOST)
                    return route.fulfill({
                        contentType: 'text/html',
                        body: `<!doctype html><html><body style="margin:0"><iframe title="Report in Book" src="${APP}/?book=fixture-a" style="border:0;width:100%;height:100dvh"></iframe></body></html>`,
                    });
                if (url.origin === APP && url.pathname === '/auth/refresh')
                    return route.fulfill({ json: { accessToken: 'fixture-only' } });
                if (url.origin === 'https://api.bkper.app') {
                    assert.equal(req.method(), 'GET', 'Financial data is read-only');
                    return route.fulfill({
                        json: {
                            id: 'fixture-a',
                            name: 'Isolated Studio',
                            permission: session.identity.permission,
                        },
                    });
                }
                if (url.origin === APP && url.pathname.startsWith('/api/')) {
                    if (url.pathname.endsWith('/report') && isPromptBody(req.postDataJSON()))
                        prompts.count++;
                    const response = await session.request(
                        new Request(req.url(), {
                            method: req.method(),
                            headers: { 'Content-Type': 'application/json' },
                            ...(req.postData() ? { body: req.postData()! } : {}),
                        })
                    );
                    return route.fulfill({
                        status: response.status,
                        headers: Object.fromEntries(response.headers),
                        body: await response.text(),
                    });
                }
                if (url.origin === APP && req.method() === 'GET') return route.continue();
                errors.push(`Unexpected network: ${req.method()} ${url.origin}${url.pathname}`);
                return route.abort();
            });
            await context.clock.install();
            await page.goto(`${HOST}/books/fixture-a/transactions?app=report`);
            const panel = page.frames().find(frame => frame.url().startsWith(APP));
            assert(panel);
            const frame = page.frameLocator('iframe');
            await frame.locator('report-suggestions wa-button').first().waitFor();
            return {
                context,
                page,
                panel,
                frame,
                shelf: frame.locator('report-shelf'),
                errors,
                prompts,
            };
        })
    );
    const [a, b] = collaborators;
    const captureWorkflow = async (name: string) => {
        await b.page.screenshot({ path: join(screenshots, `workflow-${name}.png`) });
        screenshotCount++;
    };
    const field = a.frame.locator('wa-input.prompt input');
    await field.fill(WORKFLOW_PROMPT);
    await field.press('Enter');
    await a.shelf.locator('.save:not([disabled])').waitFor();
    // A chart chosen after resolution is not part of the saved request.
    await a.frame.locator('report-view .preview').filter({ hasText: 'Ranked' }).click();
    await field.fill('Draft');
    await a.shelf.locator('.save').click();
    await a.shelf.locator('.saved-prompt').waitFor();
    await b.panel.goto(b.panel.url());
    await b.shelf.locator('.saved-prompt').waitFor();
    assert.equal(await b.shelf.locator('.saved-prompt').count(), 1);
    assert.deepEqual(
        workflow.savedValues().map(([, value]) => value),
        [JSON.stringify(WORKFLOW_PROMPT)]
    );
    const decisionStart = workflow.decisions.length;
    const open = async (month: string) => {
        const responsePromise = b.page.waitForResponse(
            response =>
                response.url().endsWith('/report') &&
                response.request().postDataJSON()?.prompt === WORKFLOW_PROMPT
        );
        await b.shelf.locator('.saved-prompt').click();
        const response = await responsePromise;
        assert.equal(response.status(), 200);
        const body = (await response.json()) as ReportResponse;
        assert(body.query.includes(`after:${month}-01`));
        await b.frame.locator('report-view').waitFor();
        return body;
    };
    /** A click within a minute of the last request shows that report again, asking nothing. */
    const reopen = async (shown: ReportResponse) => {
        const before = b.prompts.count;
        await b.shelf.locator('.saved-prompt').click();
        await b.page.waitForTimeout(100);
        assert.equal(b.prompts.count, before, 'A saved click within a minute asks nothing');
        const root = shown.spec.elements[shown.spec.root];
        assert(root?.type === 'Report');
        const subtitle = withoutIsolates(root.props.subtitle);
        assert(subtitle, 'The report names its period');
        await b.frame.locator('report-view').getByText(subtitle).first().waitFor();
    };
    const first = await open('2026-10');
    await reopen(first);
    await b.context.clock.fastForward(CACHE_MS);
    const october = await open('2026-10');
    await captureWorkflow('shared');
    workflow.advance();
    // Within the minute the click still shows October; afterwards the period rolls forward.
    await reopen(october);
    await b.context.clock.fastForward(CACHE_MS);
    await open('2026-11');
    assert.equal(
        workflow.decisions.length,
        decisionStart + 3,
        'Every click after a minute resolves the original prompt'
    );
    assert.deepEqual(
        workflow.decisions.slice(-3).map(item => item.state.today),
        ['2026-11-05', '2026-11-05', '2026-12-05']
    );
    await captureWorkflow('rolling-period');
    await b.panel.goto(`${APP}/?book=fixture-b`);
    await b.frame.locator('report-suggestions wa-button').first().waitFor();
    assert.equal(await b.shelf.locator('.saved-prompt').count(), 0);
    // With no saved prompt, the other Book opens on its first suggestion by itself.
    await b.frame.locator('report-view canvas').first().waitFor();
    assert.equal(
        await b.frame.locator('wa-input.prompt input').inputValue(),
        (await b.frame.locator('report-suggestions wa-button').first().textContent())?.trim()
    );
    await captureWorkflow('other-book');
    // Opened with nothing asked, the Book shows its first saved prompt by itself.
    const autoOpened = b.page.waitForResponse(
        response =>
            response.url().endsWith('/report') &&
            response.request().postDataJSON()?.prompt === WORKFLOW_PROMPT
    );
    await b.panel.goto(`${APP}/?book=fixture-a`);
    await b.shelf.locator('.saved-prompt').waitFor();
    assert.equal((await autoOpened).status(), 200);
    await b.frame.locator('report-view').waitFor();
    const removeSaved = async () => {
        await a.shelf.locator('.options').click();
        await a.shelf.locator('wa-dropdown[open] wa-dropdown-item[value="remove"]').click();
    };
    owner.identity.permission = 'VIEWER';
    await removeSaved();
    await a.shelf.locator('[role="alert"]').waitFor();
    assert.equal(await a.shelf.locator('.saved-prompt').count(), 1);
    await a.shelf.locator('.reload').click();
    await a.shelf.locator('.options').waitFor({ state: 'detached' });
    await a.page.screenshot({ path: join(screenshots, 'workflow-downgraded.png') });
    screenshotCount++;
    owner.identity.permission = 'EDITOR';
    await a.shelf.locator('.reload').click();
    await a.shelf.locator('.options').waitFor();
    await removeSaved();
    await a.shelf.locator('.saved-prompt').waitFor({ state: 'detached' });
    await b.panel.goto(b.panel.url());
    await b.frame.locator('report-suggestions wa-button').first().waitFor();
    assert.equal(await b.shelf.locator('.saved-prompt').count(), 0);
    await captureWorkflow('removed');

    // A name completed from the Book's names is what the report, the saved text and its
    // reopening by another collaborator are of.
    const NAMED_PROMPT = 'Food last month';
    await field.fill('');
    await field.pressSequentially('Fo');
    await a.frame.locator('[role="option"]').filter({ hasText: 'Food' }).first().waitFor();
    await a.page.screenshot({ path: join(screenshots, 'workflow-completion.png') });
    screenshotCount++;
    await field.press('Tab');
    assert.equal(await field.inputValue(), 'Food ', 'Tab writes the Book’s name and a space');
    assert.equal(await a.frame.locator('[role="option"]').count(), 0);
    const namedResponse = a.page.waitForResponse(
        response =>
            response.url().endsWith('/report') &&
            response.request().postDataJSON()?.prompt === NAMED_PROMPT
    );
    await field.pressSequentially('last month');
    await field.press('Enter');
    const named = (await (await namedResponse).json()) as ReportResponse;
    assert.deepEqual(named.intent, {
        root: 'g-expenses',
        target: 'a-food',
        period: 'last_month',
        monthly: false,
    });
    assert.equal(named.query, "account:'Food' after:2026-11-01 before:2026-12-01");
    await a.frame.locator('report-view').getByText('50.25').first().waitFor();
    await a.shelf.locator('.save:not([disabled])').click();
    await a.shelf.locator('.saved-prompt').waitFor();
    assert.deepEqual(
        workflow.savedValues().map(([, value]) => value),
        [JSON.stringify(NAMED_PROMPT)]
    );
    await b.panel.goto(b.panel.url());
    await b.shelf.locator('.saved-prompt').waitFor();
    const reopenedResponse = b.page.waitForResponse(
        response =>
            response.url().endsWith('/report') &&
            response.request().postDataJSON()?.prompt === NAMED_PROMPT
    );
    await b.shelf.locator('.saved-prompt').click();
    const reopened = (await (await reopenedResponse).json()) as ReportResponse;
    assert.deepEqual(reopened.intent, named.intent);
    assert.equal(reopened.query, named.query);
    await b.frame.locator('report-view').getByText('50.25').first().waitFor();
    await captureWorkflow('named-reopened');
    for (const collaborator of collaborators) {
        assert.deepEqual(collaborator.errors, [], 'No unexpected browser/network errors');
        await collaborator.context.close();
    }
    scenarios++;
    console.log(
        'PASS real route/service workflow: two browsers, shared reload/reopen, saved clicks within and after a minute, rolling dates, cross-Book isolation, downgrade and recovery, a completed name reported, saved and reopened'
    );
} finally {
    await browser.close();
}
console.log(`${scenarios} browser scenarios; ${screenshotCount} screenshots in ${screenshots}`);

function isPromptBody(body: unknown): boolean {
    return typeof body === 'object' && body !== null && 'prompt' in body;
}
