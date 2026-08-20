import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { Suggestion, Transaction } from '../api/app-api';
import { AppController } from '../app/app-controller';
import { appEnvironment } from '../app/app-environment';
import {
    suggestionKey,
    suggestionTransactions,
    type LearningProgress,
} from '../app/review-session';

@customElement('merge-duplicates-app')
export class MergeDuplicatesApp extends LitElement {
    static styles = css`
        :host {
            display: block;
            height: 100vh;
            min-height: 100%;
            box-sizing: border-box;
            container-type: inline-size;
            background: var(--bkper-color-background);
            color: var(--bkper-color-text);
            font-family: var(--bkper-font-family);
        }

        .app,
        .app-content,
        .messages,
        .app-header,
        .brand-copy,
        .review,
        .review-body,
        .pair-list,
        .pair-transactions,
        .results,
        .result-copy,
        .dialog-copy,
        .context-update,
        .stack {
            display: grid;
        }

        .app {
            height: 100%;
            min-height: 100%;
            grid-template-rows: auto minmax(0, 1fr);
            overflow: hidden;
        }

        .app-content {
            min-height: 0;
            grid-template-rows: auto minmax(0, 1fr);
            overflow: hidden;
        }

        .messages {
            gap: var(--bkper-spacing-small);
            padding: var(--bkper-spacing-medium);
        }

        .context-update {
            gap: var(--bkper-spacing-small);
        }

        .context-update-action {
            width: 100%;
        }

        .screen {
            grid-row: 2;
            min-height: 0;
            overflow-y: auto;
        }

        .review {
            height: 100%;
            min-height: 0;
            grid-template-rows: auto minmax(0, 1fr) auto;
            overflow: hidden;
        }

        .review-body,
        .pair-list,
        .pair-transactions {
            align-content: start;
        }

        .review-body {
            min-height: 0;
            overflow-y: auto;
        }

        .app-header {
            gap: var(--bkper-spacing-medium);
            padding: var(--bkper-spacing-medium);
            border-bottom: var(--bkper-border);
        }

        .brand,
        .scope,
        .review-master,
        .review-footer,
        .result-row,
        .actions {
            display: flex;
            align-items: center;
        }

        .brand,
        .scope,
        .review-master,
        .result-row,
        .actions {
            gap: var(--bkper-spacing-small);
        }

        .brand img {
            width: var(--bkper-spacing-2x-large);
            height: var(--bkper-spacing-2x-large);
        }

        .brand-copy,
        .result-copy {
            gap: var(--bkper-spacing-3x-small);
        }

        h1,
        h2,
        h3,
        p {
            margin: 0;
        }

        h1 {
            font-size: var(--bkper-font-size-large);
        }

        h2,
        h3 {
            font-size: var(--bkper-font-size-medium);
        }

        .subtitle,
        .muted,
        .scan-summary,
        .pair-explanation,
        .progress-message {
            color: var(--bkper-color-neutral);
            font-size: var(--bkper-font-size-small);
            line-height: var(--bkper-line-height-normal);
        }

        .scope {
            min-width: 0;
        }

        .scope-label,
        .section-label {
            flex: 0 0 auto;
            color: var(--bkper-color-neutral);
            font-size: var(--bkper-font-size-x-small);
            font-weight: var(--bkper-font-weight-bold);
            text-transform: uppercase;
        }

        .scope-query {
            min-width: 0;
            overflow: hidden;
            color: var(--bkper-color-neutral);
            font-family: var(--bkper-font-family-code);
            font-size: var(--bkper-font-size-small);
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .center,
        .loading-status {
            display: grid;
            min-height: var(--bkper-spacing-4x-large);
            place-items: center;
        }

        .loading-status {
            grid-auto-flow: column;
            justify-content: center;
            gap: var(--bkper-spacing-small);
            color: var(--bkper-color-neutral);
            font-size: var(--bkper-font-size-small);
        }

        .review-toolbar {
            position: sticky;
            top: 0;
            z-index: 1;
            padding: var(--bkper-spacing-small) var(--bkper-spacing-medium);
            border-bottom: var(--bkper-border);
            background: var(--bkper-color-background);
        }

        .review-master {
            justify-content: space-between;
        }

        .master-checkbox {
            min-width: 0;
            font-weight: var(--bkper-font-weight-bold);
        }

        .selection-count {
            flex: 0 0 auto;
            color: var(--bkper-color-primary);
            font-size: var(--bkper-font-size-small);
            font-weight: var(--bkper-font-weight-bold);
        }

        .scan-summary {
            margin-top: var(--bkper-spacing-3x-small);
            padding-left: var(--bkper-spacing-large);
        }

        .pair {
            border-bottom: var(--bkper-border);
            background: var(--bkper-color-background);
            cursor: pointer;
            transition: background-color var(--wa-transition-fast);
        }

        @media (hover: hover) {
            .pair:hover {
                background: var(--bkper-color-grey-low);
            }
        }

        .pair + .pair {
            border-top: var(--bkper-spacing-small) solid var(--bkper-color-background);
        }

        .pair-heading {
            padding: var(--bkper-spacing-small) var(--bkper-spacing-medium);
        }

        .pair-selector {
            width: 100%;
        }

        .pair-selector::part(checkbox) {
            align-items: flex-start;
        }

        .pair-copy {
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            gap: var(--bkper-spacing-3x-small) var(--bkper-spacing-small);
        }

        .pair-strength {
            font-size: var(--bkper-font-size-small);
            font-weight: var(--bkper-font-weight-bold);
        }

        .pair-explanation {
            min-width: 0;
            overflow-wrap: anywhere;
        }

        .pair-separator {
            display: none;
            margin-inline-end: var(--bkper-spacing-small);
        }

        @container (min-width: 72ch) {
            .pair-separator {
                display: inline;
            }
        }

        .pair-transactions {
            border-top: var(--bkper-border);
        }

        .transaction-row {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            align-items: start;
            column-gap: var(--bkper-spacing-small);
            padding: var(--bkper-spacing-small) var(--bkper-spacing-medium);
        }

        .transaction-row + .transaction-row {
            border-top: var(--bkper-border);
        }

        .transaction-status {
            color: var(--bkper-color-neutral);
            font-size: var(--bkper-font-size-small);
        }

        .transaction-status.draft {
            color: var(--bkper-color-danger);
        }

        .transaction-content {
            display: flex;
            min-width: 0;
            align-items: center;
            flex-wrap: wrap;
            gap: var(--bkper-spacing-x-small) var(--bkper-spacing-small);
        }

        .transaction-summary,
        .account-flow {
            display: flex;
            align-items: center;
            white-space: nowrap;
        }

        .transaction-summary {
            flex: 0 0 auto;
            gap: var(--bkper-spacing-small);
        }

        .account-flow {
            flex: 0 1 auto;
            min-width: 0;
            max-width: 100%;
            gap: var(--bkper-spacing-small);
        }

        .transaction-date {
            min-width: 0;
        }

        .date,
        .amount {
            font-size: var(--bkper-font-size-small);
            font-weight: var(--bkper-font-weight-bold);
        }

        .amount {
            font-family: var(--bkper-font-family-code);
        }

        .account-pill {
            max-width: 100%;
            padding-inline: var(--bkper-spacing-small);
            overflow: hidden;
            border-radius: var(--bkper-spacing-small);
            font-size: var(--bkper-font-size-small);
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .account-pill.asset {
            background: var(--bkper-color-blue-medium);
        }

        .account-pill.liability {
            background: var(--bkper-color-yellow-medium);
        }

        .account-pill.incoming {
            background: var(--bkper-color-green-medium);
        }

        .account-pill.outgoing {
            background: var(--bkper-color-red-medium);
        }

        .unassigned,
        .movement-arrow {
            color: var(--bkper-color-neutral);
            font-size: var(--bkper-font-size-small);
        }

        .description {
            min-width: 0;
            flex: 1 1 20ch;
            overflow-wrap: anywhere;
            font-size: var(--bkper-font-size-small);
        }

        .pagination,
        .empty-review {
            padding: var(--bkper-spacing-medium);
        }

        .pagination wa-button,
        .primary-action {
            width: 100%;
        }

        .review-footer {
            z-index: 1;
            justify-content: space-between;
            gap: var(--bkper-spacing-medium);
            padding: var(--bkper-spacing-small) var(--bkper-spacing-medium);
            border-top: var(--bkper-border);
            background: var(--bkper-color-background);
            box-shadow: var(--wa-shadow-s);
        }

        .footer-count {
            display: grid;
            font-size: var(--bkper-font-size-small);
        }

        .footer-count span {
            color: var(--bkper-color-neutral);
        }

        .stack,
        .results,
        .dialog-copy {
            gap: var(--bkper-spacing-medium);
        }

        .stack {
            padding: var(--bkper-spacing-medium);
        }

        .result-row {
            justify-content: space-between;
            gap: var(--bkper-spacing-small);
        }

        .actions {
            flex-wrap: wrap;
            padding-block: var(--bkper-spacing-small);
        }

        .actions wa-button {
            flex: 1 1 auto;
        }

        .status-merged {
            color: var(--bkper-color-success);
        }

        .status-failed {
            color: var(--bkper-color-danger);
        }
    `;

    readonly controller = new AppController(this);

    @state()
    embedded = appEnvironment.isEmbedded();

    render(): TemplateResult {
        const state = this.controller.state;
        const review = this.controller.review;

        return html`
            <main class="app">
                ${this.renderHeader()}
                <div class="app-content">
                    ${
                        state.error || state.notice || state.contextUpdateAvailable
                            ? html`
                                  <div class="messages">
                                      ${
                                          state.error
                                              ? this.renderCallout(
                                                    state.error,
                                                    'danger',
                                                    'circle-exclamation'
                                                )
                                              : html``
                                      }
                                      ${
                                          state.contextUpdateAvailable
                                              ? this.renderContextUpdate()
                                              : html``
                                      }
                                      ${
                                          state.notice
                                              ? this.renderCallout(
                                                    state.notice,
                                                    'neutral',
                                                    'circle-info'
                                                )
                                              : html``
                                      }
                                  </div>
                              `
                            : html``
                    }
                    <div class="screen">
                        ${
                            state.authenticating && state.pages === 0
                                ? html`<div class="center" role="status">
                                      <wa-spinner></wa-spinner>
                                  </div>`
                                : html``
                        }
                        ${state.analyzing && state.pages === 0 ? this.renderAnalyzing() : html``}
                        ${state.applying ? this.renderLiveProgress() : html``}
                        ${
                            state.pages > 0 && !review.processed && !state.applying
                                ? this.renderReview()
                                : html``
                        }
                        ${review.processed && !state.applying ? this.renderResults() : html``}
                    </div>
                </div>
            </main>
            ${this.renderConfirmation()}
        `;
    }

    private renderHeader(): TemplateResult {
        const query = this.controller.state.context.query;
        if (this.embedded && !query) return html``;

        return html`
            <header class="app-header">
                ${
                    this.embedded
                        ? html``
                        : html`
                              <div class="brand">
                                  <picture>
                                      <source
                                          media="(prefers-color-scheme: dark)"
                                          srcset="/images/logo-dark.svg"
                                      />
                                      <img
                                          src="/images/logo-light.svg"
                                          alt="Merge Duplicates logo"
                                      />
                                  </picture>
                                  <div class="brand-copy">
                                      <h1>Merge Duplicates</h1>
                                      <p class="subtitle">
                                          Review likely matches before anything changes.
                                      </p>
                                  </div>
                              </div>
                          `
                }
                ${
                    query
                        ? html`
                              <div class="scope">
                                  <span class="scope-label">Scope</span>
                                  <span class="scope-query" title=${query}>${query}</span>
                              </div>
                          `
                        : html``
                }
            </header>
        `;
    }

    private renderAnalyzing(): TemplateResult {
        return html`
            <div class="loading-status" role="status">
                <wa-spinner></wa-spinner>
                <span>Looking for duplicates…</span>
            </div>
        `;
    }

    private renderReview(): TemplateResult {
        const state = this.controller.state;
        const review = this.controller.review;
        const total = review.suggestions.length;
        const selected = review.accepted.length;
        const allSelected = total > 0 && selected === total;
        const partiallySelected = selected > 0 && selected < total;
        const skippedSummary = state.skipped.total > 0 ? ` · ${state.skipped.total} skipped` : '';

        return html`
            <section class="review" aria-labelledby="review-title">
                <header class="review-toolbar">
                    <div class="review-master">
                        <wa-checkbox
                            class="master-checkbox"
                            size="s"
                            .checked=${allSelected}
                            .indeterminate=${partiallySelected}
                            ?disabled=${total === 0}
                            @change=${this.handleAllSelection}
                        >
                            <span id="review-title">
                                ${total} suggested pair${total === 1 ? '' : 's'}
                            </span>
                        </wa-checkbox>
                        <span class="selection-count">${selected} to merge</span>
                    </div>
                    <p class="scan-summary">
                        Unselect pairs that are not duplicates. ${state.scanned}
                        transaction${state.scanned === 1 ? '' : 's'} reviewed${skippedSummary}
                    </p>
                </header>

                <div class="review-body">
                    ${
                        total > 0
                            ? html`
                                  <div class="pair-list">
                                      ${review.suggestions.map(suggestion =>
                                          this.renderSuggestion(
                                              suggestion,
                                              review.selectedIds.has(suggestionKey(suggestion))
                                          )
                                      )}
                                  </div>
                              `
                            : html`
                                  <div class="empty-review">
                                      ${this.renderCallout(
                                          'No likely duplicate pairs found in this batch.',
                                          'neutral',
                                          'circle-check'
                                      )}
                                  </div>
                              `
                    }
                    ${
                        review.cursor
                            ? html`
                                  <div class="pagination">
                                      <wa-button
                                          appearance="outlined"
                                          ?loading=${state.analyzing}
                                          ?disabled=${state.applying}
                                          @click=${() => this.controller.analyzeNext()}
                                      >
                                          Look for more
                                      </wa-button>
                                  </div>
                              `
                            : html``
                    }
                </div>
                ${
                    total > 0
                        ? html`
                              <footer class="review-footer">
                                  <div class="footer-count">
                                      <strong>${selected} to merge</strong>
                                      <span>
                                          ${review.rejected.length} not
                                          duplicate${review.rejected.length === 1 ? '' : 's'}
                                      </span>
                                  </div>
                                  <wa-button
                                      variant="brand"
                                      appearance="filled"
                                      ?disabled=${state.analyzing || state.applying}
                                      @click=${() => this.controller.showConfirmation()}
                                  >
                                      Apply
                                  </wa-button>
                              </footer>
                          `
                        : html``
                }
            </section>
        `;
    }

    private renderSuggestion(suggestion: Suggestion, selected: boolean): TemplateResult {
        const key = suggestionKey(suggestion);
        const [first, second] = suggestionTransactions(suggestion);
        return html`
            <article class="pair" @click=${(event: MouseEvent) => this.handlePairClick(event, key)}>
                <div class="pair-heading">
                    <wa-checkbox
                        class="pair-selector"
                        size="s"
                        .checked=${selected}
                        @change=${(event: Event) => this.handlePairSelection(event, key)}
                    >
                        <span class="pair-copy">
                            <span class="pair-strength">${suggestion.strength} match</span>
                            <span class="pair-explanation"
                                ><span class="pair-separator" aria-hidden="true">—</span
                                >${suggestion.explanation}</span
                            >
                        </span>
                    </wa-checkbox>
                </div>
                <div class="pair-transactions">
                    ${this.renderTransaction(first)} ${this.renderTransaction(second)}
                </div>
            </article>
        `;
    }

    private renderTransaction(transaction: Transaction): TemplateResult {
        const formattedDate = this.getShortDate(transaction);
        const draft = transaction.posted !== true;
        return html`
            <div class="transaction-row">
                <wa-icon
                    class="transaction-status ${draft ? 'draft' : ''}"
                    name=${draft ? 'angles-right' : 'check'}
                    label=${draft ? 'Draft' : 'Posted'}
                ></wa-icon>
                <div class="transaction-content">
                    <div class="transaction-summary">
                        <time
                            class="transaction-date"
                            datetime=${transaction.date ?? ''}
                            title=${transaction.dateFormatted || transaction.date || ''}
                        >
                            <span class="date">${formattedDate}</span>
                        </time>
                        <span class="amount"
                            >${this.controller.formatAmount(transaction.amount)}</span
                        >
                    </div>
                    <div class="account-flow">
                        ${this.renderAccount(transaction.creditAccount)}
                        <wa-icon class="movement-arrow" name="angles-right" label="to"></wa-icon>
                        ${this.renderAccount(transaction.debitAccount)}
                    </div>
                    <span class="description"
                        >${transaction.description || '(no description)'}</span
                    >
                </div>
            </div>
        `;
    }

    private renderAccount(account: Transaction['creditAccount']): TemplateResult {
        if (!account) {
            return html`<span class="unassigned" role="img" aria-label="Unassigned account"
                >—</span
            >`;
        }
        const typeClass = account.type?.toLowerCase() ?? '';
        return html`<span class="account-pill ${typeClass}" title=${account.name}
            >${account.name}</span
        >`;
    }

    private getShortDate(transaction: Transaction): string {
        const date = transaction.date ?? '';
        const formatted = transaction.dateFormatted || date;
        const currentYear = new Date().getFullYear().toString();
        if (!date.startsWith(currentYear)) return formatted;
        if (formatted.startsWith(`${currentYear}/`) || formatted.startsWith(`${currentYear}-`)) {
            return formatted.slice(5);
        }
        if (formatted.endsWith(`/${currentYear}`) || formatted.endsWith(`-${currentYear}`)) {
            return formatted.slice(0, -5);
        }
        return formatted;
    }

    private handlePairClick(event: MouseEvent, id: string): void {
        const clickedCheckbox = event
            .composedPath()
            .some(target => target instanceof Element && target.localName === 'wa-checkbox');
        if (clickedCheckbox) return;
        const selected = this.controller.review.selectedIds.has(id);
        this.controller.setSuggestionSelected(id, !selected);
    }

    private handlePairSelection(event: Event, id: string): void {
        const checkbox = event.currentTarget as HTMLElement & { checked: boolean };
        this.controller.setSuggestionSelected(id, checkbox.checked);
    }

    private handleAllSelection = (event: Event): void => {
        const checkbox = event.currentTarget as HTMLElement & { checked: boolean };
        this.controller.setAllSuggestionsSelected(checkbox.checked);
    };

    private renderLiveProgress(): TemplateResult {
        const review = this.controller.review;
        const completed = review.progress.filter(item =>
            ['merged', 'failed'].includes(item.status)
        ).length;
        const percentage =
            review.progress.length === 0 ? 0 : (completed / review.progress.length) * 100;
        return html`
            <section class="stack" aria-live="polite">
                <div>
                    <p class="section-label">Applying</p>
                    <h2>${completed} of ${review.progress.length} pairs processed</h2>
                </div>
                <wa-progress-bar .value=${percentage} label="Merge progress"></wa-progress-bar>
                <div class="results">
                    ${review.progress.map(
                        item => html`
                            <div class="result-row">
                                <div class="result-copy">
                                    <strong
                                        >${suggestionTransactions(item.suggestion)[0].description || suggestionKey(item.suggestion)}</strong
                                    >
                                    <span class="progress-message"
                                        >${item.message || item.status}</span
                                    >
                                </div>
                                ${
                                    item.status === 'merging' || item.status === 'pending'
                                        ? html`<wa-spinner></wa-spinner>`
                                        : html`<wa-icon
                                              class=${item.status === 'merged' ? 'status-merged' : 'status-failed'}
                                              name=${item.status === 'merged' ? 'circle-check' : 'circle-exclamation'}
                                              label=${item.status}
                                          ></wa-icon>`
                                }
                            </div>
                        `
                    )}
                </div>
            </section>
        `;
    }

    private renderResults(): TemplateResult {
        const review = this.controller.review;
        const merged = review.progress.filter(item => item.status === 'merged').length;
        const failed = review.progress.filter(item => item.status === 'failed').length;
        return html`
            <section class="stack" aria-labelledby="results-title">
                <div>
                    <p class="section-label">Complete</p>
                    <h2 id="results-title">
                        ${merged} pair${merged === 1 ? '' : 's'}
                        merged${failed ? `, ${failed} failed` : ''}
                    </h2>
                    <p class="muted">Your duplicate review is complete.</p>
                </div>
                ${
                    this.controller.state.applying && review.progress.length > 0
                        ? html`
                              <wa-progress-bar
                                  .value=${
                                      (review.progress.filter(item =>
                                          ['merged', 'failed'].includes(item.status)
                                      ).length /
                                          review.progress.length) *
                                      100
                                  }
                                  label="Merge progress"
                              ></wa-progress-bar>
                          `
                        : html``
                }
                <div class="results">
                    ${review.progress.map(
                        item => html`
                            <div class="result-row">
                                <div class="result-copy">
                                    <strong
                                        >${suggestionTransactions(item.suggestion)[0].description || suggestionKey(item.suggestion)}</strong
                                    >
                                    ${item.message ? html`<span class="progress-message">${item.message}</span>` : html``}
                                </div>
                                ${
                                    item.status === 'merging'
                                        ? html`<wa-spinner></wa-spinner>`
                                        : html`<wa-icon
                                              class=${item.status === 'merged' ? 'status-merged' : 'status-failed'}
                                              name=${item.status === 'merged' ? 'circle-check' : 'circle-exclamation'}
                                              label=${item.status}
                                          ></wa-icon>`
                                }
                            </div>
                        `
                    )}
                    ${review.learningResults.map(
                        item => html`
                            <div class="result-row">
                                <div class="result-copy">
                                    <strong>Rejected-pair learning</strong>
                                    ${this.renderLearningMessage(item)}
                                </div>
                                <wa-badge
                                    variant=${item.status === 'failed' ? 'danger' : 'neutral'}
                                    appearance="outlined"
                                    >${item.status}</wa-badge
                                >
                            </div>
                        `
                    )}
                </div>
                <wa-button
                    class="primary-action"
                    variant="brand"
                    appearance="filled"
                    ?disabled=${this.controller.state.applying}
                    @click=${() => this.controller.scanAgain()}
                >
                    <wa-icon slot="start" name="rotate"></wa-icon>
                    ${
                        this.controller.state.contextUpdateAvailable
                            ? 'Scan current view'
                            : 'Scan again'
                    }
                </wa-button>
            </section>
        `;
    }

    private renderLearningMessage(item: LearningProgress): TemplateResult {
        const pairCount = item.status === 'saved' ? item.savedCount : item.suggestions.length;
        const pairs = `rejected pair${pairCount === 1 ? '' : 's'}`;
        if (item.status === 'saved') {
            const resourceType = item.resourceType
                ? `${item.resourceType[0].toUpperCase()}${item.resourceType.slice(1)}`
                : 'resource';
            const resource = item.resourceName
                ? `${resourceType} “${item.resourceName}”`
                : resourceType;
            return html`
                <span class="progress-message">
                    ${pairCount} ${pairs} saved to property
                    <code>${item.propertyKey || 'merge_duplicate_examples'}</code> on ${resource}.
                </span>
            `;
        }
        if (item.status === 'skipped') {
            return html`<span class="progress-message"
                >${item.message || `${pairCount} ${pairs} were not saved.`}</span
            >`;
        }
        return html`
            <span class="progress-message">
                ${pairCount} ${pairs} could not be saved.${item.message ? ` ${item.message}` : ''}
            </span>
        `;
    }

    private renderConfirmation(): TemplateResult {
        const state = this.controller.state;
        const review = this.controller.review;
        return html`
            <wa-dialog
                label="Apply review?"
                ?open=${state.confirmOpen}
                @wa-after-hide=${() => this.controller.hideConfirmation()}
            >
                <div class="dialog-copy">
                    ${
                        review.accepted.length > 0
                            ? html`
                                  <p>
                                      <strong
                                          >${review.accepted.length}
                                          pair${review.accepted.length === 1 ? '' : 's'}</strong
                                      >
                                      will be merged.
                                  </p>
                              `
                            : html``
                    }
                    ${
                        review.rejected.length > 0
                            ? html`
                                  <p>
                                      <strong
                                          >${review.rejected.length}
                                          pair${review.rejected.length === 1 ? '' : 's'}</strong
                                      >
                                      will become
                                      ${
                                          review.rejected.length === 1
                                              ? 'a not-duplicate learning example'
                                              : 'not-duplicate learning examples'
                                      }.
                                  </p>
                              `
                            : html``
                    }
                    ${
                        review.accepted.length > 0
                            ? html`
                                  <wa-callout variant="warning" appearance="filled-outlined">
                                      <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
                                      Each selected pair will be combined into one transaction. The
                                      two originals will be moved to Trash.
                                  </wa-callout>
                              `
                            : html``
                    }
                </div>
                <wa-button slot="footer" appearance="plain" data-dialog="close">Cancel</wa-button>
                <wa-button
                    slot="footer"
                    variant="brand"
                    appearance="filled"
                    @click=${() => this.controller.confirmApply()}
                >
                    Apply
                </wa-button>
            </wa-dialog>
        `;
    }

    private renderContextUpdate(): TemplateResult {
        return html`
            <wa-callout variant="warning" appearance="filled-outlined" size="small">
                <wa-icon slot="icon" name="rotate"></wa-icon>
                <div class="context-update">
                    <span>The Book view changed. These results still use the previous scope.</span>
                    <wa-button
                        class="context-update-action"
                        variant="brand"
                        appearance="filled"
                        size="small"
                        ?disabled=${this.controller.state.applying}
                        @click=${() => this.controller.updateResults()}
                    >
                        Update results
                    </wa-button>
                </div>
            </wa-callout>
        `;
    }

    private renderCallout(
        message: string,
        variant: 'neutral' | 'danger',
        icon: string
    ): TemplateResult {
        return html`
            <wa-callout variant=${variant} appearance="filled-outlined" size="small">
                <wa-icon slot="icon" name=${icon}></wa-icon>
                ${message}
            </wa-callout>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'merge-duplicates-app': MergeDuplicatesApp;
    }
}
