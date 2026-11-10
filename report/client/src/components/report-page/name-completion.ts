import type { ReactiveControllerHost } from 'lit';
import {
    applyCompletion,
    type AppliedCompletion,
    type NameCompletion,
} from 'report-shared/name-index';

/** Where completions come from: the open Book's names, from memory (`BookNames`). */
export interface CompletionSource {
    complete(text: string, caret: number): NameCompletion[];
}

/** What the person did: typed, moved the caret, or neither (focus, names arriving). */
export type CaretChange = 'typed' | 'moved' | 'none';

/** The text of the input and its selection, as the person left them. */
export interface Caret {
    text: string;
    start: number;
    end: number;
}

/**
 * The names completing the word at the caret of the request input, and the one highlighted:
 * the state of a list-autocomplete combobox. It decides what each key does while names show
 * (Tab accepts, ↑/↓ browse, Enter accepts only a highlighted name, Escape dismisses); the
 * page applies the request it accepts and runs reports as it always does.
 */
export class NameCompletionController {
    /** The names offered, best first; none when the list is closed. */
    items: readonly NameCompletion[] = [];
    /** The highlighted name, or -1 for none: Enter then runs the report. */
    active = -1;
    /** The request the names complete. */
    private text = '';
    /**
     * The person has typed this request: a request opened for them (a reload, the Book, a
     * suggestion, a saved prompt) shows no names until they type in it.
     */
    private typing = false;
    /** Dismissed, or a name accepted: nothing shows until the person types or moves the caret. */
    private quiet = false;

    constructor(
        private readonly host: ReactiveControllerHost,
        private readonly accept: (applied: AppliedCompletion) => void
    ) {}

    get open(): boolean {
        return this.items.length > 0;
    }

    /**
     * The request or its caret changed: offer the names completing the word at the caret, once
     * the person has typed in it. Typing or moving the caret undoes a dismissal; focusing again
     * does not.
     */
    update(source: CompletionSource, caret: Caret | undefined, change: CaretChange): void {
        if (change === 'typed') this.typing = true;
        if (change !== 'none') this.quiet = false;
        const items =
            caret && this.typing && !this.quiet && caret.start === caret.end
                ? source.complete(caret.text, caret.start)
                : [];
        this.text = caret?.text ?? '';
        // Unchanged, the page need not render: it would write its request over the input's.
        if (sameItems(items, this.items)) return;
        this.items = items;
        this.active = -1;
        this.host.requestUpdate();
    }

    /** Close the list, such as when the input loses focus. */
    close(): void {
        if (!this.open) return;
        this.items = [];
        this.active = -1;
        this.host.requestUpdate();
    }

    /** Close the list when the request changed elsewhere (a suggestion, a saved report, a reset). */
    follow(text: string): void {
        if (text === this.text) return;
        this.typing = false;
        this.close();
    }

    /** Write the name at `index` into the request in place of the text it completes. */
    choose(index: number): void {
        const completion = this.items[index];
        if (!completion) return;
        const applied = applyCompletion(this.text, completion);
        this.quiet = true;
        this.text = applied.text;
        this.close();
        this.accept(applied);
    }

    /**
     * A key pressed in the input while names show: whether the list handled it. Enter is
     * handled only with a name highlighted; otherwise the list closes and Enter runs the report.
     */
    keydown(event: KeyboardEvent): boolean {
        if (!this.open || event.altKey || event.ctrlKey || event.metaKey) return false;
        const count = this.items.length;
        switch (event.key) {
            case 'ArrowDown':
                this.active = (this.active + 1) % count;
                break;
            case 'ArrowUp':
                this.active = this.active <= 0 ? count - 1 : this.active - 1;
                break;
            case 'Tab':
                if (event.shiftKey) return false;
                this.choose(Math.max(this.active, 0));
                break;
            case 'Enter':
                if (this.active < 0) {
                    this.close();
                    return false;
                }
                this.choose(this.active);
                break;
            case 'Escape':
                this.quiet = true;
                this.close();
                break;
            default:
                return false;
        }
        event.preventDefault();
        this.host.requestUpdate();
        return true;
    }
}

function sameItems(a: readonly NameCompletion[], b: readonly NameCompletion[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (item, i) => item.name === b[i].name && item.from === b[i].from && item.to === b[i].to
        )
    );
}
