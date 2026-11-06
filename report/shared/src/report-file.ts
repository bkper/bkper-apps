/**
 * A report file: one self-contained HTML document with a report, for places that show files
 * but load nothing, such as the Bkper Agent's file view. The Worker writes the document around
 * the prebuilt renderer bundle, with the data the bundle reads from a JSON script.
 */
import type { ReportSpec, ViewKind } from './catalog';

/** The id of the JSON script that carries a report file's {@link ReportFileData}. */
export const REPORT_FILE_DATA_ID = 'report-data';

export interface ReportFileData {
    /** The report, without actions the file cannot handle, such as `openInBkper`. */
    spec: ReportSpec;
    /** The plain link of the report's Source: the same report in the Report app. */
    link: { url: string; label: string };
    /**
     * The Book and the report's state (`report-state.ts`), with which a host that lets the file
     * navigate, such as the Bkper Agent in a Book, opens the same report in the Report app in
     * place; left out when the report has no state. `charts` holds the state of the same
     * report shown as each other chart that fits it, for the chart the person chooses in the
     * file; a kind left out opens with `state`.
     */
    open?: { bookId: string; state: string; charts?: Partial<Record<ViewKind, string>> };
}
