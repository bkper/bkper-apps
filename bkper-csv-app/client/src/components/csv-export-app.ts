import { Bkper } from 'bkper-js';
import type WaCheckbox from '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import type WaSelect from '@awesome.me/webawesome/dist/components/select/select.js';
import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { createAuthSession } from '../auth-session';
import { getAppUrlChange, getMenuContext } from '../context';
import { createCsvFileName } from '../csv';
import { isExportAvailable, type AuthenticationStatus } from '../export-app-state';
import {
    defaultExportOptions,
    normalizeExportOptions,
    type CsvDelimiter,
    type ExportOptions,
} from '../export-config';
import { createCsvExportService } from '../export-service';

type BooleanExportOption = {
    [Key in keyof ExportOptions]: ExportOptions[Key] extends boolean ? Key : never;
}[keyof ExportOptions];

const BKPER_ORIGIN = 'https://bkper.app';

@customElement('csv-export-app')
export class CsvExportApp extends LitElement {
    protected createRenderRoot(): HTMLElement {
        return this;
    }

    @state() private bookId: string | null = null;
    @state() private query = '';
    @state() private bookName: string | null = null;
    @state() private options: ExportOptions = { ...defaultExportOptions };
    @state() private authenticationStatus: AuthenticationStatus = 'pending';
    @state() private loading = false;
    @state() private exporting = false;
    @state() private errorMessage: string | null = null;
    @state() private progressMessage: string | null = null;
    @state() private successMessage: string | null = null;
    @state() private downloadUrl: string | null = null;
    @state() private downloadFileName: string | null = null;

    private contextRevision = 0;
    private readonly handleWindowMessage = (event: MessageEvent): void => {
        const nextUrl = getAppUrlChange(event, {
            parent: window.parent,
            bkperOrigin: BKPER_ORIGIN,
            appOrigin: window.location.origin,
        });
        if (!nextUrl) {
            return;
        }

        window.history.replaceState(window.history.state, '', nextUrl);
        this.applyMenuContext(nextUrl.search);
    };

    private readonly auth = createAuthSession({
        onLoginSuccess: () => {
            this.authenticationStatus = 'authenticated';
            void this.loadBookContext();
        },
        onLoginRequired: () => {
            this.authenticationStatus = 'required';
        },
        onError: error => {
            this.authenticationStatus = 'error';
            this.errorMessage = `Authentication failed: ${toErrorMessage(error)}`;
        },
    });
    private readonly exportService = createCsvExportService(
        new Bkper({
            oauthTokenProvider: async () => this.auth.getAccessToken(),
        })
    );

    connectedCallback(): void {
        super.connectedCallback();

        this.applyMenuContext(window.location.search);
        window.addEventListener('message', this.handleWindowMessage);

        if (this.bookId) {
            void this.auth.init();
        }
    }

    disconnectedCallback(): void {
        window.removeEventListener('message', this.handleWindowMessage);
        this.revokeDownloadUrl();
        super.disconnectedCallback();
    }

    render() {
        return html`
            <main class="csv-app wa-stack wa-gap-m">
                <header class="csv-app-header wa-stack wa-gap-3xs">
                    <h1>Export CSV</h1>
                    <p>Choose options and download transactions from this book.</p>
                </header>

                ${this.renderContext()} ${this.renderPrimaryContent()} ${this.renderMessages()}
            </main>
        `;
    }

    private renderContext() {
        return html`
            <wa-card class="context-card" appearance="filled-outlined">
                <section aria-label="Export context">
                    <div class="book-name">
                        ${this.bookName ?? this.bookId ?? 'Loading book...'}
                    </div>
                    <div class="query">
                        ${this.query ? html`Query: ${this.query}` : 'All transactions'}
                    </div>
                </section>
            </wa-card>
        `;
    }

    private renderPrimaryContent() {
        if (!this.bookId || this.authenticationStatus === 'error') {
            return '';
        }

        if (this.authenticationStatus === 'pending' || this.loading) {
            return html`
                <wa-callout variant="neutral" appearance="filled-outlined" role="status">
                    <div class="wa-cluster wa-gap-xs">
                        <wa-spinner></wa-spinner>
                        <span>Connecting to Bkper...</span>
                    </div>
                </wa-callout>
            `;
        }

        if (this.authenticationStatus === 'required') {
            return this.renderLogin();
        }

        return this.renderExportForm();
    }

    private renderLogin() {
        return html`
            <wa-callout variant="neutral" appearance="filled-outlined">
                <div class="wa-stack wa-gap-m">
                    <span>Please sign in to export transactions from this book.</span>
                    <div class="actions wa-cluster wa-gap-xs wa-justify-content-end">
                        <wa-button variant="brand" @click=${() => this.auth.login()}>
                            Sign in
                        </wa-button>
                    </div>
                </div>
            </wa-callout>
        `;
    }

    private renderExportForm() {
        return html`
            <wa-card class="options-card" appearance="outlined">
                <section class="options-list wa-stack wa-gap-m" aria-label="Export options">
                    <h2 class="options-title">Options</h2>

                    <wa-select
                        label="CSV separator"
                        size="s"
                        .value=${this.options.delimiter}
                        @change=${(event: Event) => this.updateDelimiter(event)}
                    >
                        <wa-option value=";">Semicolon (;)</wa-option>
                        <wa-option value=",">Comma (,)</wa-option>
                    </wa-select>

                    <wa-checkbox
                        size="s"
                        .checked=${this.options.formatDates}
                        @change=${(event: Event) => this.updateBooleanOption('formatDates', event)}
                    >
                        Format dates
                    </wa-checkbox>
                    <wa-checkbox
                        size="s"
                        .checked=${this.options.formatValues}
                        @change=${(event: Event) => this.updateBooleanOption('formatValues', event)}
                    >
                        Format amounts
                    </wa-checkbox>

                    <wa-details summary="Columns" appearance="plain">
                        <div class="columns-list wa-stack wa-gap-s">
                            <wa-checkbox
                                size="s"
                                .checked=${this.options.includeRecordedAt}
                                @change=${(event: Event) =>
                                    this.updateBooleanOption('includeRecordedAt', event)}
                            >
                                Recorded at
                            </wa-checkbox>
                            <wa-checkbox
                                size="s"
                                .checked=${this.options.includeIds}
                                @change=${(event: Event) =>
                                    this.updateBooleanOption('includeIds', event)}
                            >
                                Transaction IDs and remote IDs
                            </wa-checkbox>
                            <wa-checkbox
                                size="s"
                                .checked=${this.options.includeProperties}
                                @change=${(event: Event) =>
                                    this.updateBooleanOption('includeProperties', event)}
                            >
                                Transaction properties
                            </wa-checkbox>
                            <wa-checkbox
                                size="s"
                                .checked=${this.options.includeHiddenProperties}
                                ?disabled=${!this.options.includeProperties}
                                @change=${(event: Event) =>
                                    this.updateBooleanOption('includeHiddenProperties', event)}
                            >
                                Hidden properties
                            </wa-checkbox>
                            <wa-checkbox
                                size="s"
                                .checked=${this.options.includeUrls}
                                @change=${(event: Event) =>
                                    this.updateBooleanOption('includeUrls', event)}
                            >
                                URLs and attachments
                            </wa-checkbox>
                        </div>
                    </wa-details>
                </section>
            </wa-card>

            <div class="actions wa-cluster wa-gap-xs wa-justify-content-end">
                <wa-button
                    appearance="outlined"
                    ?disabled=${this.exporting}
                    @click=${() => this.resetOptions()}
                >
                    Reset
                </wa-button>
                <wa-button
                    variant="brand"
                    ?loading=${this.exporting}
                    ?disabled=${!isExportAvailable({
                        authentication: this.authenticationStatus,
                        loading: this.loading,
                        exporting: this.exporting,
                        bookId: this.bookId,
                    })}
                    @click=${() => {
                        void this.exportCsv();
                    }}
                >
                    Export CSV
                </wa-button>
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
            <div class="messages wa-stack wa-gap-s">
                ${
                    this.progressMessage
                        ? html`<wa-callout
                              variant="neutral"
                              appearance="filled-outlined"
                              role="status"
                              aria-live="polite"
                          >
                              ${this.progressMessage}
                          </wa-callout>`
                        : ''
                }
                ${
                    this.successMessage || this.downloadUrl
                        ? html`
                              <wa-callout
                                  variant="success"
                                  appearance="filled-outlined"
                                  role="status"
                                  aria-live="polite"
                              >
                                  <div class="wa-stack wa-gap-m">
                                      <span>${this.successMessage ?? 'CSV ready.'}</span>
                                      ${
                                          this.downloadUrl && this.downloadFileName
                                              ? html`
                                                    <div class="message-actions">
                                                        <wa-button
                                                            variant="success"
                                                            .href=${this.downloadUrl}
                                                            .download=${this.downloadFileName}
                                                        >
                                                            Download file
                                                        </wa-button>
                                                    </div>
                                                `
                                              : ''
                                      }
                                  </div>
                              </wa-callout>
                          `
                        : ''
                }
                ${
                    this.errorMessage
                        ? html`<wa-callout
                              variant="danger"
                              appearance="filled-outlined"
                              role="alert"
                          >
                              ${this.errorMessage}
                          </wa-callout>`
                        : ''
                }
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

        try {
            const bookName = await this.exportService.getBookName(bookId);
            if (this.bookId === bookId) {
                this.bookName = bookName;
            }
        } catch (error) {
            this.errorMessage = toErrorMessage(error);
        } finally {
            this.loading = false;
        }
    }

    private async exportCsv(): Promise<void> {
        const bookId = this.bookId;
        const query = this.query;
        const contextRevision = this.contextRevision;
        if (!bookId) {
            return;
        }

        this.exporting = true;
        this.errorMessage = null;
        this.successMessage = null;
        this.clearDownload();
        this.progressMessage = 'Loading transactions...';

        try {
            const normalizedOptions = normalizeExportOptions(this.options);
            const result = await this.exportService.createCsv(bookId, {
                query,
                options: normalizedOptions,
                onProgress: loaded => {
                    if (this.contextRevision === contextRevision) {
                        this.progressMessage = `Loaded ${loaded.toLocaleString()} transactions...`;
                    }
                },
                onBuilding: () => {
                    if (this.contextRevision === contextRevision) {
                        this.progressMessage = 'Building CSV...';
                    }
                },
            });

            if (this.contextRevision !== contextRevision) {
                this.errorMessage =
                    'Book context changed. Review the current query and export again.';
                this.progressMessage = null;
                return;
            }

            if (!result.csv) {
                this.errorMessage = 'No transactions found for this export.';
                this.progressMessage = null;
                return;
            }

            const filename = createCsvFileName();
            const url = createCsvObjectUrl(result.csv);

            this.setDownload(url, filename);
            triggerDownload(url, filename);
            this.successMessage = `CSV ready: ${filename} (${formatTransactionCount(result.transactionCount)})`;
            this.progressMessage = null;
        } catch (error) {
            this.errorMessage = toErrorMessage(error);
            this.progressMessage = null;
        } finally {
            this.exporting = false;
        }
    }

    private applyMenuContext(search: string): void {
        const previousBookId = this.bookId;
        const context = getMenuContext(search);

        this.contextRevision += 1;
        this.bookId = context.bookId;
        this.query = context.query;
        this.successMessage = null;
        this.progressMessage = null;
        this.clearDownload();

        if (!this.bookId) {
            this.bookName = null;
            this.errorMessage = 'Missing book context. Open this app from a Bkper book menu.';
            return;
        }

        this.errorMessage = null;
        if (previousBookId !== this.bookId) {
            this.bookName = null;
            if (this.auth.getAccessToken()) {
                void this.loadBookContext();
            }
        }
    }

    private updateBooleanOption(key: BooleanExportOption, event: Event): void {
        const target = event.currentTarget;
        if (!isWaCheckbox(target)) {
            return;
        }

        this.options = normalizeExportOptions({
            ...this.options,
            [key]: target.checked,
        });
    }

    private updateDelimiter(event: Event): void {
        const target = event.currentTarget;
        if (!isWaSelect(target) || typeof target.value !== 'string') {
            return;
        }

        if (isCsvDelimiter(target.value)) {
            this.options = normalizeExportOptions({ ...this.options, delimiter: target.value });
        }
    }

    private resetOptions(): void {
        this.options = { ...defaultExportOptions };
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

function formatTransactionCount(count: number): string {
    return count === 1 ? '1 transaction' : `${count.toLocaleString()} transactions`;
}

function isCsvDelimiter(value: string): value is CsvDelimiter {
    return value === ';' || value === ',';
}

function isWaCheckbox(target: EventTarget | null): target is WaCheckbox {
    return target instanceof HTMLElement && target.localName === 'wa-checkbox';
}

function isWaSelect(target: EventTarget | null): target is WaSelect {
    return target instanceof HTMLElement && target.localName === 'wa-select';
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

declare global {
    interface HTMLElementTagNameMap {
        'csv-export-app': CsvExportApp;
    }
}
