import type { Book } from 'bkper-js';
import { EventHandlerTransactionEvent } from './EventHandlerTransactionEvent.js';

export class EventHandlerTransactionUpdated extends EventHandlerTransactionEvent {
    async processObject(
        _baseBook: Book,
        _connectedBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        return null;
    }
}
