/**
 * Mock-only browser verification of the saved-prompt shelf in an expanded Book panel.
 * Run with the Vite client running: npx tsx scripts/verify-saved-shelf.ts
 * Screenshots: /tmp/report-saved-shelf (override with --screenshots=<directory>).
 * Eight layout scenarios stub the API; a two-collaborator scenario bridges the browsers
 * to real app routes/services with isolated KV, snapshots and decision responses.
 * Every auth and Bkper request is intercepted; no real Book or KV is accessed.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { ReportResponse, SavedPrompt } from '../client/src/api/app-api.ts';
import { savedWorkflow, WORKFLOW_PROMPT } from './fixtures/saved-workflow.ts';

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
                        if (path.endsWith('/report')) {
                            requested.push(req.postDataJSON());
                            return json(response);
                        }
                        if (path.endsWith('/reports') && req.method() === 'GET')
                            return json({
                                reports: items,
                                capabilities: { list: true, save: writable, remove: writable },
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
                await savedPrompt.click();
                await page.waitForTimeout(100);
                await savedPrompt.click();
                await page.waitForTimeout(100);
                assert.deepEqual(
                    requested.slice(-2),
                    [{ prompt: prompt.trim() }, { prompt: prompt.trim() }],
                    'Each saved click makes a fresh prompt request'
                );
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
                const remove = shelf.locator('.remove').first();
                await remove.click();
                await shelf.locator('[role="alert"]').waitFor();
                assert.equal(await shelf.locator('.saved-prompt').count(), 5);
                await capture('remove-error');
                await remove.click();
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
                assert.equal(await shelf.locator('.remove').count(), 0);
                await capture('read-only');
                assert.deepEqual(blocked, [], 'All external API traffic was mocked');
                assert.deepEqual(errors, [], 'No unexpected browser errors');
                console.log(
                    `PASS ${name}: shelf, Save/retry, fresh clicks, remove/retry, reload, read-only, input and viewport`
                );
                scenarios++;
                await context.close();
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
            await page.goto(`${HOST}/books/fixture-a/transactions?app=report`);
            const panel = page.frames().find(frame => frame.url().startsWith(APP));
            assert(panel);
            const frame = page.frameLocator('iframe');
            await frame.locator('report-suggestions wa-button').first().waitFor();
            return { context, page, panel, frame, shelf: frame.locator('report-shelf'), errors };
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
    await open('2026-10');
    await open('2026-10');
    await captureWorkflow('shared');
    workflow.advance();
    await open('2026-11');
    assert.equal(
        workflow.decisions.length,
        decisionStart + 3,
        'Every click resolves the original prompt'
    );
    assert.deepEqual(
        workflow.decisions.slice(-3).map(item => item.state.today),
        ['2026-11-05', '2026-11-05', '2026-12-05']
    );
    await captureWorkflow('rolling-period');
    await b.panel.goto(`${APP}/?book=fixture-b`);
    await b.frame.locator('report-suggestions wa-button').first().waitFor();
    assert.equal(await b.shelf.locator('.saved-prompt').count(), 0);
    await captureWorkflow('other-book');
    await b.panel.goto(`${APP}/?book=fixture-a`);
    await b.shelf.locator('.saved-prompt').waitFor();
    await open('2026-11');
    owner.identity.permission = 'VIEWER';
    await a.shelf.locator('.remove').click();
    await a.shelf.locator('[role="alert"]').waitFor();
    assert.equal(await a.shelf.locator('.saved-prompt').count(), 1);
    await a.shelf.locator('.reload').click();
    await a.shelf.locator('.remove').waitFor({ state: 'detached' });
    await a.page.screenshot({ path: join(screenshots, 'workflow-downgraded.png') });
    screenshotCount++;
    owner.identity.permission = 'EDITOR';
    await a.shelf.locator('.reload').click();
    await a.shelf.locator('.remove').waitFor();
    await a.shelf.locator('.remove').click();
    await a.shelf.locator('.saved-prompt').waitFor({ state: 'detached' });
    await b.panel.goto(b.panel.url());
    await b.frame.locator('report-suggestions wa-button').first().waitFor();
    assert.equal(await b.shelf.locator('.saved-prompt').count(), 0);
    await captureWorkflow('removed');
    for (const collaborator of collaborators) {
        assert.deepEqual(collaborator.errors, [], 'No unexpected browser/network errors');
        await collaborator.context.close();
    }
    scenarios++;
    console.log(
        'PASS real route/service workflow: two browsers, shared reload/reopen, fresh prompt clicks, rolling dates, cross-Book isolation, downgrade and recovery'
    );
} finally {
    await browser.close();
}
console.log(`${scenarios} browser scenarios; ${screenshotCount} screenshots in ${screenshots}`);
