/**
 * Opens report files in headless Chromium exactly as the Bkper Agent shows a published HTML
 * file, and checks they work there with no network.
 *
 *     npx tsx scripts/verify-report-file.ts [--screenshots=<dir>] [<file.html> ...]
 *
 * Without files, it writes one report file per recorded spec (`client/dev/specs/*.json`) with
 * the built bundle (run `npm run build:report-file` first); with files, such as one saved from
 * the API (`format: "html"`), it opens those (without the live-reload script `bkper app dev`
 * appends to HTML). Each opens in light and dark in the Agent's frame:
 * an `<iframe sandbox="allow-scripts">` whose `srcdoc` is the file after the Agent's
 * `<!doctype html>` and Content-Security-Policy, styled as the Agent styles it, while every
 * request is blocked. It checks there are no requests, no policy violations and no console
 * errors; that the answer, the chart and the link to the Report app show; that a row opens
 * in place; and that values written into texts, such as dates, read in the report's direction. `--screenshots` saves a picture of each. Needs Playwright's Chromium headless shell
 * (`npx playwright-core install chromium-headless-shell`).
 */
import { mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { chromium, type Frame, type Page } from 'playwright-core';
import { validateReportSpec } from '../shared/src/catalog.ts';
import { buildReportFile } from '../server/src/services/report-file.ts';

/** The Agent's frame policy and document (bkper-clients `packages/agent`, `file-views.ts`). */
const HTML_VIEW_POLICY =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
    "font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

function sandboxedHtml(text: string): string {
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${HTML_VIEW_POLICY}">${text}`;
}

/** The Agent's HTML view: its frame fills the panel, on a light page (`html-css.ts`). */
const HOST_PAGE = `<!doctype html><html><head><style>
    html, body { height: 100%; margin: 0; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: white; color-scheme: light; }
</style></head><body><iframe sandbox="allow-scripts" title="report.html"></iframe></body></html>`;

/** The Agent shows HTML files up to this size; larger ones only download. */
const MAX_TEXT_VIEW_BYTES = 1024 * 1024;

/** Tall enough for whole reports, so screenshots need no scrolling. */
const VIEWPORT = { width: 900, height: 2400 };

/** Chart.js animates for 1 s by default. */
const CHART_ANIMATION_MS = 1200;

const SPEC_FILES = ['client/dev/specs/studio.json', 'client/dev/specs/ledger.json'];

const LINK = { url: 'https://report.bkper.app/?book=book-1&q=report', label: 'Open in Report' };

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
}

const args = process.argv.slice(2);
const screenshots = args.find(arg => arg.startsWith('--screenshots='))?.split('=')[1];
const paths = args.filter(arg => !arg.startsWith('--'));

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
            files.push({ name: entry.id, html: buildReportFile(validation.spec, LINK) });
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
    await page.setContent(HOST_PAGE);
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
    const answer = frame.locator('report-view .answer-amount');
    await answer.waitFor({ timeout: 5000 });
    if (!/\p{Nd}/u.test((await answer.textContent()) ?? '')) {
        failures.push('The answer shows no amount');
    }
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
    const link = frame.locator('report-view .source-footer a');
    if ((await link.count()) !== 1 || !isReportAppLink(await link.getAttribute('href'))) {
        failures.push('The Source has no single link to the Report app');
    }
    const toggle = frame.locator('report-view button.toggle').first();
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
    failures.push(...(await frame.evaluate(readingOrder)));
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
        // Where each part shows, without its spaces; blank parts do not show.
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
            const box = range.getBoundingClientRect();
            return box.width > 0 ? [{ ...part, box }] : [];
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
            const sameLine = Math.abs(first.box.top - second.box.top) <= first.box.height / 2;
            const inOrder =
                (second.rtl ?? rtl)
                    ? second.box.right <= first.box.left + 1
                    : second.box.left >= first.box.right - 1;
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
                viewport: VIEWPORT,
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
                    requests.push(route.request().url());
                    return route.abort();
                });
                await page.mouse.move(0, 0);
                const frame = await open(page, file);
                failures.push(...(await check(page, frame)));
                const violations = await frame.evaluate(
                    () => (window as Window & { violations?: string[] }).violations ?? []
                );
                failures.push(...violations.map(violation => `policy violation: ${violation}`));
                failures.push(...requests.map(url => `network request: ${url}`));
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
                            width: VIEWPORT.width,
                            height: Math.min(height, VIEWPORT.height),
                        },
                    });
                }
                page.off('console', onConsole);
                page.off('pageerror', onError);
                await page.unroute('**/*');
                results.push({
                    name: file.name,
                    scheme,
                    bytes: new TextEncoder().encode(file.html).length,
                    failures,
                    darkTheme,
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
            ` ${(result.bytes / 1024).toFixed(1)} KB${result.darkTheme ? ' (dark theme)' : ''}`
    );
    failures.forEach(failure => console.log(`     ${failure}`));
}
const largest = Math.max(...results.map(result => result.bytes));
console.log(
    `${results.length - failed}/${results.length} ok; largest file ${(largest / 1024).toFixed(1)} KB`
);
process.exitCode = failed > 0 ? 1 : 0;

/** A link to the Report app: production, or preview for files the preview Worker served. */
function isReportAppLink(href: string | null): boolean {
    return (
        href?.startsWith('https://report.bkper.app/') === true ||
        href?.startsWith('https://report-preview.bkper.app/') === true
    );
}
