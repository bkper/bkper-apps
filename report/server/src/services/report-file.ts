/**
 * A report file: one self-contained HTML document with a report, for places that show a file
 * but let it load nothing, such as the Bkper Agent's file view (a sandboxed `srcdoc` frame that
 * may only run inline scripts and styles).
 *
 * The document is written around the prebuilt renderer bundle (`npm run build:report-file`),
 * held in memory, with the validated spec and the link the renderer shows. Nothing is bundled
 * per request.
 */
import type { ReportSpec, ViewKind } from 'report-shared/catalog';
import { REPORT_FILE_DATA_ID, type ReportFileData } from 'report-shared/report-file';
import type { ReportIntentData } from 'report-shared/report-intent';
import { encodeReportState } from 'report-shared/report-state';
import { REPORT_FILE_SCRIPT, REPORT_FILE_STYLE } from '../generated/report-file-bundle.js';

export interface ReportFileBundle {
    /** A classic script with nothing that could end its `<script>` element early. */
    script: string;
    /** A stylesheet with nothing that could end its `<style>` element early. */
    style: string;
}

/** The renderer, with the Web Awesome theme and Bkper design tokens. */
export const REPORT_FILE_BUNDLE: ReportFileBundle = {
    script: REPORT_FILE_SCRIPT,
    style: REPORT_FILE_STYLE,
};

/** What the file may do wherever it opens: run what it carries, and reach nothing. */
const POLICY =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
    "font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

/**
 * The report file of a validated spec. The file cannot open Bkper in place, so its Source keeps
 * no `openInBkper` action and shows `link` instead, which opens the report in the Report app
 * in place (`open`) where the host lets the file navigate.
 */
export function buildReportFile(
    spec: ReportSpec,
    { link, open }: Pick<ReportFileData, 'link' | 'open'>,
    bundle: ReportFileBundle = REPORT_FILE_BUNDLE
): string {
    const report = spec.elements[spec.root];
    if (report?.type !== 'Report') {
        throw new Error('The spec has no Report at its root');
    }
    const { title, subtitle, locale, dir } = report.props;
    const data: ReportFileData = {
        spec: withoutOpenInBkper(spec),
        link,
        ...(open ? { open } : {}),
    };
    return [
        '<!doctype html>',
        `<html lang="${escapeHtml(locale)}" dir="${dir}">`,
        '<head>',
        '<meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(`${title} · ${subtitle}`)}</title>`,
        `<style>${bundle.style}</style>`,
        '</head>',
        '<body>',
        '<report-view></report-view>',
        `<script type="application/json" id="${REPORT_FILE_DATA_ID}">${scriptJson(data)}</script>`,
        `<script>${bundle.script}</script>`,
        '</body>',
        '</html>',
        '',
    ].join('\n');
}

/**
 * What opens the file's report in the Report app: the Book and the report's state, and the
 * state of the same report as each other chart that fits, for a chart chosen in the file. None
 * when the report's state does not fit; a chart whose state does not fit opens the report's.
 */
export function reportFileOpen(
    bookId: string,
    report: {
        intent: ReportIntentData;
        language: string;
        charts: { fitting: ViewKind[]; main: ViewKind };
    }
): ReportFileData['open'] {
    const { intent, language, charts } = report;
    const state = encodeReportState({ intent, language });
    if (!state) return undefined;
    const others = charts.fitting.flatMap(kind => {
        const chosen =
            kind === charts.main
                ? undefined
                : encodeReportState({ intent: { ...intent, chart: kind }, language });
        return chosen ? [[kind, chosen] as const] : [];
    });
    return { bookId, state, ...(others.length ? { charts: Object.fromEntries(others) } : {}) };
}

function withoutOpenInBkper(spec: ReportSpec): ReportSpec {
    const elements = Object.fromEntries(
        Object.entries(spec.elements).map(([id, element]) => [
            id,
            element.type === 'Source' ? { type: element.type, props: element.props } : element,
        ])
    );
    return { ...spec, elements };
}

/**
 * JSON to place in a `<script>` element: `<` escaped, so no text ends the element or opens a
 * comment in it, and the line and paragraph separators escaped, as older JavaScript needs.
 */
function scriptJson(value: unknown): string {
    return JSON.stringify(value).replace(
        /[<\u2028\u2029]/g,
        char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
    );
}

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char);
}
