import type { Book } from 'bkper-js';
import { EventHandler } from './EventHandler.js';

export abstract class EventHandlerAccount extends EventHandler {
    protected processParentBookEvent(parentBook: Book, event: bkper.Event): Promise<string | null> {
        return Promise.resolve(null);
    }

    protected processChildBookEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return Promise.resolve(null);
    }
}
