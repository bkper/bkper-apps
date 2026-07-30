export type EventHandlerResult = string | boolean;
export type EventResultValue = string[] | EventHandlerResult;

export interface EventResult {
    result: EventResultValue;
}

export interface EventError {
    error: unknown;
}
