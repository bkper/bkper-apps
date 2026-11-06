/** The Answer of a report: the amount asked for, first, with its change from before. */
import { html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { typeColor } from './colors.js';
import type { ReportFormat } from './format.js';
import type { PropsOf } from './spec-types.js';

type AnswerProps = PropsOf<'Answer'>;
type AnswerPart = NonNullable<AnswerProps['parts']>[number];

/**
 * @param title The report's title: the Answer's label usually repeats it, so it is then left to
 *   screen readers only.
 */
export function renderAnswer(answer: AnswerProps, format: ReportFormat, title: string) {
    return html`
        <section class="answer" aria-label=${answer.label}>
            ${answer.label === title ? nothing : html`<p class="answer-label">${answer.label}</p>`}
            <p class="answer-amount">${format.amount(answer.amount)}</p>
            ${renderComparison(answer, format)}
            ${
                answer.parts?.length
                    ? html`<ul class="answer-parts">
                          ${answer.parts.map(part => renderPart(part, format))}
                      </ul>`
                    : nothing
            }
        </section>
    `;
}

function renderComparison(answer: AnswerProps, format: ReportFormat) {
    if (answer.change === undefined && answer.previous === undefined) {
        return nothing;
    }
    return html`
        <p class="answer-comparison">
            ${
                answer.change === undefined
                    ? nothing
                    : html`<span class="change">${format.change(answer.change)}</span>`
            }
            ${answer.comparison ? html`<span dir="auto">${answer.comparison}</span>` : nothing}
            ${
                answer.previous === undefined
                    ? nothing
                    : html`<span class="previous">${format.amount(answer.previous)}</span>`
            }
        </p>
    `;
}

function renderPart(part: AnswerPart, format: ReportFormat) {
    return html`
        <li class="answer-part">
            <span
                class="swatch"
                style=${styleMap({ '--swatch-color': typeColor(part.color, 'high') })}
            ></span>
            <span class="part-label">${part.label}</span>
            <span class="part-amount">${format.amount(part.amount)}</span>
            ${
                part.change === undefined
                    ? nothing
                    : html`<span class="change">${format.change(part.change)}</span>`
            }
        </li>
    `;
}
