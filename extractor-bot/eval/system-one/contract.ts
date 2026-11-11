/**
 * The part of the Open System One 2026-11-07 contract (`POST /v1/systemone`) this evaluation uses:
 * `text`, `number`, `date` and `list` questions over a text state, with image assets and a reference
 * date. Schema names follow the release's OpenAPI file.
 */

export interface TextQuestion {
    type: 'text';
    instructions?: string;
    null_threshold?: number;
}

export interface NumberQuestion {
    type: 'number';
    instructions?: string;
    unit?: string;
    integer?: boolean;
    decimals?: number;
    null_threshold?: number;
}

export interface DateQuestion {
    type: 'date';
    instructions?: string;
    null_threshold?: number;
}

export interface ListQuestion {
    type: 'list';
    items: 'text' | 'number' | 'date';
    instructions?: string;
    decimals?: number;
}

export type SystemOneQuestion = TextQuestion | NumberQuestion | DateQuestion | ListQuestion;

export interface SystemOneAsset {
    type: 'image';
    format: 'png' | 'jpg' | 'jpeg' | 'webp';
    data_base64: string;
}

export interface SystemOneRequest {
    model: string;
    state: string;
    questions: Record<string, SystemOneQuestion>;
    assets?: Record<string, SystemOneAsset>;
    reference_date?: string;
}

/** `[start, end)` in Unicode code points of `state_text`, or of `state` without it. */
export type SystemOneSpan = [number, number];

/** A `text`, `number` or `date` answer. */
export interface ValueAnswer {
    type: 'text' | 'number' | 'date';
    value: string | number | null;
    p_null: number;
    confidence: number;
    guess?: string | number;
    span?: SystemOneSpan | null;
}

export interface ListAnswer {
    type: 'list';
    value: (string | number)[];
    confidence: number;
    spans?: (SystemOneSpan | null)[];
}

export interface SystemOneUsage {
    input_tokens: number;
    output_tokens: number;
}

export interface SystemOneResponse {
    model: string;
    answers: Record<string, unknown>;
    usage: SystemOneUsage;
    truncated?: boolean;
    state_text?: string;
}

export interface SystemOneError {
    type: string;
    code: string | null;
    param: string | null;
    message: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
    return typeof value === 'number' && value >= 0 && value <= 1;
}

function isSpan(value: unknown): value is SystemOneSpan {
    return Array.isArray(value)
        && value.length === 2
        && value.every(offset => Number.isInteger(offset) && offset >= 0);
}

export function isSystemOneResponse(value: unknown): value is SystemOneResponse {
    return isRecord(value)
        && typeof value.model === 'string'
        && isRecord(value.answers)
        && isRecord(value.usage)
        && typeof value.usage.input_tokens === 'number'
        && typeof value.usage.output_tokens === 'number'
        && (value.state_text === undefined || typeof value.state_text === 'string');
}

export function isValueAnswer(value: unknown, type: ValueAnswer['type']): value is ValueAnswer {
    if (!isRecord(value) || value.type !== type) return false;
    const valueType = type === 'number' ? 'number' : 'string';
    return (value.value === null || typeof value.value === valueType)
        && isProbability(value.p_null)
        && isProbability(value.confidence)
        && (value.guess === undefined || typeof value.guess === valueType)
        && (value.span === undefined || value.span === null || isSpan(value.span));
}

export function isListAnswer(value: unknown, items: ListQuestion['items']): value is ListAnswer {
    if (!isRecord(value) || value.type !== 'list' || !Array.isArray(value.value)) return false;
    const itemType = items === 'number' ? 'number' : 'string';
    return value.value.every(item => typeof item === itemType)
        && isProbability(value.confidence)
        && (value.spans === undefined
            || (Array.isArray(value.spans) && value.spans.every(span => span === null || isSpan(span))));
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
