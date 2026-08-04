import type { Book } from 'bkper-js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionRestored extends EventHandlerTransaction {
    async processObject(
        _baseBook: Book,
        _connectedBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        return null;
    }
}
