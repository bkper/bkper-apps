/**
 * The part of the Open System One 2026-11-07 contract (`POST /v1/systemone`) this evaluation uses:
 * `noul` and `choice` questions over a text state. Schema names follow the release's OpenAPI file.
 */

export interface NoulQuestion {
    type: 'noul';
    instructions?: string;
    criteria?: { true?: string; false?: string };
}

export interface ChoiceQuestion {
    type: 'choice';
    instructions?: string;
    criteria: Record<string, string | null>;
}

export interface SystemOneRequest {
    model: string;
    state: string;
    questions: Record<string, NoulQuestion | ChoiceQuestion>;
}

export interface NoulAnswer {
    type: 'noul';
    noul: number;
}

export interface ChoiceAnswer {
    type: 'choice';
    choice: string;
    confidence: number;
    probabilities: Record<string, number>;
}

export interface SystemOneUsage {
    input_tokens: number;
    output_tokens: number;
}

export interface SystemOneResponse {
    model: string;
    answers: Record<string, unknown>;
    usage: SystemOneUsage;
}

export interface SystemOneError {
    type: string;
    code: string | null;
    param: string | null;
    message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
    return typeof value === 'number' && value >= 0 && value <= 1;
}

export function isSystemOneResponse(value: unknown): value is SystemOneResponse {
    return isRecord(value)
        && typeof value.model === 'string'
        && isRecord(value.answers)
        && isRecord(value.usage)
        && typeof value.usage.input_tokens === 'number'
        && typeof value.usage.output_tokens === 'number';
}

export function isNoulAnswer(value: unknown): value is NoulAnswer {
    return isRecord(value) && value.type === 'noul' && isProbability(value.noul);
}

export function isChoiceAnswer(value: unknown): value is ChoiceAnswer {
    return isRecord(value)
        && value.type === 'choice'
        && typeof value.choice === 'string'
        && isProbability(value.confidence)
        && isRecord(value.probabilities)
        && Object.values(value.probabilities).every(isProbability);
}

export function readSystemOneError(value: unknown): SystemOneError | undefined {
    if (!isRecord(value) || !isRecord(value.error)) return undefined;
    const error = value.error;
    return {
        type: typeof error.type === 'string' ? error.type : 'unknown',
        code: typeof error.code === 'string' ? error.code : null,
        param: typeof error.param === 'string' ? error.param : null,
        message: typeof error.message === 'string' ? error.message : '',
    };
}
