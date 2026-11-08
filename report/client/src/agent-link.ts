/**
 * Links that open the Bkper Agent in a Book, with a request ready in its input (`q`) that the
 * person reads and sends: the Agent never sends it by itself. Report writes one for a person who
 * may organize the Book's groups, when they keep it from the reports asked for (`BookProblem`).
 * The request is a fixed text in the person's language with the names involved, never AI.
 */
import { t } from 'report-shared/strings';
import type { BookProblem } from './api/app-api';

/** The Bkper Agent's app id, which a Book URL names to open it. */
const AGENT_APP_ID = 'bkper-agent';

/** The longest request the Agent reads from a link; it ignores a longer one whole. */
export const MAX_AGENT_PROMPT = 2000;

/** The Book's transactions on the Bkper `origin`, with the Agent open and `prompt` in its input. */
export function agentUrl(origin: string, bookId: string, prompt?: string): string {
    const url = new URL(`/books/${encodeURIComponent(bookId)}/transactions`, origin);
    url.searchParams.set('app', AGENT_APP_ID);
    if (prompt) url.searchParams.set('q', prompt);
    return url.href;
}

/**
 * The request that asks the Agent to organize the Book's groups for `problem`, in `lang`, or
 * `undefined`: an empty Book opens the Agent with none, so its own start takes over, and a
 * request too long for a link would be ignored.
 */
export function agentPrompt(problem: BookProblem, lang: string): string | undefined {
    const book = problem.bookName;
    let text: string;
    switch (problem.code) {
        case 'empty_book':
            return undefined;
        case 'nothing_to_report':
            text = t('agent_prompt_nothing_to_report', lang, {
                book,
                count: formatCount(problem.ungrouped, lang),
                total: formatCount(problem.total, lang),
            });
            break;
        case 'no_net_result':
            text = problem.shared.length
                ? t('agent_prompt_no_net_result_shared', lang, {
                      book,
                      shared: formatList(problem.shared, lang),
                  })
                : problem.incoming.length && problem.outgoing.length
                  ? t('agent_prompt_no_net_result', lang, {
                        book,
                        incoming: formatList(problem.incoming, lang),
                        outgoing: formatList(problem.outgoing, lang),
                    })
                  : t('agent_prompt_no_net_result_general', lang, { book });
            break;
        case 'mixed_group':
            text = t('agent_prompt_mixed_group', lang, { book, group: problem.group });
            break;
    }
    const prompt = text.trim();
    return prompt.length <= MAX_AGENT_PROMPT ? prompt : undefined;
}

/** Names as a list in the language, such as `A, B and C`. */
export function formatList(names: readonly string[], lang: string): string {
    return new Intl.ListFormat(lang, { type: 'conjunction' }).format(names);
}

/** A count in the language's digits and grouping. */
export function formatCount(count: number, lang: string): string {
    return new Intl.NumberFormat(lang).format(count);
}
