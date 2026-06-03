import { BkperAuth } from '@bkper/web-auth';
import { Bkper } from 'bkper-js';
import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getMenuContext } from '../context';
import { createCsvFileName, dataTableToCsv } from '../csv';
import { configureTransactionsDataTableBuilder } from '../export-builder';
import {
    defaultExportOptions,
    normalizeExportOptions,
    type CsvDelimiter,
    type ExportOptions,
} from '../export-config';
import { listTransactionsForExport } from '../export-service';
import { getExportValidationMessage, QUERY_REQUIRED_MESSAGE } from '../export-validation';

type BooleanExportOption = {
    [Key in keyof ExportOptions]: ExportOptions[Key] extends boolean ? Key : never;
}[keyof ExportOptions];

const isLocalDev =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

@customElement('csv-export-app')
export class CsvExportApp extends LitElement {
    static styles = css`
        :host {
            display: block;
            color: #202124;
            font-family: Inter, Roboto, Arial, sans-serif;
            font-size: 14px;
        }

        .container {
            box-sizing: border-box;
            max-width: 540px;
            margin: 0 auto;
            padding: 18px;
        }

        h1 {
            margin: 0 0 4px;
            font-size: 20px;
            font-weight: 600;
        }

        .subtitle {
            margin: 0 0 16px;
            color: #5f6368;
            line-height: 1.4;
        }

        .context,
        .panel,
        .message {
            border: 1px solid #dadce0;
            border-radius: 10px;
            padding: 12px;
        }

        .context {
            background: #f8fafd;
            margin-bottom: 12px;
        }

        .book-name {
            font-weight: 600;
            margin-bottom: 4px;
            overflow-wrap: anywhere;
        }

        .query {
            color: #5f6368;
            font-size: 12px;
            line-height: 1.35;
            overflow-wrap: anywhere;
        }

        .query-warning {
            color: #a50e0e;
        }

        .panel {
            margin-bottom: 14px;
        }

        .panel-title {
            font-weight: 600;
            margin-bottom: 10px;
        }

        label,
        .select-row {
            align-items: center;
            display: flex;
            gap: 8px;
            margin: 9px 0;
        }

        label {
            cursor: pointer;
        }

        input,
        select {
            margin: 0;
        }

        select {
            border: 1px solid #dadce0;
            border-radius: 6px;
            padding: 6px 8px;
        }

        details {
            border-top: 1px solid #edf0f2;
            margin-top: 12px;
            padding-top: 10px;
        }

        summary {
            color: #1a73e8;
            cursor: pointer;
            font-weight: 600;
        }

        .actions {
            align-items: center;
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin: 14px 0 16px;
        }

        button,
        .download-link {
            border: 1px solid #1a73e8;
            border-radius: 7px;
            cursor: pointer;
            font-weight: 600;
            padding: 9px 16px;
            text-decoration: none;
        }

        button.primary,
        .download-link {
            background: #1a73e8;
            color: white;
        }

        button.secondary {
            background: white;
            color: #1a73e8;
        }

        button:disabled {
            border-color: #dadce0;
            color: #9aa0a6;
            cursor: not-allowed;
            background: #f1f3f4;
        }

        .messages {
            display: grid;
            gap: 10px;
            margin-top: 16px;
        }

        .message {
            background: #f8fafd;
            color: #3c4043;
            line-height: 1.4;
        }

        .message-actions {
            margin-top: 12px;
        }

        .error {
            background: #fce8e6;
            border-color: #fad2cf;
            color: #a50e0e;
        }

        .success {
            background: #e6f4ea;
            border-color: #ceead6;
            color: #137333;
        }
    `;

    @state() private bookId: string | null = null;
    @state() private query = '';
    @state() private bookName: string | null = null;
    @state() private options: ExportOptions = { ...defaultExportOptions };
    @state() private loading = false;
    @state() private exporting = false;
    @state() private loginRequired = false;
    @state() private errorMessage: string | null = null;
    @state() private progressMessage: string | null = null;
    @state() private successMessage: string | null = null;
    @state() private downloadUrl: string | null = null;
    @state() private downloadFileName: string | null = null;

    private readonly auth = new BkperAuth({
        baseUrl: isLocalDev ? window.location.origin : undefined,
        onLoginSuccess: () => {
            void this.loadBookContext();
        },
        onLoginRequired: () => {
            this.loginRequired = true;
        },
        onError: error => {
            this.errorMessage = `Authentication failed: ${toErrorMessage(error)}`;
        },
    });

    connectedCallback(): void {
        super.connectedCallback();

        const context = getMenuContext(window.location.search);
        this.bookId = context.bookId;
        this.query = context.query;

        if (!this.bookId) {
            this.errorMessage = 'Missing book context. Open this app from a Bkper book menu.';
            return;
        }

        void this.auth.init();
    }

    disconnectedCallback(): void {
        this.revokeDownloadUrl();
        super.disconnectedCallback();
    }

    render() {
        return html`
            <main class="container">
                <h1>Export CSV</h1>
                <p class="subtitle">Choose options and download transactions from this book.</p>

                ${this.renderContext()}
                ${this.loginRequired ? this.renderLogin() : this.renderExportForm()}
                ${this.renderMessages()}
            </main>
        `;
    }

    private renderContext() {
        return html`
            <section class="context" aria-label="Export context">
                <div class="book-name">${this.bookName ?? this.bookId ?? 'Loading book...'}</div>
                <div class=${this.query ? 'query' : 'query query-warning'}>
                    ${this.query
                        ? html`Query: ${this.query}`
                        : 'No query selected. Set a query or date range before exporting.'}
                </div>
            </section>
        `;
    }

    private renderLogin() {
        return html`
            <div class="message">
                Please sign in to export transactions from this book.
                <div class="actions">
                    <button class="primary" @click=${() => this.auth.login()}>Sign in</button>
                </div>
            </div>
        `;
    }

    private renderExportForm() {
        return html`
            ${getExportValidationMessage(this.query)
                ? html`<div class="message error">${QUERY_REQUIRED_MESSAGE}</div>`
                : ''}

            <section class="panel" aria-label="Export options">
                <div class="panel-title">Options</div>

                <div class="select-row">
                    <span>CSV separator</span>
                    <select
                        .value=${this.options.delimiter}
                        @change=${(event: Event) => this.updateDelimiter(event)}
                    >
                        <option value=";">Semicolon (;)</option>
                        <option value=",">Comma (,)</option>
                    </select>
                </div>

                <label>
                    <input
                        type="checkbox"
                        .checked=${this.options.formatDates}
                        @change=${(event: Event) => this.updateBooleanOption('formatDates', event)}
                    />
                    Format dates
                </label>
                <label>
                    <input
                        type="checkbox"
                        .checked=${this.options.formatValues}
                        @change=${(event: Event) => this.updateBooleanOption('formatValues', event)}
                    />
                    Format amounts
                </label>

                <details>
                    <summary>Columns</summary>
                    <label>
                        <input
                            type="checkbox"
                            .checked=${this.options.includeRecordedAt}
                            @change=${(event: Event) =>
                                this.updateBooleanOption('includeRecordedAt', event)}
                        />
                        Recorded at
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            .checked=${this.options.includeIds}
                            @change=${(event: Event) => this.updateBooleanOption('includeIds', event)}
                        />
                        Transaction IDs and remote IDs
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            .checked=${this.options.includeProperties}
                            @change=${(event: Event) =>
                                this.updateBooleanOption('includeProperties', event)}
                        />
                        Transaction properties
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            .checked=${this.options.includeHiddenProperties}
                            ?disabled=${!this.options.includeProperties}
                            @change=${(event: Event) =>
                                this.updateBooleanOption('includeHiddenProperties', event)}
                        />
                        Hidden properties
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            .checked=${this.options.includeUrls}
                            @change=${(event: Event) => this.updateBooleanOption('includeUrls', event)}
                        />
                        URLs and attachments
                    </label>
                </details>
            </section>

            <div class="actions">
                <button
                    class="secondary"
                    ?disabled=${this.exporting}
                    @click=${() => this.resetOptions()}
                >
                    Reset
                </button>
                <button
                    class="primary"
                    ?disabled=${
                        this.loading ||
                        this.exporting ||
                        !this.bookId ||
                        Boolean(getExportValidationMessage(this.query))
                    }
                    @click=${() => {
                        void this.exportCsv();
                    }}
                >
                    ${this.exporting ? 'Exporting...' : 'Export CSV'}
                </button>
            </div>
        `;
    }

    private renderMessages() {
        if (
            !this.progressMessage &&
            !this.successMessage &&
            !this.errorMessage &&
            !this.downloadUrl
        ) {
            return '';
        }

        return html`
            <div class="messages">
                ${this.progressMessage ? html`<div class="message">${this.progressMessage}</div>` : ''}
                ${this.successMessage || this.downloadUrl
                    ? html`
                          <div class="message success">
                              ${this.successMessage ?? 'CSV ready.'}
                              ${this.downloadUrl && this.downloadFileName
                                  ? html`
                                        <div class="message-actions">
                                            <a
                                                class="download-link"
                                                href=${this.downloadUrl}
                                                download=${this.downloadFileName}
                                            >
                                                Download file
                                            </a>
                                        </div>
                                    `
                                  : ''}
                          </div>
                      `
                    : ''}
                ${this.errorMessage ? html`<div class="message error">${this.errorMessage}</div>` : ''}
            </div>
        `;
    }

    private async loadBookContext(): Promise<void> {
        const bookId = this.bookId;
        if (!bookId) {
            return;
        }

        this.loading = true;
        this.errorMessage = null;
        this.loginRequired = false;

        try {
            const bkper = this.createBkperClient();
            const book = await bkper.getBook(bookId);
            this.bookName = book.getName() ?? bookId;
        } catch (error) {
            this.errorMessage = toErrorMessage(error);
        } finally {
            this.loading = false;
        }
    }

    private async exportCsv(): Promise<void> {
        const bookId = this.bookId;
        if (!bookId) {
            return;
        }

        const validationMessage = getExportValidationMessage(this.query);
        if (validationMessage) {
            this.errorMessage = validationMessage;
            return;
        }

        this.exporting = true;
        this.errorMessage = null;
        this.successMessage = null;
        this.clearDownload();
        this.progressMessage = 'Loading transactions...';

        try {
            const bkper = this.createBkperClient();
            const book = await bkper.getBook(bookId);
            const result = await listTransactionsForExport(book, {
                query: this.query,
                onProgress: loaded => {
                    this.progressMessage = `Loaded ${loaded.toLocaleString()} transactions...`;
                },
            });

            this.progressMessage = 'Building CSV...';
            const normalizedOptions = normalizeExportOptions(this.options);
            const builder = configureTransactionsDataTableBuilder(
                book.createTransactionsDataTable(result.transactions, result.account),
                normalizedOptions,
            );
            const dataTable = await builder.build();
            const csv = dataTableToCsv(dataTable, normalizedOptions.delimiter);
            const filename = createCsvFileName();
            const url = createCsvObjectUrl(csv);

            this.setDownload(url, filename);
            triggerDownload(url, filename);
            this.successMessage = `CSV ready: ${filename}`;
            this.progressMessage = null;
        } catch (error) {
            this.errorMessage = toErrorMessage(error);
            this.progressMessage = null;
        } finally {
            this.exporting = false;
        }
    }

    private updateBooleanOption(key: BooleanExportOption, event: Event): void {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        this.options = normalizeExportOptions({
            ...this.options,
            [key]: target.checked,
        });
    }

    private updateDelimiter(event: Event): void {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
            return;
        }

        if (isCsvDelimiter(target.value)) {
            this.options = normalizeExportOptions({ ...this.options, delimiter: target.value });
        }
    }

    private resetOptions(): void {
        this.options = { ...defaultExportOptions };
    }

    private createBkperClient(): Bkper {
        return new Bkper({
            oauthTokenProvider: async () => this.auth.getAccessToken(),
        });
    }

    private setDownload(url: string, filename: string): void {
        this.revokeDownloadUrl();
        this.downloadUrl = url;
        this.downloadFileName = filename;
    }

    private clearDownload(): void {
        this.revokeDownloadUrl();
        this.downloadUrl = null;
        this.downloadFileName = null;
    }

    private revokeDownloadUrl(): void {
        if (this.downloadUrl) {
            URL.revokeObjectURL(this.downloadUrl);
        }
    }
}

function createCsvObjectUrl(csv: string): string {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    return URL.createObjectURL(blob);
}

function triggerDownload(url: string, filename: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

function isCsvDelimiter(value: string): value is CsvDelimiter {
    return value === ';' || value === ',';
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

declare global {
    interface HTMLElementTagNameMap {
        'csv-export-app': CsvExportApp;
    }
}
