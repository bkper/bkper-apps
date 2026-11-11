import { Book } from 'bkper-js';
import { Result } from './event-handler.js';
import { AppContext } from '../AppContext.js';

export abstract class EventHandler {
    protected context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    abstract handleEvent(book: Book, event: bkper.Event): Promise<Result>;
}
