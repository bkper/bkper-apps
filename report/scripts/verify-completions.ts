/**
 * Browser verification of completing the Book's names in the request input, in an expanded
 * Book panel. Run with the Vite client running: npx tsx scripts/verify-completions.ts
 * Screenshots: /tmp/report-completions (override with --screenshots=<directory>).
 *
 * The API is stubbed with a made-up Book of 25,000 multilingual names (and, once, 25,000 names
 * all alike, where every keystroke matches every name); no Book, Worker or KV is read. At
 * desktop and phone widths, light and dark, English and Arabic, it times every keystroke that
 * should show names, from the key to the frame after the names show, and checks the list opens
 * above the input and the shelf, never over them; the combobox's accessible state; the agreed
 * keys (Tab and click or tap accept, ↑/↓ browse, Enter accepts only a highlighted name and
 * otherwise runs the report, Escape dismisses before it clears); insertion at the caret that
 * keeps the rest of the request; several names; an input method composing; the debounce still
 * asking for reports; and the saved shelf and the clear button staying usable.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { BookName, ReportResponse } from '../client/src/api/app-api.ts';
import { NameIndex } from '../shared/src/name-index.ts';
import { t } from '../shared/src/strings.ts';
import { addAllLocales } from '../shared/src/locales.ts';

const APP = 'http://localhost:5207';
const HOST = 'https://bkper.app';
const SIZE = 25_000;
const BUDGET_MS = 50;
const screenshots =
    process.argv.find(arg => arg.startsWith('--screenshots='))?.split('=')[1] ??
    '/tmp/report-completions';
addAllLocales();

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

const DEMO: BookName[] = [
    { id: 'g-despesas', name: 'Despesas', kind: 'group', root: 'g-despesas' },
    { id: 'g-dividas', name: 'Dívidas', kind: 'group', root: 'g-dividas' },
    { id: 'g-masrufat', name: 'المصروفات', kind: 'group', root: 'g-masrufat' },
    { id: 'a-refeicoes', name: 'Refeições', kind: 'account', root: 'g-despesas' },
    { id: 'a-card', name: 'Credit Card', kind: 'account', root: 'g-dividas' },
    { id: 'a-rawatib', name: 'الرواتب', kind: 'account', root: 'g-masrufat' },
];
const WORDS = [
    'Água',
    'Energia',
    'Aluguel',
    'Conta',
    'corrente',
    'Cartão',
    'crédito',
    'Импорт',
    'Налоги',
    'Salários',
    'Fornecedor',
    'Café',
    'Ônibus',
    'Seguro',
    'Rent',
    'Food',
    'Travel',
    'Office',
    'Bank',
    'Fees',
    'Taxes',
    'Empréstimo',
    'Poupança',
    'Projeto',
    '費用',
    '食費',
    '工资',
    'الإيجار',
    'Größe',
    'Λογαριασμός',
    'Tiền',
    'Şirket',
];

/** A deterministic pseudo-random number generator, so every run types the same. */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
    };
}

/** A made-up Book of `SIZE` names, the demo names first; a fifth are groups. */
function madeUpNames(): BookName[] {
    const next = random(SIZE);
    const pick = () => WORDS[Math.floor(next() * WORDS.length)];
    const names: BookName[] = [...DEMO];
    let root = 'g0';
    for (let i = names.length; i < SIZE; i++) {
        const words = Array.from({ length: 1 + Math.floor(next() * 3) }, pick);
        const group = i % 5 === 0;
        const id = `${group ? 'g' : 'a'}${i}`;
        if (group && i % 50 === 0) root = id;
        names.push({
            id,
            name: `${words.join(' ')} ${i}`,
            kind: group ? 'group' : 'account',
            root,
        });
    }
    return names;
}

function alikeNames(): BookName[] {
    return Array.from({ length: SIZE }, (_, i) => ({
        id: `a${i}`,
        name: `Conta corrente ${i}`,
        kind: 'account',
        root: 'g0',
    }));
}

const BOOKS = { madeUp: madeUpNames(), alike: alikeNames() };
const INDEXES = { madeUp: new NameIndex(BOOKS.madeUp), alike: new NameIndex(BOOKS.alike) };

/** Requests typed key by key, to time each keystroke that should show names. */
function typedRequests(book: keyof typeof BOOKS, language: string): string[] {
    if (book === 'alike') return ['despesas da conta corrente 1234 em 2026'];
    const next = random(7);
    const requests =
        language === 'ar'
            ? ['تقرير المصروفات حسب الشهر', 'الرواتب و Credit Card']
            : ['despesas de refeições e credit card em 2026'];
    for (let i = 0; i < 3; i++) {
        const name = BOOKS.madeUp[Math.floor(next() * BOOKS.madeUp.length)].name;
        requests.push(`report ${name.split(' ').slice(0, 2).join(' ').toLowerCase()} 2026`);
    }
    return requests;
}

function percentile(sorted: number[], p: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    args: ['--disable-features=LocalNetworkAccessChecks'],
});
const allTimings: number[] = [];
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
                    hasTouch: width < 600,
                });
                // tsx names functions with a helper the browser lacks; the probes below need it.
                await context.addInitScript('globalThis.__name = (target) => target;');
                const page = await context.newPage();
                const errors: string[] = [];
                const blocked: string[] = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('console', message => {
                    if (
                        message.type() === 'error' &&
                        !message.text().includes('Blocked autofocusing')
                    )
                        errors.push(message.text());
                });
                const fixture = fixtures.find(item => item.id === 'expenses-by-month');
                assert(fixture);
                const response: ReportResponse = {
                    spec: fixture.spec,
                    intent: fixture.intent,
                    language: fixture.lang,
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
                };
                const saved = language === 'ar' ? 'المصروفات هذا الشهر' : 'Expenses this year';
                const prompts: string[] = [];
                let book: keyof typeof BOOKS = 'madeUp';
                /** Wait for the last report asked for to be of `prompt`. */
                const asked = async (prompt: string, message: string) => {
                    const started = Date.now();
                    while (prompts.at(-1) !== prompt && Date.now() - started < 2000)
                        await new Promise(resolve => setTimeout(resolve, 20));
                    assert.equal(prompts.at(-1), prompt, message);
                };
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
                        return json({
                            id: 'fixture-book',
                            name: 'Mock Studio',
                            permission: 'OWNER',
                        });
                    }
                    if (url.origin === APP && url.pathname.startsWith('/api/')) {
                        const path = url.pathname;
                        if (path.endsWith('/suggestions')) return json({ suggestions: [] });
                        if (path.endsWith('/names')) return json({ names: BOOKS[book] });
                        if (path.endsWith('/report')) {
                            const body: unknown = req.postDataJSON();
                            if (typeof body === 'object' && body && 'prompt' in body)
                                prompts.push(String(body.prompt));
                            return json(response);
                        }
                        if (path.endsWith('/reports') && req.method() === 'GET')
                            return json({
                                reports: [{ id: 'a'.repeat(64), prompt: saved }],
                                capabilities: { list: true, save: true, remove: true },
                            });
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
                const listbox = frame.locator('[role="listbox"]');
                const option = frame.locator('[role="option"]');
                const capture = async (state: string) => {
                    await page.screenshot({ path: join(screenshots, `${name}-${state}.png`) });
                    screenshotCount++;
                };
                await shelf.locator('.saved-prompt').waitFor();
                const panel = page.frames().find(candidate => candidate.url().startsWith(APP));
                assert(panel);
                await panel.waitForFunction(
                    expected => document.documentElement.style.colorScheme === expected,
                    theme
                );
                const namesLoaded = () =>
                    panel.waitForFunction(
                        size => reportPage()?.state.names.index.size === size,
                        INDEXES[book].size
                    );
                await panel.evaluate(installProbes);
                await namesLoaded();

                // Every keystroke that should show names, timed from the key to the frame after.
                const time = async (requests: string[]) => {
                    const timings: number[] = [];
                    for (const request of requests) {
                        await field.fill('');
                        let typed = '';
                        for (const character of request) {
                            typed += character;
                            const first = INDEXES[book].complete(typed, typed.length)[0]?.text;
                            if (first) await panel.evaluate(arm, { first, value: typed });
                            await page.keyboard.type(character);
                            if (!first) continue;
                            timings.push(await panel.evaluate(() => latency()));
                        }
                        assert.equal(await field.inputValue(), request);
                    }
                    return timings;
                };
                const timings = await time(typedRequests(book, language));
                assert(timings.length >= 20, `Enough keystrokes timed: ${timings.length}`);
                if (scenarios === 0) {
                    book = 'alike';
                    await panel.goto(panel.url());
                    await shelf.locator('.saved-prompt').waitFor();
                    await panel.evaluate(installProbes);
                    await namesLoaded();
                    timings.push(...(await time(typedRequests(book, language))));
                    book = 'madeUp';
                    await panel.goto(panel.url());
                    await shelf.locator('.saved-prompt').waitFor();
                    await panel.evaluate(installProbes);
                    await namesLoaded();
                }
                timings.sort((a, b) => a - b);
                allTimings.push(...timings);
                const slowest = timings[timings.length - 1];
                assert(
                    slowest < BUDGET_MS,
                    `Every keystroke shows its names within ${BUDGET_MS} ms (slowest ${slowest.toFixed(1)} ms)`
                );

                // The list opens above the input and the shelf, as a combobox's listbox.
                await field.fill('');
                await page.keyboard.type(
                    language === 'ar' ? 'تقرير المص' : 'despesas com credit ca'
                );
                await listbox.waitFor();
                const expectedName = language === 'ar' ? 'المصروفات' : 'Credit Card';
                const expectedKind = t(
                    language === 'ar' ? 'completion_group' : 'completion_account',
                    language
                );
                assert.equal(await option.first().locator('.name').textContent(), expectedName);
                assert.equal(
                    (await option.first().locator('.kind').textContent())?.trim(),
                    expectedKind
                );
                assert.equal(
                    await listbox.getAttribute('aria-label'),
                    t('completion_label', language)
                );
                const combobox = await panel.evaluate(describeCombobox);
                assert.deepEqual(combobox, {
                    role: 'combobox',
                    autocomplete: 'list',
                    expanded: 'true',
                    controls: true,
                    active: null,
                });
                const geometry = await panel.evaluate(measure);
                assert(geometry.listBottom <= geometry.dockTop + 0.5, 'Opens above the dock');
                assert(
                    geometry.listBottom <= geometry.shelfTop + 0.5,
                    'Leaves the shelf uncovered'
                );
                assert(geometry.listBottom <= geometry.inputTop, 'Never covers the input');
                assert(geometry.listTop >= 0, 'Fits in the panel');
                assert(geometry.listLeft >= 0 && geometry.listRight <= geometry.viewport + 0.5);
                if (language === 'ar')
                    assert(
                        Math.abs(geometry.listRight - geometry.inputRight) <= 2,
                        `Starts where the input starts, on the right (${JSON.stringify(geometry)})`
                    );
                else
                    assert(
                        Math.abs(geometry.listLeft - geometry.inputLeft) <= 2,
                        `Starts where the input starts (${JSON.stringify(geometry)})`
                    );
                const snapshot = await frame.locator('report-page').ariaSnapshot();
                assert.match(snapshot, /combobox/, 'Exposed as a combobox');
                assert.match(snapshot, /listbox/, 'With its listbox');
                assert(snapshot.includes(expectedName), 'Whose options name the Book’s names');
                await capture('open');

                // ↓ highlights; Enter accepts only then, at the caret, and the debounce asks.
                await page.keyboard.press('ArrowDown');
                assert.equal((await panel.evaluate(describeCombobox)).active, expectedName);
                await capture('highlighted');
                const before = prompts.length;
                await page.keyboard.press('Enter');
                const completed =
                    language === 'ar' ? 'تقرير المصروفات ' : 'despesas com Credit Card ';
                assert.equal(await field.inputValue(), completed);
                assert.equal(await panel.evaluate(caret), completed.length);
                assert.equal(await listbox.isVisible(), false);
                assert.equal((await panel.evaluate(describeCombobox)).expanded, 'false');
                assert.equal(prompts.length, before, 'Accepting a name runs nothing at once');
                await asked(completed.trim(), 'The debounce asks for its report');

                // Several names, the second in the middle, keeping the rest exactly.
                await page.keyboard.type('e refei');
                await listbox.waitFor();
                await page.keyboard.press('Tab');
                const two = `${completed}e Refeições `;
                assert.equal(await field.inputValue(), two);
                // In right-to-left text, the arrow to the left moves the caret forward.
                const [word, middleName, forward] =
                    language === 'ar'
                        ? ['الروا', 'الرواتب', 'ArrowLeft']
                        : ['refei', 'Refeições', 'ArrowRight'];
                const rest = ' e Cash  em 2026, #viagem';
                await field.fill(word + rest);
                await page.keyboard.press('Home');
                for (let i = 0; i < word.length; i++) await page.keyboard.press(forward);
                await listbox.waitFor();
                await page.keyboard.press('Tab');
                assert.equal(await field.inputValue(), middleName + rest);
                assert.equal(await panel.evaluate(caret), middleName.length);

                // Enter with nothing highlighted runs the report, as before.
                await field.fill('');
                await page.keyboard.type('despesas e credit ca');
                await listbox.waitFor();
                await page.keyboard.press('Enter');
                await asked('despesas e credit ca', 'Enter runs the report');
                assert.equal(await field.inputValue(), 'despesas e credit ca');
                assert.equal(await listbox.isVisible(), false);

                // Escape dismisses the names first, then clears the request.
                await page.keyboard.type('r');
                await page.keyboard.press('Backspace');
                await listbox.waitFor();
                await page.keyboard.press('Escape');
                assert.equal(await listbox.isVisible(), false);
                assert.equal(await field.inputValue(), 'despesas e credit ca');
                await page.keyboard.press('Escape');
                assert.equal(await field.inputValue(), '');

                // A click, or a tap on phones, accepts and keeps the focus (and the keyboard).
                await page.keyboard.type('despesas com refei');
                await listbox.waitFor();
                await capture('typing');
                const refeicoes = option.filter({ hasText: 'Refeições' }).first();
                if (width < 600) await refeicoes.tap();
                else await refeicoes.click();
                assert.equal(await field.inputValue(), 'despesas com Refeições ');
                assert.equal(await panel.evaluate(focusedInput), true, 'The input keeps the focus');

                // An input method composing shows nothing until it commits.
                const session = await page
                    .context()
                    .newCDPSession(panel)
                    .catch(() => page.context().newCDPSession(page));
                await field.fill('despesas e credit ');
                await session.send('Input.imeSetComposition', {
                    text: 'ca',
                    selectionStart: 2,
                    selectionEnd: 2,
                });
                await page.waitForTimeout(50);
                assert.equal(await field.inputValue(), 'despesas e credit ca');
                assert.equal(await listbox.isVisible(), false, 'Nothing while composing');
                await session.send('Input.insertText', { text: 'ca' });
                await listbox.waitFor();
                assert.equal(await option.first().locator('.name').textContent(), 'Credit Card');
                await session.detach();

                // The clear button and the saved shelf stay usable while names show.
                await frame.locator('wa-input.prompt').locator('[part~="clear-button"]').click();
                assert.equal(await field.inputValue(), '');
                assert.equal(await listbox.isVisible(), false);
                await page.keyboard.type('despesas com credit ca');
                await listbox.waitFor();
                const count = prompts.length;
                await shelf.locator('.saved-prompt').click();
                await asked(saved, 'The saved prompt runs');
                assert.equal(await field.inputValue(), saved);
                assert(prompts.length > count);
                assert.equal(await listbox.isVisible(), false);
                await frame.locator('report-view').waitFor();
                await field.focus();
                await page.keyboard.press('End');
                await page.keyboard.type(language === 'ar' ? ' الروا' : ' refei');
                await listbox.waitFor();
                await capture('over-report');

                assert.deepEqual(blocked, [], 'All external API traffic was mocked');
                assert.deepEqual(errors, [], 'No unexpected browser errors');
                const sorted = timings;
                console.log(
                    `PASS ${name}: ${sorted.length} keystrokes p50 ${percentile(sorted, 50).toFixed(1)} ms, p95 ${percentile(sorted, 95).toFixed(1)} ms, max ${slowest.toFixed(1)} ms${scenarios === 0 ? ' (25,000 made-up names, and 25,000 alike)' : ''}; geometry, a11y, keys, caret, IME, tap/click, shelf and clear`
                );
                scenarios++;
                await context.close();
            }
} finally {
    await browser.close();
}
allTimings.sort((a, b) => a - b);
console.log(
    `${scenarios} scenarios; ${allTimings.length} keystrokes with ${SIZE.toLocaleString('en')} names: p50 ${percentile(allTimings, 50).toFixed(1)} ms, p95 ${percentile(allTimings, 95).toFixed(1)} ms, max ${allTimings[allTimings.length - 1].toFixed(1)} ms; ${screenshotCount} screenshots in ${screenshots}`
);

// In the panel's page: reach the report page, and time keystrokes to the frame after names show.
declare global {
    interface Window {
        pendingLatency?: Promise<number>;
    }
}
declare function reportPage(): HTMLElementTagNameMap['report-page'] | undefined;
declare function latency(): Promise<number>;

function installProbes(): void {
    Object.assign(window, {
        reportPage: () =>
            document.querySelector('report-app')?.shadowRoot?.querySelector('report-page') ??
            undefined,
        latency: () => window.pendingLatency ?? Promise.reject(new Error('Not armed')),
    });
}

/** Wait for the next key (or text inserted without one) to show `first` first, for `value`. */
function arm({ first, value }: { first: string; value: string }): void {
    window.pendingLatency = new Promise<number>(resolve => {
        let started: number | undefined;
        const start = (event: Event) => {
            if (started !== undefined) return;
            started = event.timeStamp;
            document.removeEventListener('keydown', start, true);
            document.removeEventListener('beforeinput', start, true);
            const check = () => {
                const root = reportPage()?.shadowRoot;
                const input = root?.querySelector('wa-input')?.input;
                const list = root?.querySelector('[role="listbox"]');
                const shown = list?.querySelector('[role="option"] .name')?.textContent;
                const visible = (list?.getBoundingClientRect().height ?? 0) > 0;
                // The frame being drawn shows them: resolve once it has been.
                if (input?.value === value && shown === first && visible)
                    requestAnimationFrame(() => resolve(performance.now() - (started ?? 0)));
                else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        };
        document.addEventListener('keydown', start, true);
        document.addEventListener('beforeinput', start, true);
    });
}

function describeCombobox() {
    const root = reportPage()?.shadowRoot;
    const input = root?.querySelector('wa-input')?.input;
    const list = root?.querySelector('[role="listbox"]');
    return {
        role: input?.getAttribute('role'),
        autocomplete: input?.getAttribute('aria-autocomplete'),
        expanded: input?.getAttribute('aria-expanded'),
        controls: !!list && input?.ariaControlsElements?.[0] === list,
        active: input?.ariaActiveDescendantElement?.querySelector('.name')?.textContent ?? null,
    };
}

function measure() {
    const root = reportPage()?.shadowRoot;
    const rect = (selector: string) => {
        const element = root?.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        return element.getBoundingClientRect();
    };
    const list = rect('[role="listbox"]');
    const input = rect('wa-input');
    return {
        listTop: list.top,
        listBottom: list.bottom,
        listLeft: list.left,
        listRight: list.right,
        dockTop: rect('.dock').top,
        shelfTop: rect('report-shelf').top,
        inputTop: input.top,
        inputLeft: input.left,
        inputRight: input.right,
        viewport: innerWidth,
    };
}

function caret(): number | null {
    return reportPage()?.shadowRoot?.querySelector('wa-input')?.input.selectionStart ?? null;
}

function focusedInput(): boolean {
    const root = reportPage()?.shadowRoot;
    const field = root?.querySelector('wa-input');
    return (
        !!field && root?.activeElement === field && field.shadowRoot?.activeElement === field.input
    );
}
