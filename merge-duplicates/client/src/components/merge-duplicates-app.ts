import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { Suggestion, TransactionFingerprint } from '../api/app-api';
import { AppController } from '../app/app-controller';
import { appEnvironment } from '../app/app-environment';

@customElement('merge-duplicates-app')
export class MergeDuplicatesApp extends LitElement {
    static styles = css`
        :host {
            display: block;
            min-height: 100%;
            box-sizing: border-box;
            padding: var(--bkper-spacing-medium);
            background: var(--bkper-color-background);
            color: var(--bkper-color-text);
            font-family: var(--bkper-font-family);
        }

        .app,
        .stack,
        .pair,
        .transaction,
        .results {
            display: grid;
        }

        .app {
            gap: var(--bkper-spacing-large);
        }

        .stack,
        .results {
            gap: var(--bkper-spacing-medium);
        }

        .pair,
        .transaction {
            gap: var(--bkper-spacing-small);
        }

        .brand,
        .title-row,
        .stats,
        .card-heading,
        .transaction-meta,
        .actions,
        .result-row {
            display: flex;
            align-items: center;
        }

        .brand,
        .title-row,
        .card-heading,
        .transaction-meta,
        .actions,
        .result-row {
            gap: var(--bkper-spacing-small);
        }

        .title-row,
        .card-heading,
        .result-row {
            justify-content: space-between;
        }

        .brand img {
            width: var(--bkper-spacing-2x-large);
            height: var(--bkper-spacing-2x-large);
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
        .transaction-meta,
        .properties,
        .progress-message {
            color: var(--bkper-color-neutral);
            font-size: var(--bkper-font-size-small);
            line-height: var(--bkper-line-height-normal);
        }

        .query-label,
        .section-label {
            color: var(--bkper-color-neutral);
            font-size: var(--bkper-font-size-x-small);
            font-weight: var(--bkper-font-weight-bold);
            text-transform: uppercase;
        }

        .query {
            padding: var(--bkper-spacing-small);
            overflow-wrap: anywhere;
            border: var(--bkper-border);
            border-radius: var(--bkper-border-radius);
            background: var(--bkper-color-grey-low);
            font-family: var(--bkper-font-family-code);
            font-size: var(--bkper-font-size-small);
        }

        .stats {
            flex-wrap: wrap;
            gap: var(--bkper-spacing-x-small);
        }

        wa-card {
            --spacing: var(--bkper-spacing-medium);
        }

        wa-details {
            --spacing: var(--bkper-spacing-medium);
        }

        .card-heading > div,
        .description,
        .result-copy {
            min-width: 0;
        }

        .transaction {
            padding: var(--bkper-spacing-small);
            border: var(--bkper-border);
            border-radius: var(--bkper-border-radius);
        }

        .transaction-meta {
            flex-wrap: wrap;
            justify-content: space-between;
        }

        .amount {
            color: var(--bkper-color-text);
            font-family: var(--bkper-font-family-code);
            font-weight: var(--bkper-font-weight-bold);
        }

        .movement {
            overflow-wrap: anywhere;
            font-size: var(--bkper-font-size-small);
            font-weight: var(--bkper-font-weight-bold);
        }

        .description,
        .properties,
        .progress-message {
            overflow-wrap: anywhere;
        }

        .merge-mark {
            justify-self: center;
            color: var(--bkper-color-primary);
        }

        .card-action,
        .primary-action {
            width: 100%;
        }

        .actions {
            flex-wrap: wrap;
            padding-block: var(--bkper-spacing-small);
        }

        .actions wa-button {
            flex: 1 1 auto;
        }

        .center {
            display: grid;
            min-height: var(--bkper-spacing-4x-large);
            place-items: center;
        }

        .dialog-copy {
            display: grid;
            gap: var(--bkper-spacing-medium);
        }

        .result-copy {
            display: grid;
            gap: var(--bkper-spacing-3x-small);
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
                ${
                    state.authenticating && state.pages === 0
                        ? html`<div class="center" role="status"><wa-spinner></wa-spinner></div>`
                        : html``
                }
                ${state.error ? this.renderCallout(state.error, 'danger', 'circle-exclamation') : html``}
                ${state.notice ? this.renderCallout(state.notice, 'neutral', 'circle-info') : html``}
                ${state.analyzing ? this.renderAnalyzing() : html``}
                ${state.applying ? this.renderLiveProgress() : html``}
                ${state.pages > 0 && !review.processed && !state.applying ? this.renderReview() : html``}
                ${review.processed && !state.applying ? this.renderResults() : html``}
            </main>
            ${this.renderConfirmation()}
        `;
    }

    private renderHeader(): TemplateResult {
        const query = this.controller.state.context.query;
        return html`
            <header class="stack">
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
                                  <div>
                                      <h1>Merge Duplicates</h1>
                                      <p class="subtitle">
                                          Review AI-assisted matches before anything changes.
                                      </p>
                                  </div>
                              </div>
                          `
                }
                <div class="stack">
                    <span class="query-label">Captured transaction query</span>
                    <div class="query" role="textbox" aria-readonly="true">
                        ${query || '(all transactions)'}
                    </div>
                </div>
            </header>
        `;
    }

    private renderAnalyzing(): TemplateResult {
        return html`
            <wa-callout variant="brand" appearance="filled-outlined" size="small">
                <wa-spinner slot="icon"></wa-spinner>
                <strong>Looking for duplicate transactions</strong><br />
                Filtering deterministic candidates before one Bkper AI request.
            </wa-callout>
        `;
    }

    private renderReview(): TemplateResult {
        const state = this.controller.state;
        const review = this.controller.review;
        const total = review.accepted.length + review.rejected.length;
        return html`
            <section class="stack" aria-labelledby="review-title">
                <div class="title-row">
                    <div>
                        <p class="section-label">Review</p>
                        <h2 id="review-title">
                            ${total} duplicate suggestion${total === 1 ? '' : 's'}
                        </h2>
                    </div>
                    <wa-badge variant="brand" appearance="filled" pill>
                        ${review.accepted.length} accepted
                    </wa-badge>
                </div>

                <div class="stats" aria-label="Scan totals">
                    <wa-badge variant="neutral" appearance="outlined"
                        >${state.scanned} scanned</wa-badge
                    >
                    <wa-badge variant="neutral" appearance="outlined">
                        ${state.candidateCount} candidates
                    </wa-badge>
                    <wa-badge variant="warning" appearance="outlined">
                        ${state.skipped.total} skipped
                    </wa-badge>
                </div>
                ${
                    state.skipped.total > 0
                        ? html`<p class="muted">
                              Skipped: ${state.skipped.checked} checked, ${state.skipped.trashed}
                              trashed, ${state.skipped.locked} locked.
                          </p>`
                        : html``
                }
                ${
                    review.accepted.length > 0
                        ? html`<div class="stack">
                              ${review.accepted.map(suggestion => this.renderSuggestion(suggestion, false))}
                          </div>`
                        : this.renderCallout(
                              'No accepted suggestions on the pages analyzed so far.',
                              'neutral',
                              'circle-info'
                          )
                }
                ${
                    review.rejected.length > 0
                        ? html`
                              <wa-details appearance="outlined">
                                  <span slot="summary">Rejected (${review.rejected.length})</span>
                                  <div class="stack">
                                      ${review.rejected.map(suggestion =>
                                          this.renderSuggestion(suggestion, true)
                                      )}
                                  </div>
                              </wa-details>
                          `
                        : html``
                }

                <div class="actions">
                    ${
                        review.cursor
                            ? html`
                                  <wa-button
                                      appearance="outlined"
                                      ?loading=${state.analyzing}
                                      ?disabled=${state.applying}
                                      @click=${() => this.controller.analyzeNext()}
                                  >
                                      Analyze next 200
                                  </wa-button>
                              `
                            : html``
                    }
                    ${
                        total > 0
                            ? html`
                                  <wa-button
                                      variant="brand"
                                      appearance="filled"
                                      ?disabled=${state.analyzing || state.applying}
                                      @click=${() => this.controller.showConfirmation()}
                                  >
                                      Apply review
                                  </wa-button>
                              `
                            : html``
                    }
                </div>
            </section>
        `;
    }

    private renderSuggestion(suggestion: Suggestion, rejected: boolean): TemplateResult {
        return html`
            <wa-card appearance=${rejected ? 'plain' : 'outlined'}>
                <div slot="header" class="card-heading">
                    <div>
                        <h3>${suggestion.strength}</h3>
                        <p class="muted">${suggestion.explanation}</p>
                    </div>
                    <wa-badge
                        variant=${suggestion.strength === 'Strong' ? 'success' : 'warning'}
                        appearance="filled-outlined"
                        pill
                    >
                        ${suggestion.strength}
                    </wa-badge>
                </div>
                <div class="pair">
                    ${this.renderTransaction(suggestion.first)}
                    <wa-icon class="merge-mark" name="code-merge" label="Compared with"></wa-icon>
                    ${this.renderTransaction(suggestion.second)}
                </div>
                <wa-button
                    slot="footer"
                    class="card-action"
                    variant=${rejected ? 'neutral' : 'danger'}
                    appearance="outlined"
                    @click=${() =>
                        rejected
                            ? this.controller.undo(suggestion.id)
                            : this.controller.reject(suggestion.id)}
                >
                    <wa-icon slot="start" name=${rejected ? 'rotate-left' : 'xmark'}></wa-icon>
                    ${rejected ? 'Undo' : 'Not a duplicate'}
                </wa-button>
            </wa-card>
        `;
    }

    private renderTransaction(transaction: TransactionFingerprint): TemplateResult {
        const properties = Object.entries(transaction.properties);
        return html`
            <article class="transaction">
                <div class="transaction-meta">
                    <time datetime=${transaction.date}>${transaction.date}</time>
                    <span class="amount">${transaction.amount}</span>
                </div>
                <div class="movement">
                    ${transaction.fromAccount?.name || 'Unassigned'}
                    <wa-icon name="arrow-right"></wa-icon>
                    ${transaction.toAccount?.name || 'Unassigned'}
                </div>
                <p class="description">${transaction.description || '(no description)'}</p>
                ${
                    properties.length > 0
                        ? html`<p class="properties">
                              ${properties.map(([key, value]) => `${key}: ${value}`).join(' · ')}
                          </p>`
                        : html``
                }
            </article>
        `;
    }

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
                                        >${item.suggestion.first.description || item.suggestion.id}</strong
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
                    <h2 id="results-title">${merged} merged, ${failed} failed</h2>
                    <p class="muted">Pagination was invalidated after processing.</p>
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
                                        >${item.suggestion.first.description || item.suggestion.id}</strong
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
                                    <span class="progress-message"
                                        >${item.message || item.status}</span
                                    >
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
                    Scan again
                </wa-button>
            </section>
        `;
    }

    private renderConfirmation(): TemplateResult {
        const state = this.controller.state;
        const review = this.controller.review;
        return html`
            <wa-dialog
                label="Confirm duplicate review"
                ?open=${state.confirmOpen}
                @wa-after-hide=${() => this.controller.hideConfirmation()}
            >
                <div class="dialog-copy">
                    <p>
                        <strong>${review.accepted.length} accepted</strong> and
                        <strong>${review.rejected.length} rejected</strong>.
                    </p>
                    <wa-callout variant="warning" appearance="filled-outlined">
                        <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
                        Merging creates canonical transactions and trashes the originals. Each
                        accepted pair will be processed separately, and failures will not stop later
                        pairs.
                    </wa-callout>
                </div>
                <wa-button slot="footer" appearance="plain" data-dialog="close">Cancel</wa-button>
                <wa-button
                    slot="footer"
                    variant="brand"
                    appearance="filled"
                    @click=${() => this.controller.confirmApply()}
                >
                    Apply ${review.accepted.length} merge${review.accepted.length === 1 ? '' : 's'}
                </wa-button>
            </wa-dialog>
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
