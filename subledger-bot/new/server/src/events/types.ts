export const SUBSCRIBED_EVENT_TYPES = [
    'TRANSACTION_POSTED',
    'TRANSACTION_CHECKED',
    'TRANSACTION_UPDATED',
    'TRANSACTION_DELETED',
    'TRANSACTION_RESTORED',
    'ACCOUNT_CREATED',
    'ACCOUNT_UPDATED',
    'ACCOUNT_DELETED',
    'GROUP_CREATED',
    'GROUP_UPDATED',
    'GROUP_DELETED',
] as const satisfies readonly NonNullable<bkper.Event['type']>[];

export type SubscribedEventType = (typeof SUBSCRIBED_EVENT_TYPES)[number];
export type EventHandlerResult = string | boolean;
export type EventResultValue = string[] | EventHandlerResult;

export interface EventResult {
    result: EventResultValue;
}

export interface EventError {
    error: unknown;
}

export type EventResponse = EventResult | EventError;

export interface EventHandlerContract {
    handleEvent(event: bkper.Event): Promise<EventHandlerResult>;
}

export type EventHandlerMap = Readonly<Record<SubscribedEventType, EventHandlerContract>>;
