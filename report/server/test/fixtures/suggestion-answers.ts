/**
 * Jev's answer to the question that ranks a Book's suggestions (`suggestion-questions.ts`), for
 * fakes of Bkper AI that also answer report requests.
 */

/** The fixture's labels, most important first: its net income, its assets and its expenses. */
export const FIXTURE_RANKING: Record<string, number> = {
    'Net income': 0.5,
    Assets: 0.2,
    Expenses: 0.15,
    Banks: 0.07,
    Revenue: 0.05,
    Card: 0.03,
};

/** Whether a request to Bkper AI asks to rank suggestions. */
export function asksRanking(init?: RequestInit): boolean {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    return (
        typeof body === 'object' &&
        body !== null &&
        'questions' in body &&
        typeof body.questions === 'object' &&
        body.questions !== null &&
        'first' in body.questions
    );
}

/** Bkper AI's answer ranking the options by these probabilities. */
export function rankingResponse(probabilities: Record<string, number> = FIXTURE_RANKING): Response {
    const [choice] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
    return Response.json({
        model: 'jev',
        answers: {
            first: {
                type: 'choice',
                choice,
                confidence: probabilities[choice],
                probabilities,
            },
        },
        usage: { input_tokens: 1000, output_tokens: 1 },
    });
}
