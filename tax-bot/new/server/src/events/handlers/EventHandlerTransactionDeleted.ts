import type { Book } from 'bkper-js';
import type { EventResultValue } from '../types.js';
import EventHandler from './EventHandler.js';

export default class EventHandlerTransactionDeleted extends EventHandler {
    protected async processTransaction(
        book: Book,
        transaction: bkper.Transaction,
        event: bkper.Event
    ): Promise<EventResultValue> {
        return false;
    }
}
