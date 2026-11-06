/**
 * A report file's script: it renders the report the file carries (`ReportFileData`, in its JSON
 * script) in the file's `<report-view>`, in the viewer's light or dark color scheme. It reads
 * nothing else and loads nothing.
 */
import { REPORT_FILE_DATA_ID, type ReportFileData } from 'report-shared/report-file';
import type { ReportView } from '../report/index.js';

/** The part of a `MediaQueryList` the color scheme needs. */
export interface ColorScheme extends EventTarget {
    readonly matches: boolean;
}

/** Applies Web Awesome's dark theme while `dark` matches, as it changes. */
export function followColorScheme(root: Element, dark: ColorScheme): void {
    const apply = () => root.classList.toggle('wa-dark', dark.matches);
    apply();
    dark.addEventListener('change', apply);
}

/** Renders the report of the document; the view, or `undefined` without one or its data. */
export function startReportFile(document: Document, dark: ColorScheme): ReportView | undefined {
    followColorScheme(document.documentElement, dark);
    const view = document.querySelector('report-view');
    const text = document.getElementById(REPORT_FILE_DATA_ID)?.textContent;
    if (!view || !text) {
        return undefined;
    }
    // The Worker wrote the data from a spec it validated.
    const data: ReportFileData = JSON.parse(text);
    view.spec = data.spec;
    view.link = data.link;
    return view;
}
