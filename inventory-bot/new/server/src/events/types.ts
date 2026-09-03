export type EventHandlerResult = string | boolean;
export type EventResultValue = string[] | EventHandlerResult;

export interface EventResult {
    result?: EventResultValue;
    error?: string;
    warning?: string;
}

export interface EventError {
    error: unknown;
}
