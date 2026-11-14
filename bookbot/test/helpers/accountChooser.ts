import { mock } from 'bun:test';

import type { AccountChooser } from '../../src/genai/AccountChooser.js';
import { type AccountChoiceAnswer, type AccountChoiceRequest } from '../../src/services/AccountChoice.js';

/**
 * A stand-in for Jev that ranks the options by their number of past transactions, first on ties.
 * Tests of search, sides and provenance use it; tests of the choice itself pass their own answers.
 */
export function mostFrequentChooser(confidence = 1) {
    const choose = mock(async (request: AccountChoiceRequest): Promise<AccountChoiceAnswer> => {
        const history = request.state.history as Record<string, { transactions: unknown[] }>;
        let best: { label: string; count: number } | undefined;
        for (const [label, option] of Object.entries(history)) {
            if (!best || option.transactions.length > best.count) {
                best = { label, count: option.transactions.length };
            }
        }
        return { choice: best?.label ?? '', confidence };
    });
    return { chooser: { choose } as unknown as AccountChooser, choose };
}

/** A stand-in for Jev that always gives this answer. */
export function fixedChooser(answer: AccountChoiceAnswer) {
    const choose = mock(async (_request: AccountChoiceRequest): Promise<AccountChoiceAnswer> => answer);
    return { chooser: { choose } as unknown as AccountChooser, choose };
}
