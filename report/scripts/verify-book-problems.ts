/**
 * Mock-only browser verification of what Report says when a Book's groups keep it from reports,
 * and of its link to the Bkper Agent. Run with the Vite client running:
 *     npx tsx scripts/verify-book-problems.ts [--screenshots=<directory>]
 * Screenshots: /tmp/report-book-problems.
 *
 * Each case (an empty Book and one with nothing to report on as Report opens, no net result and a
 * mixed group on a request; a Book a VIEWER cannot organize) shows in an expanded Book panel and
 * standalone, at 1100 and 390 px, light and dark. The API is stubbed; no Book is read. In the Book,
 * a click on the action must send exactly one `bkper:navigate` to the Book's Agent with the
 * request in `q` (none for an empty Book) and leave the panel; standalone, it must open the same
 * page in the same tab.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Frame, type Page } from 'playwright-core';
import type { BookProblem } from '../client/src/api/app-api.ts';

const APP = 'http://localhost:5207';
const HOST = 'https://bkper.app';
const BOOK = 'fixture-book';
const screenshots =
    process.argv.find(arg => arg.startsWith('--screenshots='))?.split('=')[1] ??
    '/tmp/report-book-problems';

interface Case {
    name: string;
    problem: BookProblem;
    /** A request that hits the problem; none for a problem of the whole Book, shown on opening. */
    request?: string;
    /** The action's label and the request it puts in the Agent's input; none for no action. */
    action?: { label: string; q?: string };
    text: string;
}

const BASE = { bookName: 'Mock Studio', canOrganize: true };
const CASES: Case[] = [
    {
        name: 'empty-book',
        problem: { ...BASE, code: 'empty_book' },
        action: { label: 'Get started with Agent' },
        text: 'This Book has no transactions yet',
    },
    {
        name: 'nothing-to-report',
        problem: { ...BASE, code: 'nothing_to_report', ungrouped: 1204, total: 1530 },
        action: {
            label: 'Organize with Agent',
            q: 'My Book "Mock Studio" has nothing to report on: 1,204 of its 1,530 accounts with transactions are in no group. Help me organize them into groups for reports, such as a balance sheet and an income statement. Change groups only, not transactions.',
        },
        text: '1,204 of its 1,530 accounts',
    },
    {
        name: 'nothing-to-report-viewer',
        problem: {
            ...BASE,
            canOrganize: false,
            code: 'nothing_to_report',
            ungrouped: 9,
            total: 12,
        },
        text: "Ask the Book's owner to organize its groups.",
    },
    {
        name: 'no-net-result',
        problem: {
            ...BASE,
            code: 'no_net_result',
            incoming: ['Revenue'],
            outgoing: ['Expenses', 'Team costs'],
            shared: [],
        },
        request: 'net result this year',
        action: {
            label: 'Organize with Agent',
            q: 'My Book "Mock Studio" has no net result: no group combines Revenue and Expenses and Team costs. Help me organize its groups so income and expenses meet in one group. Change groups only, not transactions.',
        },
        text: 'This Book has no net result',
    },
    {
        name: 'mixed-group',
        problem: { ...BASE, code: 'mixed_group', group: 'Everything we own and spend' },
        request: 'everything this year',
        action: {
            label: 'Organize with Agent',
            q: 'In my Book "Mock Studio", the group Everything we own and spend combines balances (Asset, Liability) with activity (Incoming, Outgoing). Help me separate them into their own groups. Change groups only, not transactions.',
        },
        text: 'Everything we own and spend',
    },
];

const themeUrl =
    'https://cdn.jsdelivr.net/npm/@bkper/web-components@0.2.0/dist/theme-init.global.js';
const themeResponse = await fetch(themeUrl);
assert(themeResponse.ok, 'The shared first-paint theme script is available');
const themeScript = await themeResponse.text();
await mkdir(screenshots, { recursive: true });

/** The Agent's page in the Book, with `q` when given. */
function agentPage(q?: string): string {
    const url = new URL(`/books/${BOOK}/transactions`, HOST);
    url.searchParams.set('app', 'bkper-agent');
    if (q) url.searchParams.set('q', q);
    return url.href;
}

function appUrl(request?: string): string {
    const url = new URL('/', APP);
    url.searchParams.set('book', BOOK);
    if (request) url.searchParams.set('q', request);
    return url.href;
}

const browser = await chromium.launch({
    headless: true,
    args: ['--disable-features=LocalNetworkAccessChecks'],
});
let scenarios = 0;
try {
    for (const width of [1100, 390])
        for (const theme of ['light', 'dark'] as const)
            for (const embedded of [true, false])
                for (const item of CASES) {
                    const name = `${item.name}-${embedded ? 'book' : 'standalone'}-${width}-${theme}`;
                    const context = await browser.newContext({
                        viewport: { width, height: 700 },
                        colorScheme: theme,
                        reducedMotion: 'reduce',
                    });
                    // Standalone, the theme Bkper's apps share; in the Book, the Book's message.
                    await context.addCookies([{ name: 'bkper_theme', value: theme, url: APP }]);
                    const page = await context.newPage();
                    const errors: string[] = [];
                    page.on('pageerror', error => errors.push(error.message));
                    page.on('console', message => {
                        if (
                            message.type() === 'error' &&
                            !message.text().includes('422') &&
                            !message.text().includes('Blocked autofocusing')
                        )
                            errors.push(message.text());
                    });
                    await route(page, item, theme);
                    await scenario(page, item, embedded, name);
                    assert.deepEqual(errors, [], `${name}: no errors`);
                    await context.close();
                    scenarios++;
                }
} finally {
    await browser.close();
}
console.log(`${scenarios} scenarios; screenshots in ${screenshots}`);

async function scenario(page: Page, item: Case, embedded: boolean, name: string): Promise<void> {
    const start = embedded ? `${HOST}/books/${BOOK}/transactions?app=report` : appUrl(item.request);
    await page.goto(start);
    const frame = embedded ? await panel(page) : page.mainFrame();
    const problem = frame.locator('report-page .problem');
    await problem.waitFor();
    assert.equal(await frame.locator('report-page .notice').count(), 1, `${name}: one message`);
    assert.match(await problem.innerText(), new RegExp(escape(item.text)), `${name}: message`);
    await page.screenshot({ path: join(screenshots, `${name}.png`) });
    const action = problem.locator('wa-button');
    if (!item.action) {
        assert.equal(await action.count(), 0, `${name}: no action for a VIEWER`);
        return;
    }
    assert.equal((await action.innerText()).trim(), item.action.label, `${name}: label`);
    const expected = agentPage(item.action.q);
    assert.equal(await action.getAttribute('href'), expected, `${name}: link`);
    assert.equal(
        await action.getAttribute('target'),
        embedded ? '_blank' : null,
        `${name}: same tab standalone, a new one in a Book until it navigates`
    );
    // The action fits the narrowest panel.
    const box = await action.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= page.viewportSize()!.width, `${name}: fits`);
    await action.click();
    if (embedded) {
        await page.waitForFunction(() => (window as unknown as { sent: unknown[] }).sent.length);
        await page.waitForTimeout(100);
        const sent = await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent);
        assert.deepEqual(sent, [{ type: 'bkper:navigate', url: expected }], `${name}: navigate`);
        assert.equal(page.url(), `${HOST}/books/${BOOK}/transactions?app=report`, `${name}: stays`);
    } else {
        await page.waitForURL(url => url.origin === HOST);
        assert.equal(page.url(), expected, `${name}: opens the Agent in the same tab`);
    }
}

/** The Report app in the Book's panel, once the Book told it what it accepts. */
async function panel(page: Page): Promise<Frame> {
    await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready);
    const frame = page.frames().find(candidate => candidate.url().startsWith(APP));
    assert(frame, 'The panel loads the app');
    return frame;
}

async function route(page: Page, item: Case, theme: 'light' | 'dark'): Promise<void> {
    await page.context().route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
        if (req.url() === themeUrl)
            return route.fulfill({ contentType: 'text/javascript', body: themeScript });
        if (url.origin === HOST && url.searchParams.get('app') === 'bkper-agent')
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html>Agent' });
        if (url.origin === HOST)
            return route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><html><body style="margin:0"><iframe title="Report in Book" src="${appUrl(item.request)}" style="border:0;width:100%;height:100dvh"></iframe><script>
    window.sent = [];
    const panel = document.querySelector('iframe');
    window.addEventListener('message', event => {
        if (event.source === panel.contentWindow && event.data?.type === 'bkper:navigate') window.sent.push(event.data);
    });
    panel.onload = () => {
        panel.contentWindow.postMessage({type:'bkper:host-ready',supports:['navigate','app-state']}, '${APP}');
        panel.contentWindow.postMessage({type:'bkper:theme-changed',theme:'${theme}'}, '${APP}');
        window.ready = true;
    };
</script></body></html>`,
            });
        if (url.origin === APP && url.pathname === '/auth/refresh')
            return json({ accessToken: 'mock-only-token' });
        if (url.origin === 'https://api.bkper.app') {
            assert.equal(req.method(), 'GET', 'No writes');
            return json({ id: BOOK, name: 'Mock Studio', permission: 'OWNER' });
        }
        if (url.origin === APP && url.pathname.startsWith('/api/')) {
            const path = url.pathname;
            const whole = !item.request;
            if (path.endsWith('/suggestions'))
                return json(
                    whole
                        ? { suggestions: [], problem: item.problem }
                        : { suggestions: ['Expenses by month'] }
                );
            if (path.endsWith('/names')) return json({ names: [] });
            if (path.endsWith('/prompts') && req.method() === 'GET')
                return json({
                    prompts: [],
                    capabilities: { list: true, save: false, remove: false, move: false },
                });
            if (path.endsWith('/report'))
                return json(
                    {
                        success: false,
                        error: { code: item.problem.code, message: 'Mock problem' },
                        problem: item.problem,
                    },
                    422
                );
            throw new Error(`Unmocked API: ${req.method()} ${path}`);
        }
        if (url.origin === APP && req.method() === 'GET') return route.continue();
        return route.abort();
    });
}

function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
