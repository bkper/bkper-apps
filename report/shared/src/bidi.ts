/**
 * Bidirectional text. A value inserted into a sentence, such as a date in "vs. {period}" or a
 * Book's name, may run in another direction than the sentence around it; isolated (FIRST
 * STRONG ISOLATE … POP DIRECTIONAL ISOLATE), it takes its own direction and keeps its place in
 * the sentence's reading order, so Arabic or Hebrew text with Latin names or dates reads right.
 */

const FIRST_STRONG_ISOLATE = '\u2068';
const POP_DIRECTIONAL_ISOLATE = '\u2069';
const ISOLATES = /[\u2066-\u2069]/g;

/** A value isolated from the text it is inserted into. */
export function isolate(value: string): string {
    return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

/** A text without its isolates, where it is read as words rather than shown, such as a request. */
export function withoutIsolates(text: string): string {
    return text.replace(ISOLATES, '');
}
