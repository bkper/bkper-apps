import type { Book } from 'bkper-js';
import { EventHandler } from './EventHandler.js';

export abstract class EventHandlerAccount extends EventHandler {
    protected processParentBookEvent(
        _parentBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        return Promise.resolve(null);
    }

    protected processChildBookEvent(
        _childBook: Book,
        _parentBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        return Promise.resolve(null);
    }
}
