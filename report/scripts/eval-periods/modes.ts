/**
 * How a request's period is read. A mode is one function: a request, the Book's snapshot and the
 * today it is asked on, to the parts of a period (or why there is none), with the model's
 * judgments, its latency and its size. Each mode asks the model as the app would.
 */
import { decide, type DecisionClient } from '../../server/src/services/decision-client.ts';
import {
    THRESHOLDS,
    UNSPECIFIED,
    buildIntentRequest,
} from '../../server/src/services/intent-questions.ts';
import { periodRequestOf } from '../../server/src/services/period-query.ts';
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

interface ChoiceAnswer {
    choice: string;
    confidence: number;
}

/**
 * The parts of the period chosen from the dated list, as the app reads it: the period it is sure
 * of (else none, so the report reads its default one), compared with the same period a year
 * earlier when the model says so, else with the previous period.
 */
export function listAnswer(period: ChoiceAnswer, yearEarlier: { noul: number }): PeriodAnswer {
    const compareWith = yearEarlier.noul >= THRESHOLDS.year_earlier ? 'year_earlier' : undefined;
    const request =
        period.choice !== UNSPECIFIED && period.confidence >= THRESHOLDS.period
            ? periodRequestOf(period.choice, compareWith)
            : undefined;
    return request ? { request } : { reason: 'unspecified_period' };
}

/** Today's design: one choice among the dated periods of `buildPeriodOptions`, and `year_earlier`. */
export const readByList: PeriodMode = async ({ prompt, snapshot, today, client }) => {
    const { request } = buildIntentRequest(prompt, { ...snapshot, today });
    const start = performance.now();
    const result = await decide(client, request);
    const latencyMs = performance.now() - start;
    const { period, year_earlier, versus_earlier } = result.answers;
    return {
        answer: listAnswer(period, year_earlier),
        judgments: {
            period: `${period.choice} (${period.confidence.toFixed(2)})`,
            year_earlier: year_earlier.noul.toFixed(2),
            versus_earlier: versus_earlier.noul.toFixed(2),
        },
        latencyMs,
        inputTokens: result.usage.input_tokens,
        requestCharacters: JSON.stringify(request).length,
        model: result.model,
    };
};

export const MODES: Record<string, PeriodMode> = { list: readByList };
