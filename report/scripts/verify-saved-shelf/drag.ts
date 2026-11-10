/**
 * Dragging saved prompts along the shelf, in the real client in an expanded Book panel, with
 * a mouse and a finger (Chrome DevTools Protocol touch events). Every request is stubbed; no
 * Book or KV is read or written. Called by verify-saved-shelf.ts.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Browser, CDPSession, Frame, Page } from 'playwright-core';
import type { ReportResponse, SavedPrompt } from '../../client/src/api/app-api.ts';

export interface DragLayout {
    width: number;
    theme: 'light' | 'dark';
    language: 'en' | 'ar';
    reducedMotion: boolean;
}

export interface DragEnvironment {
    browser: Browser;
    app: string;
    host: string;
    themeUrl: string;
    themeScript: string;
    screenshots: string;
    report: ReportResponse;
}

export interface DragResult {
    name: string;
    /** rAF intervals while dragging, by mouse and by finger. */
    intervals: number[];
    /** Time spent in the controller's frame function, each frame. */
    costs: number[];
    /** From the release to the frame where every chip is set down. */
    settles: number[];
    screenshots: number;
}

const PROMPTS = {
    en: [
        'Cash today',
        'Receitas por mês',
        '日本語の収入',
        'Expenses this year by month with every account broken down',
        'المصروفات هذا الشهر',
        'Net result last quarter',
        'Revenue versus last year',
    ],
    ar: [
        'النقد اليوم',
        'الإيرادات حسب الشهر',
        '日本語の収入',
        'المصروفات هذا العام حسب الشهر مع تفاصيل كل حساب',
        'Cash today',
        'صافي النتيجة للربع الماضي',
        'الإيرادات مقارنة بالعام الماضي',
    ],
};

/** Helpers in every frame: the shelf's geometry, and records of a drag. */
const HELPERS = `(() => {
    globalThis.__name = target => target;
    const page = () => document.querySelector('report-app')?.shadowRoot?.querySelector('report-page')?.shadowRoot;
    const shelf = () => page()?.querySelector('report-shelf');
    const chips = () => [...(shelf()?.shadowRoot?.querySelectorAll('.items > wa-button-group[data-id]') ?? [])];
    globalThis.__opened = [];
    addEventListener('report-open-saved', event => globalThis.__opened.push(event.detail), true);
    addEventListener('pointerup', event => (globalThis.__upAt = event.timeStamp), true);
    globalThis.__animations = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
        if (this.matches?.('wa-button-group[data-id]')) globalThis.__animations++;
        return animate.apply(this, args);
    };
    globalThis.__geometry = () => {
        const row = shelf().shadowRoot.querySelector('.items');
        const box = row.getBoundingClientRect();
        const input = page().querySelector('wa-input').getBoundingClientRect();
        const style = getComputedStyle(row);
        return {
            ids: chips().map(chip => chip.dataset.id),
            chips: chips().map(chip => {
                const rect = chip.getBoundingClientRect();
                const prompt = chip.querySelector('.saved-prompt').getBoundingClientRect();
                return {
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    x: prompt.left + prompt.width / 2,
                    y: prompt.top + prompt.height / 2,
                    transform: chip.style.transform,
                    transition: getComputedStyle(chip).transitionDuration,
                    lifted: chip.hasAttribute('data-lifted'),
                    animations: chip.getAnimations().length,
                };
            }),
            row: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
            scrollLeft: row.scrollLeft,
            overflow: row.scrollWidth > row.clientWidth + 1,
            dragging: row.hasAttribute('data-dragging'),
            dir: style.direction,
            gap: parseFloat(style.columnGap),
            padding: parseFloat(style.paddingLeft),
            input: { top: input.top, left: input.left, bottom: input.bottom },
            status: shelf().shadowRoot.querySelector('[role="status"]')?.textContent?.trim() ?? '',
            alert: !!shelf().shadowRoot.querySelector('[role="alert"]'),
            open: !!shelf().shadowRoot.querySelector('wa-dropdown[open]'),
        };
    };
    globalThis.__record = () => {
        const record = { frames: [], costs: [], renders: 0, attributes: new Set(), childList: 0 };
        let on = true;
        const loop = time => {
            record.frames.push(time);
            if (on) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        const host = shelf();
        const update = host.performUpdate;
        host.performUpdate = function () {
            record.renders++;
            return update.call(this);
        };
        const drag = host.drag;
        const frame = drag.frame;
        drag.frame = function (...args) {
            const start = performance.now();
            frame.apply(this, args);
            record.costs.push(performance.now() - start);
        };
        const observer = new MutationObserver(list => {
            for (const change of list) {
                if (change.type !== 'attributes') record.childList++;
                else if (change.attributeName !== 'class') record.attributes.add(change.attributeName);
                else {
                    // Web Awesome's button group marks the hovered and focused button itself.
                    const before = new Set((change.oldValue ?? '').split(' ').filter(Boolean));
                    const after = new Set(change.target.className.split(' ').filter(Boolean));
                    const changed = [...before, ...after].filter(token => before.has(token) !== after.has(token));
                    if (changed.some(token => token !== 'button-hover' && token !== 'button-focus'))
                        record.attributes.add('class');
                }
            }
        });
        observer.observe(host.shadowRoot, { subtree: true, attributes: true, attributeOldValue: true, childList: true, characterData: true });
        globalThis.__stop = () => {
            on = false;
            observer.disconnect();
            delete host.performUpdate;
            delete drag.frame;
            const frames = record.frames;
            return {
                intervals: frames.slice(1).map((time, at) => time - frames[at]),
                costs: record.costs,
                renders: record.renders,
                attributes: [...record.attributes],
                childList: record.childList,
            };
        };
    };
    /** Resolves on the first frame where every chip is set down, with the time since the release. */
    globalThis.__settled = () =>
        new Promise(resolve => {
            const check = () => {
                const row = shelf().shadowRoot.querySelector('.items');
                const done =
                    !row.hasAttribute('data-dragging') &&
                    chips().every(chip => !chip.hasAttribute('data-lifted') && !chip.style.transform && chip.getAnimations().length === 0);
                if (done) resolve(performance.now() - globalThis.__upAt);
                else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        });
})();`;

type Geometry = {
    ids: string[];
    chips: {
        left: number;
        right: number;
        top: number;
        bottom: number;
        x: number;
        y: number;
        transform: string;
        transition: string;
        lifted: boolean;
        animations: number;
    }[];
    row: { left: number; right: number; top: number; bottom: number };
    scrollLeft: number;
    overflow: boolean;
    dragging: boolean;
    dir: string;
    gap: number;
    padding: number;
    input: { top: number; left: number; bottom: number };
    status: string;
    alert: boolean;
    open: boolean;
};

type Recorded = {
    intervals: number[];
    costs: number[];
    renders: number;
    attributes: string[];
    childList: number;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const center = (chip: { left: number; right: number }) => (chip.left + chip.right) / 2;

/**
 * Where the gap the others opened is, read from what is on screen: the id the dragged chip
 * will land before (`null`: the end), checking the gap is its width.
 */
function landing(start: Geometry, now: Geometry, id: string): string | null {
    const from = start.ids.indexOf(id);
    const width = start.chips[from].right - start.chips[from].left;
    const content = (geometry: Geometry, x: number) => x + geometry.scrollLeft;
    const first = Math.min(...start.chips.map(chip => content(start, chip.left)));
    const last = Math.max(...start.chips.map(chip => content(start, chip.right)));
    const others = now.ids
        .map((other, at) => ({
            id: other,
            start: content(now, now.chips[at].left),
            end: content(now, now.chips[at].right),
        }))
        .filter(other => other.id !== id)
        .sort((a, b) => a.start - b.start);
    const holes = [
        others[0].start - first,
        ...others.slice(1).map((other, at) => other.start - others[at].end - now.gap),
        last - others.at(-1)!.end,
    ];
    const open = holes.flatMap((hole, at) => (hole > 1.5 ? [{ hole, at }] : []));
    assert.equal(open.length, 1, `One gap opens: ${holes.map(hole => hole.toFixed(1))}`);
    assert(
        Math.abs(open[0].hole - (width + now.gap)) < 1.5,
        `The gap is the dragged chip’s width: ${open[0].hole} vs ${width + now.gap}`
    );
    const reading = now.dir === 'rtl' ? [...others].reverse() : others;
    const index = now.dir === 'rtl' ? others.length - open[0].at : open[0].at;
    return reading[index]?.id ?? null;
}

function percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

export function summarize(values: number[]): string {
    return `p50 ${percentile(values, 0.5).toFixed(1)}, p95 ${percentile(values, 0.95).toFixed(1)}, max ${Math.max(...values).toFixed(1)} ms`;
}

export async function verifyDrag(env: DragEnvironment, layout: DragLayout): Promise<DragResult> {
    const { width, theme, language, reducedMotion } = layout;
    const name = `drag-${width}-${theme}-${language}${reducedMotion ? '-reduced' : ''}`;
    const context = await env.browser.newContext({
        viewport: { width, height: 800 },
        locale: language,
        colorScheme: theme,
        reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
        hasTouch: true,
    });
    await context.addInitScript(HELPERS);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (
            message.type() === 'error' &&
            !message.text().includes('502') &&
            !message.text().includes('Blocked autofocusing')
        )
            errors.push(message.text());
    });
    let items: SavedPrompt[] = PROMPTS[language].map((prompt, index) => ({
        id: String(index + 1).repeat(64),
        prompt,
    }));
    const moves: { id: string; before: string | null }[] = [];
    let failNext = false;
    let movable = true;
    await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
        if (req.url() === env.themeUrl)
            return route.fulfill({ contentType: 'text/javascript', body: env.themeScript });
        if (url.origin === env.host)
            return route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><html><body style="margin:0"><iframe title="Report in Book" src="${env.app}/?book=fixture-book" style="border:0;width:100%;height:100dvh"></iframe><script>
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
            if (path.endsWith('/suggestions')) return json({ suggestions: [] });
            if (path.endsWith('/names')) return json({ names: [] });
            if (path.endsWith('/report')) return json(env.report);
            const capabilities = { list: true, save: true, remove: true, move: movable };
            if (path.endsWith('/prompts') && req.method() === 'GET')
                return json({ prompts: items, capabilities });
            if (path.endsWith('/position') && req.method() === 'PUT') {
                const id = path.split('/').at(-2)!;
                const { before } = req.postDataJSON() as { before: string | null };
                moves.push({ id, before });
                if (failNext) {
                    failNext = false;
                    await sleep(300);
                    return json(
                        { success: false, error: { code: 'storage_error', message: 'Mock' } },
                        502
                    );
                }
                const item = items.find(entry => entry.id === id);
                assert(item, 'Moves only a prompt on the shelf');
                const rest = items.filter(entry => entry !== item);
                const at = before === null ? rest.length : rest.findIndex(e => e.id === before);
                assert(at !== -1, 'Moves before a prompt on the shelf');
                items = [...rest.slice(0, at), item, ...rest.slice(at)];
                return json({ prompts: items, capabilities });
            }
            throw new Error(`Unmocked API: ${req.method()} ${path}`);
        }
        if (url.origin === env.app && req.method() === 'GET') return route.continue();
        errors.push(`Unexpected network: ${req.method()} ${url.origin}${url.pathname}`);
        return route.abort();
    });
    await page.goto(`${env.host}/books/fixture-book/transactions?app=report`);
    const frameLocator = page.frameLocator('iframe');
    await frameLocator.locator('report-shelf .saved-prompt').nth(6).waitFor();
    // Opened with nothing asked, the Book shows its first saved prompt.
    await frameLocator.locator('report-view').waitFor();
    const panel = page.frames().find(frame => frame.url().startsWith(env.app));
    assert(panel);
    await panel.waitForFunction(
        expected => document.documentElement.style.colorScheme === expected,
        theme
    );
    const touch = await context.newCDPSession(page);
    const geometry = () =>
        panel.evaluate(() => Reflect.get(globalThis, '__geometry')() as Geometry);
    const opened = () =>
        panel.evaluate(() => [...(Reflect.get(globalThis, '__opened') as string[])]);
    const animations = () =>
        panel.evaluate(() => Reflect.get(globalThis, '__animations') as number);
    const settled = () =>
        panel.evaluate(() => Reflect.get(globalThis, '__settled')() as Promise<number>);
    const record = () => panel.evaluate(() => Reflect.get(globalThis, '__record')());
    const stop = () => panel.evaluate(() => Reflect.get(globalThis, '__stop')() as Recorded);
    let shots = 0;
    const capture = async (state: string, shelfOnly = true) => {
        const now = await geometry();
        const top = Math.max(0, now.row.top - 48);
        await page.screenshot({
            path: join(env.screenshots, `${name}-${state}.png`),
            ...(shelfOnly
                ? {
                      clip: {
                          x: 0,
                          y: top,
                          width,
                          height: Math.min(800, now.input.bottom + 12) - top,
                      },
                  }
                : {}),
        });
        shots++;
    };
    const finger = {
        down: (x: number, y: number) =>
            touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }),
        move: (x: number, y: number) =>
            touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }),
        up: () => touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    };
    const mouse = {
        down: async (x: number, y: number) => {
            await page.mouse.move(x, y);
            await page.mouse.down();
        },
        move: (x: number, y: number) => page.mouse.move(x, y),
        up: () => page.mouse.up(),
    };
    /** Move a pressed pointer to (x, y) about 6 px a frame, as a hand does. */
    const glide = async (
        pointer: typeof mouse | typeof finger,
        from: { x: number; y: number },
        to: { x: number; y: number },
        step = 6
    ) => {
        const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
        for (let at = 1; at <= count; at++) {
            await pointer.move(
                from.x + ((to.x - from.x) * at) / count,
                from.y + ((to.y - from.y) * at) / count
            );
            await sleep(16);
        }
    };
    const sign = language === 'ar' ? -1 : 1;
    const scrollToStart = async () => {
        await panel.evaluate(() => {
            const row = document
                .querySelector('report-app')!
                .shadowRoot!.querySelector('report-page')!
                .shadowRoot!.querySelector('report-shelf')!
                .shadowRoot!.querySelector('.items')!;
            row.scrollLeft = 0;
        });
        await sleep(100);
    };
    const intervals: number[] = [];
    const costs: number[] = [];
    const settles: number[] = [];
    /** The chip `from` dragged until its center passes the center of the chip `past`. */
    const target = (now: Geometry, from: number, past: number) => ({
        x:
            now.chips[from].x +
            center(now.chips[past]) -
            center(now.chips[from]) +
            (past > from ? sign : -sign) * 14,
        y: now.chips[from].y,
    });

    /**
     * Drag the second chip to the first place with `pointer`, recording frames, then check the
     * gap, the drop, the settle and that no report opened. The row is at its start, so it can
     * only scroll there if the finger pans it. Returns the new order.
     */
    const dragToFirst = async (pointer: 'mouse' | 'finger', state: string) => {
        await scrollToStart();
        const start = await geometry();
        assert(Math.abs(start.scrollLeft) <= 1);
        const id = start.ids[1];
        const grab = { x: start.chips[1].x, y: start.chips[1].y };
        const end = target(start, 1, 0);
        const before = start.ids[0];
        await record();
        if (pointer === 'mouse') await mouse.down(grab.x, grab.y);
        else {
            await finger.down(grab.x, grab.y);
            await sleep(450);
            assert((await geometry()).chips[1].lifted, 'A long press picks the chip up');
        }
        await glide(pointer === 'mouse' ? mouse : finger, grab, end);
        const recorded = await stop();
        intervals.push(...recorded.intervals.slice(1));
        costs.push(...recorded.costs);
        assert.equal(recorded.renders, 0, 'The shelf does not render while dragging');
        assert.equal(recorded.childList, 0, 'Nothing is added or removed while dragging');
        assert.deepEqual(
            recorded.attributes.filter(
                attribute =>
                    !['style', 'data-dragging', 'data-lifted', 'data-away'].includes(attribute)
            ),
            [],
            'Only transforms change while dragging'
        );
        await sleep(250);
        const now = await geometry();
        assert(now.dragging && now.chips[1].lifted, 'The chip is lifted');
        // It follows the pointer, drawn whole inside the row.
        const width = start.chips[1].right - start.chips[1].left;
        const drawn = Math.min(
            Math.max(start.chips[1].left + end.x - grab.x, start.row.left + start.padding),
            start.row.right - start.padding - width
        );
        assert(Math.abs(now.chips[1].left - drawn) < 1.5, 'The lifted chip follows the pointer');
        assert(
            now.chips[1].left >= now.row.left - 0.5 && now.chips[1].right <= now.row.right + 0.5,
            'The lifted chip shows whole'
        );
        assert(Math.abs(now.chips[1].top - start.chips[1].top) < 0.5, 'Along the row');
        assert.equal(landing(start, now, id), before, 'The gap is where it lands');
        assert.deepEqual(now.input, start.input, 'The input never moves');
        // At its start already, the row cannot scroll there; Chrome may round 1 px in RTL.
        assert(Math.abs(now.scrollLeft - start.scrollLeft) <= 1, 'The finger does not pan the row');
        await capture(state);
        const count = moves.length;
        await (pointer === 'mouse' ? mouse.up() : finger.up());
        const time = await settled();
        settles.push(time);
        assert.deepEqual(moves.slice(count), [{ id, before }], 'Drops where the gap was');
        const expected = [id, start.ids[0], ...start.ids.slice(2)];
        await panel.waitForFunction(
            ids => JSON.stringify(Reflect.get(globalThis, '__geometry')().ids) === ids,
            JSON.stringify(expected)
        );
        assert.deepEqual((await geometry()).input, start.input, 'The input never moves');
        return expected;
    };

    // A plain click, a click that wobbles less than the drag distance, and a tap open reports.
    // Apart, as the page skips a report's view transition when the next starts too soon.
    let shown = await geometry();
    assert.equal(shown.dir, language === 'ar' ? 'rtl' : 'ltr');
    await page.mouse.click(shown.chips[1].x, shown.chips[1].y);
    await sleep(600);
    await mouse.down(shown.chips[0].x, shown.chips[0].y);
    await mouse.move(shown.chips[0].x + 2 * sign, shown.chips[0].y + 1);
    await mouse.up();
    await sleep(600);
    await finger.down(shown.chips[1].x, shown.chips[1].y);
    await sleep(60);
    await finger.up();
    await sleep(600);
    assert.deepEqual(await opened(), [shown.ids[1], shown.ids[0], shown.ids[1]], 'Clicks open');
    assert.equal(moves.length, 0);
    await capture('initial', false);

    // A mouse drag, then a finger after a long press.
    const order = await dragToFirst('mouse', 'mouse');
    shown = await geometry();
    assert(shown.status.length > 0, 'The move is announced');
    await dragToFirst('finger', 'finger');
    assert.equal((await opened()).length, 3, 'A drag opens no report');

    // Escape puts the chip back; releasing it afterwards clicks nothing, and a click still opens.
    shown = await geometry();
    const count = moves.length;
    await mouse.down(shown.chips[1].x, shown.chips[1].y);
    await glide(mouse, shown.chips[1], target(shown, 1, 0));
    await sleep(200);
    assert((await geometry()).chips[0].transform !== '', 'The gap moved');
    await page.keyboard.press('Escape');
    await settled();
    let now = await geometry();
    assert.deepEqual(now.ids, shown.ids);
    assert(now.chips.every(chip => !chip.lifted && !chip.transform));
    await mouse.up();
    await sleep(100);
    assert.equal((await opened()).length, 3, 'Releasing after Escape opens nothing');
    await page.mouse.click(shown.chips[0].x, shown.chips[0].y);
    await sleep(100);
    assert.deepEqual((await opened()).slice(3), [shown.ids[0]], 'A later click opens');

    // Leaving the row closes the gap where the chip was; releasing there puts it back.
    await mouse.down(shown.chips[1].x, shown.chips[1].y);
    const away = target(shown, 1, 0);
    await glide(mouse, shown.chips[1], away);
    const height = shown.row.bottom - shown.row.top;
    await glide(mouse, away, { x: away.x, y: shown.row.top - 2.5 * height });
    await sleep(250);
    now = await geometry();
    assert(now.chips[1].lifted, 'Still lifted outside the row');
    assert(
        now.chips.every((chip, at) => at === 1 || !chip.transform),
        'The gap closes back where the chip was'
    );
    assert(
        Math.abs(now.chips[1].left + now.scrollLeft - shown.chips[1].left - shown.scrollLeft) < 0.5,
        'The chip shows back in its place'
    );
    await capture('leaving');
    // Back in the row, it follows the pointer again, and leaving again puts it back.
    await glide(mouse, { x: away.x, y: shown.row.top - 2.5 * height }, away);
    await sleep(250);
    now = await geometry();
    assert(now.chips[0].transform !== '', 'Back in the row, the gap opens again');
    assert(Math.abs(now.chips[1].left - shown.chips[1].left) > 20, 'It follows the pointer');
    await glide(mouse, away, { x: away.x, y: shown.row.bottom + 2.5 * height });
    await sleep(250);
    now = await geometry();
    assert(now.chips.every((chip, at) => at === 1 || !chip.transform));
    await mouse.up();
    await settled();
    assert.deepEqual((await geometry()).ids, shown.ids);
    assert.equal(moves.length, count, 'Escape and leaving move nothing');
    assert.equal((await opened()).length, 4, 'Releasing outside opens nothing');

    // A swipe scrolls the row, picking nothing up and opening nothing.
    shown = await geometry();
    if (width < 600) assert(shown.overflow, 'The narrow row scrolls');
    if (shown.overflow) {
        const from = { x: shown.chips[0].x, y: shown.chips[0].y };
        await finger.down(from.x, from.y);
        for (let at = 1; at <= 8; at++) {
            await finger.move(from.x - sign * 25 * at, from.y);
            await sleep(16);
        }
        await finger.up();
        await sleep(400);
        now = await geometry();
        assert(Math.abs(now.scrollLeft - shown.scrollLeft) > 80, 'The swipe scrolled the row');
        assert(now.chips.every(chip => !chip.lifted && !chip.transform));
        assert.equal(moves.length, count, 'A swipe moves nothing');
        assert.equal((await opened()).length, 4, 'A swipe opens nothing');
        await scrollToStart();

        // Held near the row's end, a dragged chip scrolls it, and lands where the gap is.
        shown = await geometry();
        const id = shown.ids[0];
        const edge = {
            x: language === 'ar' ? shown.row.left + 6 : shown.row.right - 6,
            y: shown.chips[0].y,
        };
        await mouse.down(shown.chips[0].x, shown.chips[0].y);
        await glide(mouse, shown.chips[0], edge, 12);
        await sleep(900);
        now = await geometry();
        assert(Math.abs(now.scrollLeft - shown.scrollLeft) > 100, 'Auto-scrolled');
        const inside = { x: edge.x - sign * 90, y: edge.y };
        await glide(mouse, edge, inside);
        await sleep(300);
        now = await geometry();
        const before = landing(shown, now, id);
        await capture('auto-scroll');
        await mouse.up();
        settles.push(await settled());
        assert.deepEqual(moves.at(-1), { id, before }, 'Lands where the gap was');
        await sleep(100);
        now = await geometry();
        assert(now.ids.indexOf(id) >= 2, 'Carried along the row');
        assert.equal((await opened()).length, 4);
    }

    // A failed move slides back to the order the shelf had, and says so.
    await scrollToStart();
    shown = await geometry();
    const animated = await animations();
    failNext = true;
    await mouse.down(shown.chips[1].x, shown.chips[1].y);
    await glide(mouse, shown.chips[1], target(shown, 1, 0));
    await sleep(200);
    await mouse.up();
    await sleep(60);
    assert.deepEqual(
        (await geometry()).ids,
        [shown.ids[1], shown.ids[0], ...shown.ids.slice(2)],
        'Shown in its new place at once'
    );
    const slidBack = await animations();
    await frameLocator.locator('report-shelf [role="alert"]').waitFor();
    await settled();
    now = await geometry();
    assert.deepEqual(now.ids, shown.ids, 'Restored after the failure');
    if (reducedMotion) {
        assert.equal(await animations(), animated, 'Reduced motion slides nothing');
    } else {
        assert((await animations()) > slidBack, 'The failed move slides back');
    }
    await capture('rollback');

    const moved = moves.length + 1;
    // The menu still opens and moves; pressing its button never drags.
    shown = await geometry();
    const options = frameLocator
        .locator('report-shelf wa-button-group')
        .first()
        .locator('.options');
    const box = (await options.boundingBox())!;
    await mouse.down(box.x + box.width / 2, box.y + box.height / 2);
    await glide(
        mouse,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        {
            x: box.x + box.width / 2 + sign * 12,
            y: box.y + box.height / 2,
        }
    );
    assert(!(await geometry()).chips.some(chip => chip.lifted), 'The menu button never drags');
    await mouse.up();
    await page.keyboard.press('Escape');
    await options.click();
    await frameLocator.locator('report-shelf wa-dropdown[open]').waitFor();
    await sleep(250);
    await capture('menu', false);
    await frameLocator.locator('report-shelf wa-dropdown[open] [value="later"]').click();
    await panel.waitForFunction(
        ids => JSON.stringify(Reflect.get(globalThis, '__geometry')().ids) === ids,
        JSON.stringify([shown.ids[1], shown.ids[0], ...shown.ids.slice(2)])
    );
    if (reducedMotion) {
        // Without motion the others jump aside, with no transition.
        shown = await geometry();
        await mouse.down(shown.chips[1].x, shown.chips[1].y);
        await glide(mouse, shown.chips[1], target(shown, 1, 0));
        await sleep(50);
        now = await geometry();
        assert(
            now.chips.every(chip => chip.transition === '0s'),
            'Nothing slides'
        );
        await page.keyboard.press('Escape');
        await mouse.up();
        await settled();
    }
    // Without the right to move, nothing drags, and a press still opens its report.
    movable = false;
    await panel.goto(panel.url());
    await frameLocator.locator('report-shelf .saved-prompt').nth(6).waitFor();
    await frameLocator.locator('report-view').waitFor();
    await sleep(600);
    shown = await geometry();
    const before = (await opened()).length;
    await mouse.down(shown.chips[1].x, shown.chips[1].y);
    await glide(mouse, shown.chips[1], target(shown, 1, 0));
    await sleep(200);
    now = await geometry();
    assert(!now.dragging && now.chips.every(chip => !chip.lifted && !chip.transform), 'No drag');
    await mouse.up();
    await page.mouse.click(shown.chips[1].x, shown.chips[1].y);
    await sleep(100);
    assert.deepEqual((await opened()).slice(before), [shown.ids[1]], 'A click opens');
    assert.equal(moves.length, moved, 'Nothing moves without the right to');
    assert(order.length === PROMPTS[language].length);
    assert.deepEqual(errors, [], 'No unexpected browser errors');
    await context.close();
    return { name, intervals, costs, settles, screenshots: shots };
}
