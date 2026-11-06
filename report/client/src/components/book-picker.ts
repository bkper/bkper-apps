import type WaInput from '@awesome.me/webawesome-pro/dist/components/input/input.js';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { t, textDirection } from 'report-shared/strings';
import type { BookListItem } from '../services/book-service';
import { findBooks } from '../state/books';

/** The event a chosen Book fires, with its id, bubbling to the app. */
export const CHOOSE_BOOK = 'report-choose-book';

/** How many Books show at a time: the most recent, or the first that match the filter. */
export const RECENT_BOOKS = 8;

declare global {
    interface HTMLElementEventMap {
        [CHOOSE_BOOK]: CustomEvent<string>;
    }
    interface HTMLElementTagNameMap {
        'book-picker': BookPicker;
    }
}

/**
 * A short list of the person's most recent Books, to open one; with more Books than it shows,
 * a field above it finds any of them by name as the person types (Enter opens the first).
 * Names keep their own direction, so a Latin name reads right in a right-to-left interface.
 * Choosing one fires {@link CHOOSE_BOOK}.
 */
@customElement('book-picker')
export class BookPicker extends LitElement {
    static styles = css`
        :host {
            display: block;
        }

        .picker {
            display: grid;
            /* Long names end with an ellipsis rather than widen the list. */
            grid-template-columns: minmax(0, 1fr);
            gap: var(--wa-space-m);
            max-inline-size: calc(var(--wa-space-scale) * 32rem);
            margin-inline: auto;
            padding-block-start: var(--wa-space-2xl);
        }

        header {
            display: grid;
            gap: var(--wa-space-2xs);
        }

        .app {
            margin: 0;
            color: var(--wa-color-text-quiet);
            font-size: var(--wa-font-size-s);
        }

        h1 {
            margin: 0;
            font-size: var(--wa-font-size-xl);
            font-weight: var(--wa-font-weight-semibold);
        }

        .filter::part(form-control-label) {
            position: absolute;
            inline-size: 1px;
            block-size: 1px;
            overflow: hidden;
            clip-path: inset(50%);
            white-space: nowrap;
        }

        .books {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .book {
            display: block;
            inline-size: 100%;
        }

        .book::part(base) {
            inline-size: 100%;
            justify-content: flex-start;
            padding-inline: var(--wa-space-s);
            color: var(--wa-color-text-normal);
        }

        .book::part(label) {
            display: block;
            flex: 1 1 auto;
            min-inline-size: 0;
        }

        .name {
            display: block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            /* At the interface's start, whatever the direction of the name itself. */
            text-align: left;
        }

        .picker[dir='rtl'] .name {
            text-align: right;
        }

        .message {
            margin: 0;
            padding-inline: var(--wa-space-s);
            color: var(--wa-color-text-quiet);
            font-size: var(--wa-font-size-s);
        }
    `;

    /** The person's Books, the most recent first. */
    @property({ attribute: false }) books: BookListItem[] = [];
    /** The language of the interface. */
    @property() language = 'en';
    @state() private filter = '';
    @query('wa-input') private input?: WaInput;

    render() {
        const lang = this.language;
        const shown = findBooks(this.books, this.filter, RECENT_BOOKS);
        const message =
            this.books.length === 0
                ? t('book_picker_empty', lang)
                : shown.length === 0
                  ? t('book_picker_no_match', lang)
                  : undefined;
        return html`
            <section class="picker" lang=${lang} dir=${textDirection(lang)}>
                <header>
                    <p class="app">${t('app_title', lang)}</p>
                    <h1>${t('book_picker_title', lang)}</h1>
                </header>
                ${
                    this.books.length > RECENT_BOOKS
                        ? html`<wa-input
                              class="filter"
                              type="search"
                              autofocus
                              with-clear
                              autocomplete="off"
                              enterkeyhint="go"
                              label=${t('book_picker_filter', lang)}
                              placeholder=${t('book_picker_filter', lang)}
                              @input=${this.onInput}
                              @wa-clear=${this.onInput}
                              @keydown=${(event: KeyboardEvent) => this.onKeyDown(event, shown)}
                          ></wa-input>`
                        : nothing
                }
                ${
                    message
                        ? html`<p class="message" role="status">${message}</p>`
                        : html`<ul class="books">
                              ${shown.map(
                                  book =>
                                      html`<li>
                                          <wa-button
                                              class="book"
                                              appearance="plain"
                                              @click=${() => this.choose(book.id)}
                                              ><span class="name" dir="auto"
                                                  >${book.name || t('book_untitled', lang)}</span
                                              ></wa-button
                                          >
                                      </li>`
                              )}
                          </ul>`
                }
            </section>
        `;
    }

    private onInput = () => {
        this.filter = this.input?.value ?? '';
    };

    private onKeyDown(event: KeyboardEvent, shown: BookListItem[]) {
        if (event.key === 'Enter' && !event.isComposing && shown[0]) this.choose(shown[0].id);
    }

    private choose(bookId: string) {
        this.dispatchEvent(
            new CustomEvent(CHOOSE_BOOK, { detail: bookId, bubbles: true, composed: true })
        );
    }
}
