/**
 * Opens report files in headless Chromium exactly as the Bkper Agent shows a published HTML
 * file, and checks they work there with no network.
 *
 *     npx tsx scripts/verify-report-file.ts [--screenshots=<dir>] [--width=900] [<file.html> ...]
 *
 * Without files, it writes one report file per recorded spec (`client/dev/specs/*.json`) with
 * the built bundle (run `npm run build:report-file` first); with files, such as one saved from
 * the API (`format: "html"`), it opens those (without the live-reload script `bkper app dev`
 * appends to HTML). Each opens in light and dark in the Agent's frame:
 * an `<iframe sandbox="allow-scripts">` whose `srcdoc` is the file after the Agent's
 * `<!doctype html>` and Content-Security-Policy, styled as the Agent styles it, while every
 * request is blocked. It checks there are no requests, no policy violations and no console
 * errors; that the answer, the chart and the link to the Report app show; that a net result
 * Report calculated is labelled so in the Source, and nothing else is; that the Source is one
 * line, its Details closed until opened and the link at its end; that a row opens
 * in place; that values written into texts, such as dates, read in the report's direction;
 * that a click on a chart's preview shows that chart in place of the main one, with no network,
 * and the link then opens it (the time each switch takes is reported); that previews sit beside
 * the title, level with it, in a report as wide as the Book's panel, and stay above the chart, at the same position even when its height changes, with no Table card and with
 * keyboard access even for table-only reports; and that the link asks
 * the Agent to open the report in the Report app in the Book (`bkper:navigate`) only after the
 * Agent's `bkper:host-ready` and a click, and stays a plain link before. `--screenshots` saves
 * a picture of each. Needs Playwright's Chromium headless
 * shell (`npx playwright-core install chromium-headless-shell`).
 */
import { mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { chromium, type Frame, type Page } from 'playwright-core';
import { validateReportSpec } from '../shared/src/catalog.ts';
import type { ViewKind } from '../shared/src/catalog.ts';
import type { ReportFileData } from '../shared/src/report-file.ts';
import { supportedLanguage } from '../shared/src/languages.ts';
import { reportText } from '../shared/src/report-text.ts';
import { decodeUrlState } from '../shared/src/url-state.ts';
import { buildReportFile, reportFileOpen } from '../server/src/services/report-file.ts';

/** The Agent's frame policy and document (bkper-clients `packages/agent`, `file-views.ts`). */
const HTML_VIEW_POLICY =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
    "font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

function sandboxedHtml(text: string): string {
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${HTML_VIEW_POLICY}">${text}`;
}

/** Where the Agent runs, served here, so the file's frame hears messages from its real origin. */
const AGENT_URL = 'https://agent.bkper.app/';

/** The Bkper the Agent names in its `bkper:host-ready` to the file. */
const BKPER_ORIGIN = 'https://bkper.app';

/**
 * The Agent's HTML view: its frame fills the panel, on a light page (`html-css.ts`). It records
 * the messages of the file's frame and whether the person was in the frame then, as the Agent
 * checks (`file-host.ts`). A string: tsx would wrap a function's inner functions in a helper.
 */
const HOST_PAGE = `<!doctype html><html><head><style>
    html, body { height: 100%; margin: 0; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: white; color-scheme: light; }
</style></head><body><iframe sandbox="allow-scripts" title="report.html"></iframe><script>
    window.fileMessages = [];
    window.addEventListener('message', event => {
        const frame = document.querySelector('iframe');
        if (event.source !== frame.contentWindow) return;
        const focused = document.activeElement === frame && document.hasFocus();
        window.fileMessages.push({ data: event.data, focused });
    });
</script></body></html>`;

/** The Agent shows HTML files up to this size; larger ones only download. */
const MAX_TEXT_VIEW_BYTES = 1024 * 1024;

/** Tall enough for whole reports, so screenshots need no scrolling. */
const VIEWPORT = { width: 900, height: 2400 };

/** Chart.js animates for 1 s by default. */
const CHART_ANIMATION_MS = 1200;

const SPEC_FILES = ['client/dev/specs/studio.json', 'client/dev/specs/ledger.json'];

const LINK = { url: 'https://report.bkper.app/?book=book-1&q=report', label: 'Open in Report' };

/** The Book of every recorded file, whose state is its report's own text, in its language. */
const OPEN_BOOK_ID = 'book-1';

interface ReportFile {
    name: string;
    html: string;
}

interface Result {
    name: string;
    scheme: 'light' | 'dark';
    bytes: number;
    failures: string[];
    darkTheme: boolean;
    /** How long showing a chosen chart took, from the click to its first frame. */
    switchMs?: number;
    heightChange?: number;
}

const args = process.argv.slice(2);
const screenshots = args.find(arg => arg.startsWith('--screenshots='))?.split('=')[1];
const paths = args.filter(arg => !arg.startsWith('--'));
const width = Number(args.find(arg => arg.startsWith('--width='))?.split('=')[1] ?? VIEWPORT.width);
if (!Number.isFinite(width) || width < 320) {
    throw new Error('--width must be a finite number of at least 320');
}
const viewport = { ...VIEWPORT, width };

async function recordedFiles(): Promise<ReportFile[]> {
    const files: ReportFile[] = [];
    for (const path of SPEC_FILES) {
        const entries = JSON.parse(await readFile(path, 'utf8')) as { id: string; spec: unknown }[];
        for (const entry of entries) {
            const validation = validateReportSpec(entry.spec);
            if (!validation.valid) {
                throw new Error(
                    `Invalid recorded spec ${entry.id}: ${validation.issues.join('; ')}`
                );
            }
            const choices = Object.values(validation.spec.elements).find(
                element => element.type === 'Visualizations'
            );
            const report = validation.spec.elements[validation.spec.root];
            const locale = report?.type === 'Report' ? report.props.locale : 'en';
            const open = reportFileOpen(OPEN_BOOK_ID, {
                prompt: reportText(validation.spec),
                language: supportedLanguage(locale) ?? 'en',
                charts:
                    choices?.type === 'Visualizations'
                        ? {
                              fitting: choices.props.views.map(view => view.kind),
                              main: choices.props.main,
                          }
                        : { fitting: [], main: 'table' },
            });
            files.push({
                name: entry.id,
                html: buildReportFile(validation.spec, { link: LINK, ...(open ? { open } : {}) }),
            });
        }
    }
    return files;
}

/**
 * `bkper app dev` (Miniflare) appends a live-reload script to every HTML response; deployed
 * Workers do not, so files saved from the local Worker are checked without it.
 */
const DEV_RELOAD =
    /\n?<script defer type="application\/javascript">\s*\(function \(\) \{\s*\/\/ Miniflare Live Reload[\s\S]*?<\/script>\s*$/;

async function givenFiles(): Promise<ReportFile[]> {
    return Promise.all(
        paths.map(async path => {
            const html = await readFile(path, 'utf8');
            if (DEV_RELOAD.test(html)) {
                console.log(`${basename(path)}: left out the live-reload script of bkper app dev`);
            }
            return { name: basename(path), html: html.replace(DEV_RELOAD, '\n') };
        })
    );
}

/** Opens a file in the Agent's frame, and the frame once it has rendered the report. */
async function open(page: Page, file: ReportFile): Promise<Frame> {
    await page.goto(AGENT_URL);
    await page.evaluate(srcdoc => {
        const frame = document.querySelector('iframe');
        if (frame) {
            frame.srcdoc = srcdoc;
        }
    }, sandboxedHtml(file.html));
    const handle = await page.waitForSelector('iframe');
    let frame: Frame | null = null;
    for (let tries = 0; !frame && tries < 50; tries++) {
        frame = await handle.contentFrame();
        if (frame?.url() !== 'about:srcdoc') {
            frame = null;
            await page.waitForTimeout(20);
        }
    }
    if (!frame) {
        throw new Error('The frame did not load');
    }
    await frame.waitForLoadState('load');
    return frame;
}

async function check(page: Page, frame: Frame): Promise<string[]> {
    const failures: string[] = [];
    // One answer per Answer of the spec: several for targets side by side, each its own.
    const answer = frame.locator('report-view .answer-amount');
    await answer.first().waitFor({ timeout: 5000 });
    const answers = await frame.evaluate(() => {
        const data = document.getElementById('report-data')?.textContent ?? '{}';
        const spec = JSON.parse(data) as { spec?: { elements?: Record<string, { type: string }> } };
        return Object.values(spec.spec?.elements ?? {}).filter(element => element.type === 'Answer')
            .length;
    });
    const amounts = await answer.allTextContents();
    if (amounts.length !== answers || amounts.some(text => !/\p{Nd}/u.test(text))) {
        failures.push(`${amounts.length} answers show amounts, not ${answers}`);
    }
    if (answers > 1) {
        // Side by side: within the report, none over another.
        const boxes = await frame.locator('report-view .answers > .answer').evaluateAll(elements =>
            elements.map(element => {
                const box = element.getBoundingClientRect();
                const report = element.closest('.report')?.getBoundingClientRect();
                return {
                    left: box.left,
                    right: box.right,
                    top: box.top,
                    bottom: box.bottom,
                    inside:
                        report !== undefined &&
                        box.left >= report.left - 0.5 &&
                        box.right <= report.right + 0.5,
                };
            })
        );
        const overlap = boxes.some((a, i) =>
            boxes.some(
                (b, j) =>
                    i < j &&
                    a.left < b.right - 0.5 &&
                    b.left < a.right - 0.5 &&
                    a.top < b.bottom - 0.5 &&
                    b.top < a.bottom - 0.5
            )
        );
        if (boxes.length !== answers || overlap || boxes.some(box => !box.inside)) {
            failures.push('The answers side by side overlap or leave the report');
        }
    }
    // Nothing widens the page: previews scroll inside their row when they are too many for it,
    // and beside the answer they stay within the report without covering it.
    failures.push(
        ...(await frame.evaluate(() => {
            const found: string[] = [];
            const page = document.documentElement;
            if (page.scrollWidth > page.clientWidth + 1) {
                found.push(
                    `The report is wider than its frame (${page.scrollWidth} > ${page.clientWidth} px)`
                );
            }
            const root = document.querySelector('report-view')?.shadowRoot;
            const previews = root?.querySelector('.previews')?.getBoundingClientRect();
            const intro = root?.querySelector('.report-intro')?.getBoundingClientRect();
            const report = root?.querySelector('.report')?.getBoundingClientRect();
            const title = root?.querySelector('.report-header h1')?.getBoundingClientRect();
            const card = root?.querySelector('.preview')?.getBoundingClientRect();
            if (previews && intro && report && title && card) {
                // Beside the title, their tops level, where six fit: a report as wide as the
                // Book's panel shows them (about 47rem), else they wrap below the answer.
                const beside = previews.top < intro.bottom - 0.5 && intro.top < previews.bottom;
                if (report.width >= 760 && !beside) {
                    found.push(
                        `The previews wrap below the answer in a report ${report.width} px wide`
                    );
                }
                if (beside && Math.abs(card.top - title.top) > 1) {
                    found.push('The previews beside the title are not level with it');
                }
                if (previews.left < report.left - 0.5 || previews.right > report.right + 0.5) {
                    found.push('The previews leave the report');
                }
                const covers =
                    previews.left < intro.right - 0.5 &&
                    intro.left < previews.right - 0.5 &&
                    previews.top < intro.bottom - 0.5 &&
                    intro.top < previews.bottom - 0.5;
                if (covers) found.push('The previews cover the answer');
            }
            return found;
        }))
    );
    const hasChart = await frame.evaluate(() => {
        const data = document.getElementById('report-data')?.textContent ?? '{}';
        const spec = JSON.parse(data) as { spec?: { elements?: Record<string, { type: string }> } };
        return Object.values(spec.spec?.elements ?? {}).some(element => element.type === 'Chart');
    });
    if (hasChart) {
        const chart = frame.locator('report-view .chart > *');
        await chart.waitFor({ timeout: 5000 });
        // Chart.js animates in; then the canvas has drawn pixels.
        await page.waitForTimeout(CHART_ANIMATION_MS);
        const drawn = await chart.evaluate(element => {
            const canvas = element.shadowRoot?.querySelector('canvas');
            const context = canvas?.getContext('2d');
            if (!canvas || !context || canvas.width === 0 || canvas.height === 0) {
                return 0;
            }
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let painted = 0;
            for (let index = 3; index < pixels.length; index += 4) {
                painted += pixels[index] > 0 ? 1 : 0;
            }
            return painted;
        });
        if (drawn === 0) {
            failures.push('The chart drew nothing');
        }
    }
    // A net result Report calculated says so, as its spec does; nothing else does.
    const calculated = await frame.evaluate(() => {
        const data = document.getElementById('report-data')?.textContent ?? '{}';
        const spec = JSON.parse(data) as {
            spec?: {
                elements?: Record<
                    string,
                    { type: string; props?: { calculated?: { label?: string } } }
                >;
            };
        };
        const source = Object.values(spec.spec?.elements ?? {}).find(
            element => element.type === 'Source'
        );
        return source?.props?.calculated?.label ?? '';
    });
    const shownCalculated = (
        await frame.locator('report-view .source-calculated dt').allTextContents()
    ).map(text => text.trim());
    if (shownCalculated.join('|') !== (calculated ? calculated : '')) {
        failures.push(
            `The Source shows ${JSON.stringify(shownCalculated)} as calculated by Report, not ${JSON.stringify(calculated)}`
        );
    }
    const link = frame.locator('report-view .source-line a');
    if ((await link.count()) !== 1 || !isReportAppLink(await link.getAttribute('href'))) {
        failures.push('The Source has no single link to the Report app');
    }
    const toggle = frame.locator('report-view tbody button.toggle').first();
    if ((await toggle.count()) > 0) {
        const rows = await frame.locator('report-view tbody tr').count();
        await toggle.click();
        const expanded = await toggle.getAttribute('aria-expanded');
        const after = await frame.locator('report-view tbody tr').count();
        if (expanded !== 'true' || after <= rows) {
            failures.push(`Opening a row did not show its children (${rows} → ${after} rows)`);
        }
    }
    if (hasChart) {
        // The chart redraws to highlight the row opened; hover it once it has.
        await page.waitForTimeout(CHART_ANIMATION_MS);
        const chart = frame.locator('report-view .chart > *');
        const point = await chart.evaluate(tooltipPoint);
        if (point) {
            await chart.hover({ position: point });
            await page.waitForTimeout(300);
        }
        if (!point || !(await chart.evaluate(hasTooltip))) {
            failures.push('Hovering the chart shows no tooltip');
        }
    }
    // Read with the Source's Details open, so its dates and footer are read too.
    failures.push(...(await checkSourceDetails(frame)));
    failures.push(...(await frame.evaluate(readingOrder)));
    failures.push(...(await checkPreviewKeyboard(frame)));
    return failures;
}

/**
 * The Source is one line, Details at its start and the link at its end, in the report's
 * direction; Details start closed and open in place, showing the period, query, time read and
 * Book. Leaves them open.
 */
async function checkSourceDetails(frame: Frame): Promise<string[]> {
    const failures: string[] = [];
    const details = frame.locator('report-view .source-line .source-toggle');
    const panel = frame.locator('report-view .source-details');
    if ((await details.count()) !== 1 || (await panel.count()) !== 1) {
        return ['The Source has no single Details on its line'];
    }
    if ((await details.getAttribute('aria-expanded')) !== 'false' || (await panel.isVisible())) {
        failures.push('The Source opens with its Details shown');
    }
    const link = frame.locator('report-view .source-line a');
    const [start, end] = [await details.boundingBox(), await link.boundingBox()];
    const rtl = (await frame.locator('report-view article').getAttribute('dir')) === 'rtl';
    const sameLine =
        start && end && Math.abs(start.y + start.height / 2 - (end.y + end.height / 2)) < 4;
    const inOrder =
        start && end && (rtl ? start.x >= end.x + end.width : start.x + start.width <= end.x);
    if (!sameLine || !inOrder) {
        failures.push("Details and the link are not on one line, in the report's direction");
    }
    await details.click();
    const shown = (await frame.locator('report-view .source-details dt').allTextContents()).length;
    if (
        (await details.getAttribute('aria-expanded')) !== 'true' ||
        !(await panel.isVisible()) ||
        shown !== 3 ||
        !(await frame.locator('report-view .source-details .source-footer').isVisible())
    ) {
        failures.push('Opening Details did not show the period, query, time read and Book');
    }
    return failures;
}

/** The toolbar is reachable by Tab, even without a pressed chart; arrows follow direction. */
async function checkPreviewKeyboard(frame: Frame): Promise<string[]> {
    const failures: string[] = [];
    if (await frame.locator('report-view .preview[data-kind="table"]').count()) {
        failures.push('The previews still offer a Table card');
    }
    const buttons = frame.locator('report-view .preview');
    if ((await buttons.count()) === 0) return failures;
    const tabbable = frame.locator('report-view .preview[tabindex="0"]');
    if ((await tabbable.count()) !== 1) {
        return [...failures, 'The previews need exactly one Tab entry, even without a chart'];
    }
    const heading = frame.locator('report-view h1');
    await heading.evaluate(element => element.setAttribute('tabindex', '-1'));
    await heading.focus();
    await heading.press('Tab');
    if (
        !(await tabbable.evaluate(
            element => element === (element.getRootNode() as ShadowRoot).activeElement
        ))
    ) {
        failures.push('Tab from the heading did not reach the preview toolbar');
    }
    await heading.evaluate(element => element.removeAttribute('tabindex'));
    await tabbable.press('Home');
    if (
        !(await buttons
            .first()
            .evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement))
    ) {
        failures.push('Home did not focus the first preview');
    }
    const rtl = (await frame.locator('report-view article').getAttribute('dir')) === 'rtl';
    if ((await buttons.count()) > 1) {
        await buttons.first().press(rtl ? 'ArrowLeft' : 'ArrowRight');
        if (
            !(await buttons
                .nth(1)
                .evaluate(
                    element => element === (element.getRootNode() as ShadowRoot).activeElement
                ))
        ) {
            failures.push('The forward arrow did not follow the report direction');
        }
    }
    await tabbable.press('End');
    if (
        !(await buttons
            .last()
            .evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement))
    ) {
        failures.push('End did not focus the last preview');
    }
    return failures;
}

/**
 * A click on a preview shows its chart in place of the main one, from the data the file
 * carries: prefer a round chart (or leave one) to exercise different chart heights. The
 * chart then draws, and the link opens the report as that chart. Returns the chart chosen and
 * the time from the click to the chart's first frame; nothing for a file without previews.
 */
async function checkChoice(
    page: Page,
    frame: Frame
): Promise<{ failures: string[]; kind?: string; ms?: number; heightChange?: number }> {
    const alternatives = frame.locator('report-view .preview[aria-pressed="false"]');
    const round = alternatives
        .filter({ has: frame.locator('svg') })
        .and(frame.locator('[data-kind="donut"]'));
    const preview = (await round.count()) > 0 ? round.first() : alternatives.first();
    if ((await preview.count()) === 0) {
        return { failures: [] };
    }
    const failures: string[] = [];
    const kind = (await preview.getAttribute('data-kind')) ?? '';
    const shownKind = () =>
        frame.evaluate(
            () =>
                document
                    .querySelector('report-view')
                    ?.shadowRoot?.querySelector('.chart')
                    ?.getAttribute('data-kind') ?? 'table'
        );
    const before = await shownKind();
    const layout = () =>
        frame.evaluate(() => {
            const root = document.querySelector('report-view')?.shadowRoot;
            const previews = root?.querySelector('.previews')?.getBoundingClientRect();
            const chart = root?.querySelector('.chart')?.getBoundingClientRect();
            const table = root?.querySelector('.breakdown-section')?.getBoundingClientRect();
            return {
                top: (previews?.top ?? 0) + scrollY,
                bottom: (previews?.bottom ?? 0) + scrollY,
                chartTop: chart ? chart.top + scrollY : undefined,
                chartBottom: chart ? chart.bottom + scrollY : undefined,
                height: chart?.height ?? 0,
                // A report of an account has no table: an account has no parts.
                tableTop: table ? table.top + scrollY : undefined,
            };
        });
    const initial = await layout();
    // Timed in the page: the click, the report's update, the chart's, then its first frame.
    const ms = await preview.evaluate(async button => {
        const view = document.querySelector('report-view');
        const start = performance.now();
        (button as HTMLElement).click();
        await (view as unknown as { updateComplete: Promise<unknown> }).updateComplete;
        const chart = view?.shadowRoot?.querySelector('.chart > *');
        await (chart as unknown as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
        await new Promise(resolve => requestAnimationFrame(resolve));
        return performance.now() - start;
    });
    const shown = await shownKind();
    const pressed = await frame
        .locator(`report-view .preview[data-kind="${kind}"]`)
        .getAttribute('aria-pressed');
    if (shown !== kind || shown === before || pressed !== 'true') {
        failures.push(`Choosing ${kind} showed ${shown} (was ${before}), pressed ${pressed}`);
    }
    await page.waitForTimeout(CHART_ANIMATION_MS);
    const after = await layout();
    if (Math.abs(after.top - initial.top) > 1) {
        failures.push(`The previews moved when choosing ${kind}: ${initial.top} → ${after.top}`);
    }
    for (const position of [initial, after]) {
        if (position.chartTop !== undefined && position.bottom > position.chartTop) {
            failures.push('The previews are not above the chart');
        }
        if (
            position.chartBottom !== undefined &&
            position.tableTop !== undefined &&
            position.tableTop < position.chartBottom
        ) {
            failures.push('The breakdown table is not below the chart');
        }
    }
    const heightChange = Math.abs(after.height - initial.height);
    // The recorded monthly report is the explicit differing-height regression, not a same-size switch.
    if (before === 'bar' && kind === 'donut' && heightChange < 1) {
        failures.push('The monthly-to-round chart regression did not exercise different heights');
    }
    // Drawn by Chart.js: its elements of the first dataset. (Reading the canvas's pixels
    // again would make Chrome warn about repeated readbacks.)
    const drawn = await frame
        .locator('report-view .chart > *')
        .evaluate(element => {
            const chart: unknown = Reflect.get(element, 'chart');
            if (typeof chart !== 'object' || chart === null || !('getDatasetMeta' in chart)) {
                return 0;
            }
            return (chart as DrawnChart).getDatasetMeta(0).data.length;
        })
        .catch(() => 0);
    if (drawn === 0) {
        failures.push(`The chosen ${kind} chart drew nothing`);
    }
    const data = await frame.evaluate(
        () => JSON.parse(document.getElementById('report-data')?.textContent ?? '{}') as unknown
    );
    const chosen = (data as Partial<ReportFileData>).open?.charts?.[kind as ViewKind];
    const href = await frame.locator('report-view .source-line a').getAttribute('href');
    if (chosen && (!href || new URL(href).searchParams.get('state') !== chosen)) {
        failures.push(`After choosing ${kind}, the link does not open it: ${href}`);
    }
    return { failures, kind, ms, heightChange };
}

/**
 * The link opens the Report app in the Book in place only once the Agent allows it: before its
 * `bkper:host-ready`, a click is left to the browser (a new tab) and nothing is sent; after it,
 * nothing is sent until a click, which then sends one `bkper:navigate` to the Book page of the
 * file's report state, while the person is in the frame. A file without state keeps the link.
 */
async function checkNavigation(page: Page, frame: Frame, chosen?: string): Promise<string[]> {
    const failures: string[] = [];
    const data = await frame.evaluate(
        () => JSON.parse(document.getElementById('report-data')?.textContent ?? '{}') as unknown
    );
    const open = (data as Partial<ReportFileData>).open;
    const messages = () =>
        page.evaluate(
            () =>
                (window as Window & { fileMessages?: { data: unknown; focused: boolean }[] })
                    .fileMessages ?? []
        );
    // Records whether the file took each click, and keeps the browser from opening a tab.
    await frame.evaluate(() => {
        const clicks: boolean[] = [];
        Object.assign(window, { clicks });
        window.addEventListener('click', event => {
            clicks.push(event.defaultPrevented);
            event.preventDefault();
        });
    });
    const clicks = () =>
        frame.evaluate(() => (window as Window & { clicks?: boolean[] }).clicks ?? []);
    const link = frame.locator('report-view .source-line a');

    await link.click();
    if ((await clicks())[0] !== false || (await messages()).length > 0) {
        failures.push('Before host-ready, the link is not a plain link');
    }
    await page.evaluate(origin => {
        document
            .querySelector('iframe')
            ?.contentWindow?.postMessage(
                { type: 'bkper:host-ready', supports: ['navigate'], origin },
                '*'
            );
    }, BKPER_ORIGIN);
    await page.waitForTimeout(100);
    if ((await messages()).length > 0) {
        failures.push('The file sent a message without a click');
    }
    await link.click();
    await page.waitForTimeout(100);
    const sent = await messages();
    if (!open) {
        if (sent.length > 0 || (await clicks())[1] !== false) {
            failures.push('A file without a report state does not keep a plain link');
        }
        return failures;
    }
    // The chart chosen in the file opens as that chart.
    const state = (chosen && open.charts?.[chosen as ViewKind]) || open.state;
    const expected = `${BKPER_ORIGIN}/books/${encodeURIComponent(open.bookId)}/transactions?app=report&appState=${state}`;
    const navigate = sent[0]?.data as { type?: unknown; url?: unknown } | undefined;
    if (sent.length !== 1 || navigate?.type !== 'bkper:navigate' || navigate.url !== expected) {
        failures.push(`After host-ready, a click sent ${JSON.stringify(sent)}, not one navigate`);
    } else if (!sent[0].focused) {
        failures.push('The navigate came while the person was not in the file');
    }
    if ((await clicks())[1] !== true) {
        failures.push('After host-ready, the click still opens a tab');
    }
    if (!decodeUrlState(state)) {
        failures.push(`The file's state does not open a report: ${state}`);
    }
    return failures;
}

/**
 * Where values inserted into texts read out of order: in each text of the report, every part
 * between isolates (FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE) must follow the part
 * before it in the report's direction, as must the end of a date range its start. Runs in the
 * page, so it is self-contained.
 */
function readingOrder(): string[] {
    // No named inner functions: tsx would wrap them in a helper the page lacks.
    const view = document.querySelector('report-view')?.shadowRoot;
    const report = view?.querySelector<HTMLElement>('.report');
    if (!view || !report) {
        return ['No report to read'];
    }
    const rtl = report.dir === 'rtl';
    const failures: string[] = [];
    const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        if (!text.data.includes('\u2068')) {
            continue;
        }
        // The top-level parts, plain text and isolated values, in logical order; and the ends
        // of each isolated date range.
        const parts: { start: number; end: number; range?: 'from' | 'to'; rtl?: boolean }[] = [];
        let depth = 0;
        let start = 0;
        for (let index = 0; index < text.data.length; index++) {
            const char = text.data[index];
            if (char === '\u2068' && depth++ === 0) {
                parts.push({ start, end: index });
                start = index + 1;
            } else if (char === '\u2069' && --depth === 0) {
                parts.push({ start, end: index });
                const dash = text.data.indexOf('–', start);
                if (dash >= 0 && dash < index) {
                    // An isolated value runs in the direction of its first strong character.
                    const strong = /[\p{L}\u200e\u200f\u061c]/u.exec(text.data.slice(start, index));
                    const valueRtl = strong
                        ? /[\u200f\u061c\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thaana}\p{Script=Syriac}]/u.test(
                              strong[0]
                          )
                        : rtl;
                    parts.push({ start, end: dash, range: 'from', rtl: valueRtl });
                    parts.push({ start: dash + 1, end: index, range: 'to', rtl: valueRtl });
                }
                start = index + 1;
            }
        }
        parts.push({ start, end: text.data.length });
        // Where each part starts and ends showing, without its spaces: the boxes of its first
        // and of its last line, which are one box unless it wraps. Blank parts do not show.
        const shown = parts.flatMap(part => {
            const piece = text.data.slice(part.start, part.end);
            const from = part.start + (piece.length - piece.trimStart().length);
            const to = part.end - (piece.length - piece.trimEnd().length);
            if (to <= from) {
                return [];
            }
            const range = document.createRange();
            range.setStart(text, from);
            range.setEnd(text, to);
            const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
            if (rects.length === 0) {
                return [];
            }
            const lineBoxes = [rects[0].top, rects[rects.length - 1].top].map(top => {
                const line = rects.filter(rect => Math.abs(rect.top - top) <= rect.height / 2);
                const left = Math.min(...line.map(rect => rect.left));
                const right = Math.max(...line.map(rect => rect.right));
                return { top, left, right, height: Math.max(...line.map(rect => rect.height)) };
            });
            return [{ ...part, head: lineBoxes[0], tail: lineBoxes[1] }];
        });
        const sentence = shown.filter(part => !part.range);
        const ranges = shown.filter(part => part.range);
        const pairs = [
            ...sentence.slice(1).map((part, index) => [sentence[index], part] as const),
            ...ranges.flatMap((part, index) =>
                part.range === 'to' && ranges[index - 1]?.range === 'from'
                    ? [[ranges[index - 1], part] as const]
                    : []
            ),
        ];
        for (const [first, second] of pairs) {
            const end = first.tail;
            const next = second.head;
            const sameLine = Math.abs(end.top - next.top) <= end.height / 2;
            const inOrder =
                (second.rtl ?? rtl) ? next.right <= end.left + 1 : next.left >= end.right - 1;
            if (sameLine && !inOrder) {
                failures.push(`Out of reading order: ${JSON.stringify(text.data)}`);
            }
        }
    }
    return failures;
}

/**
 * The part of the Chart.js chart a Web Awesome chart element exposes (`chart`) that the checks
 * use. The checks run in the page, so they are self-contained.
 */
interface DrawnChart {
    canvas: HTMLCanvasElement;
    data: { datasets: { data: unknown[] }[] };
    getDatasetMeta(index: number): {
        data: { getCenterPoint(final: boolean): { x: number; y: number } }[];
    };
    tooltip?: { getActiveElements(): unknown[] } | null;
}

/** Where, in the chart element, its first bar or point other than zero is drawn. Runs in the page. */
function tooltipPoint(element: Element): { x: number; y: number } | undefined {
    const chart: unknown = Reflect.get(element, 'chart');
    if (typeof chart !== 'object' || chart === null || !('getDatasetMeta' in chart)) {
        return undefined;
    }
    const drawn = chart as DrawnChart;
    // The first value, or floating bar's start and end, that draws something. (No named
    // inner functions: tsx would wrap them in a helper the page lacks.)
    const indexes = drawn.data.datasets.map(dataset =>
        dataset.data.findIndex(
            value =>
                (typeof value === 'number' && value !== 0) ||
                (Array.isArray(value) && value.length === 2 && value[0] !== value[1])
        )
    );
    const datasetIndex = indexes.findIndex(index => index >= 0);
    const dataIndex = datasetIndex < 0 ? -1 : indexes[datasetIndex];
    const value =
        dataIndex < 0
            ? undefined
            : drawn.getDatasetMeta(datasetIndex).data[dataIndex]?.getCenterPoint(true);
    if (!value) {
        return undefined;
    }
    const canvas = drawn.canvas.getBoundingClientRect();
    const host = element.getBoundingClientRect();
    return { x: value.x + canvas.left - host.left, y: value.y + canvas.top - host.top };
}

/** Whether the chart shows a tooltip. Runs in the page. */
function hasTooltip(element: Element): boolean {
    const chart: unknown = Reflect.get(element, 'chart');
    if (typeof chart !== 'object' || chart === null || !('tooltip' in chart)) {
        return false;
    }
    return ((chart as DrawnChart).tooltip?.getActiveElements().length ?? 0) > 0;
}

async function verify(files: ReportFile[]): Promise<Result[]> {
    const browser = await chromium.launch();
    const results: Result[] = [];
    try {
        for (const scheme of ['light', 'dark'] as const) {
            const context = await browser.newContext({
                viewport,
                colorScheme: scheme,
                locale: 'en-US',
            });
            // Every frame, before its scripts, records the policy violations it sees.
            // (A string: tsx would wrap a function's inner functions in a helper the page lacks.)
            await context.addInitScript({
                content: `document.addEventListener('securitypolicyviolation', event => {
                    window.violations = [...(window.violations ?? []),
                        event.violatedDirective + ' ' + event.blockedURI];
                });`,
            });
            const page = await context.newPage();
            for (const file of files) {
                const failures: string[] = [];
                const onConsole = (message: { type(): string; text(): string }) => {
                    if (message.type() === 'error' || message.type() === 'warning') {
                        failures.push(`console ${message.type()}: ${message.text()}`);
                    }
                };
                const onError = (error: Error) => failures.push(`page error: ${error.message}`);
                const requests: string[] = [];
                page.on('console', onConsole);
                page.on('pageerror', onError);
                await page.route('**/*', route => {
                    if (route.request().url() === AGENT_URL) {
                        return route.fulfill({ contentType: 'text/html', body: HOST_PAGE });
                    }
                    requests.push(route.request().url());
                    return route.abort();
                });
                await page.mouse.move(0, 0);
                const frame = await open(page, file);
                failures.push(...(await check(page, frame)));
                const darkTheme = await frame.evaluate(() =>
                    document.documentElement.classList.contains('wa-dark')
                );
                if (screenshots) {
                    await mkdir(screenshots, { recursive: true });
                    const height = await frame.evaluate(() =>
                        Math.ceil(
                            document.querySelector('report-view')?.getBoundingClientRect().bottom ??
                                0
                        )
                    );
                    await page.screenshot({
                        path: join(screenshots, `${file.name}-${scheme}.png`),
                        clip: {
                            x: 0,
                            y: 0,
                            width: viewport.width,
                            height: Math.min(height, viewport.height),
                        },
                    });
                }
                const choice = await checkChoice(page, frame);
                failures.push(...choice.failures);
                const violations = await frame.evaluate(
                    () => (window as Window & { violations?: string[] }).violations ?? []
                );
                failures.push(...violations.map(violation => `policy violation: ${violation}`));
                failures.push(...requests.map(url => `network request: ${url}`));
                // Last: its clicks move the focus into the link.
                failures.push(...(await checkNavigation(page, frame, choice.kind)));
                page.off('console', onConsole);
                page.off('pageerror', onError);
                await page.unroute('**/*');
                results.push({
                    name: file.name,
                    scheme,
                    bytes: new TextEncoder().encode(file.html).length,
                    failures,
                    darkTheme,
                    ...(choice.ms === undefined ? {} : { switchMs: choice.ms }),
                    heightChange: choice.heightChange,
                });
            }
            await context.close();
        }
    } finally {
        await browser.close();
    }
    return results;
}

const files = paths.length > 0 ? await givenFiles() : await recordedFiles();
const results = await verify(files);
let failed = 0;
for (const result of results) {
    const size = result.bytes > MAX_TEXT_VIEW_BYTES ? ['over the Agent’s 1 MB view limit'] : [];
    const failures = [...result.failures, ...size];
    failed += failures.length > 0 ? 1 : 0;
    console.log(
        `${failures.length === 0 ? 'ok  ' : 'FAIL'} ${result.name} ${result.scheme}` +
            ` ${(result.bytes / 1024).toFixed(1)} KB${result.darkTheme ? ' (dark theme)' : ''}` +
            (result.switchMs === undefined
                ? ''
                : `, chart chosen in ${result.switchMs.toFixed(1)} ms` +
                  `, height Δ${result.heightChange?.toFixed(1)} px`)
    );
    failures.forEach(failure => console.log(`     ${failure}`));
}
const largest = Math.max(...results.map(result => result.bytes));
const switches = results.flatMap(result =>
    result.switchMs === undefined ? [] : [result.switchMs]
);
switches.sort((a, b) => a - b);
const median = switches[Math.floor(switches.length / 2)];
console.log(
    `${results.length - failed}/${results.length} ok; largest file ${(largest / 1024).toFixed(1)} KB` +
        (switches.length
            ? `; ${switches.length} charts chosen, p50 ${median.toFixed(1)} ms, max ${switches[switches.length - 1].toFixed(1)} ms`
            : '')
);
process.exitCode = failed > 0 ? 1 : 0;

/** A link to the Report app: production, or preview for files the preview Worker served. */
function isReportAppLink(href: string | null): boolean {
    return (
        href?.startsWith('https://report.bkper.app/') === true ||
        href?.startsWith('https://report-preview.bkper.app/') === true
    );
}
