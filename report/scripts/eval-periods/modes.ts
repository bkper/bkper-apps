/**
 * How a request's period is read. A mode is one function: a request, the Book's snapshot and the
 * today it is asked on, to the parts of a period (or why there is none), with the model's
 * judgments, its latency and its size. The one mode, `atomic`, asks the model as the app does;
 * another way of reading periods can be measured against it as another mode.
 */
import { decide, type DecisionClient } from '../../server/src/services/decision-client.ts';
import { buildIntentRequest } from '../../server/src/services/intent-questions.ts';
import {
    PERIOD_QUESTION_IDS,
    readPeriod,
    type PeriodReading as AtomicReading,
} from '../../server/src/services/period-questions.ts';
import type { IsoDate } from '../../server/src/services/periods.ts';
import type { Snapshot } from '../../server/src/services/snapshot.ts';
import type { PeriodAnswer } from './score.ts';

export interface PeriodAsk {
    prompt: string;
    /** The Book's map, with `today` the day the request is asked on. */
    snapshot: Snapshot;
    today: IsoDate;
    client: DecisionClient;
}

export interface PeriodReading {
    answer: PeriodAnswer;
    /** Each judgment of the model, as text, to print a miss. */
    judgments: Record<string, string>;
    latencyMs: number;
    /** The model's input tokens, when it reports them. */
    inputTokens?: number;
    /** The length of the decision request, as JSON. */
    requestCharacters: number;
    model?: string;
}

export type PeriodMode = (ask: PeriodAsk) => Promise<PeriodReading>;

/** The period of the atomic reading, or why there is none. */
export function atomicAnswer(reading: AtomicReading): PeriodAnswer {
    return reading.request
        ? { request: reading.request }
        : { reason: reading.reason ?? 'unspecified_period' };
}

/**
 * The app's period questions: how long the period is, and which year, month and quarter the
 * request says for it and for the period it compares with, read with `readPeriod`.
 */
export const readByAtomicParts: PeriodMode = async ({ prompt, snapshot, today, client }) => {
    const { request } = buildIntentRequest(prompt, { ...snapshot, today });
    const start = performance.now();
    const result = await decide(client, request);
    const latencyMs = performance.now() - start;
    const reading = readPeriod(result.answers);
    const judgments: Record<string, string> = {};
    for (const id of PERIOD_QUESTION_IDS) {
        const { answer, score } = reading.trace[id];
        if (answer !== 'unspecified' || score < 0.9) {
            judgments[id] = `${answer} (${score.toFixed(2)})`;
        }
    }
    judgments.year_earlier = result.answers.year_earlier.noul.toFixed(2);
    return {
        answer: atomicAnswer(reading),
        judgments,
        latencyMs,
        inputTokens: result.usage.input_tokens,
        requestCharacters: JSON.stringify(request).length,
        model: result.model,
    };
};

export const MODES: Record<string, PeriodMode> = { atomic: readByAtomicParts };
