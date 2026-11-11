import { Context } from 'hono';
import { Bkper, Book } from 'bkper-js';
import { AppContext } from '../AppContext.js';
import { EventHandlerFileCreated } from './EventHandlerFileCreated.js';
import { EventHandlerTransactionCreated } from './EventHandlerTransactionCreated.js';
import { EventHandlerTransactionPostedOrUpdated } from './EventHandlerTransactionPostedOrUpdated.js';
import { EventHandlerTransactionDeleted } from './EventHandlerTransactionDeleted.js';
import { EventHandlerBookAudited } from './EventHandlerBookAudited.js';

export type Result = {
    result?: any;
    error?: string;
    warning?: string;
};

export function createAppContext(c: Context): AppContext {
    // The SDK requires an API-key value; this is a placeholder, not an event token.
    // Platform outbound supplies the event authorization and app attribution.
    return new AppContext(new Bkper(), c.env as Env, 'bkper-platform-outbound', c.req.raw.signal);
}

export async function handleEvent(c: Context) {
    try {
        let event: bkper.Event = await c.req.json();
        let result: Result = { result: false };
        const context = createAppContext(c);
        let book = new Book(event.book, context.bkper.getConfig());

        console.log('Event received', event.type);

        switch (event.type) {
            case 'FILE_CREATED':
                result = await new EventHandlerFileCreated(context).handleEvent(book, event);
                break;
            case 'TRANSACTION_CREATED':
                result = await new EventHandlerTransactionCreated(context).handleEvent(book, event);
                break;
            case 'TRANSACTION_POSTED':
                result = await new EventHandlerTransactionPostedOrUpdated(context).handleEvent(book, event);
                break;
            case 'TRANSACTION_UPDATED':
                result = await new EventHandlerTransactionPostedOrUpdated(context).handleEvent(book, event);
                break;
            case 'TRANSACTION_DELETED':
                result = await new EventHandlerTransactionDeleted(context).handleEvent(book, event);
                break;
            case 'BOOK_AUDITED':
                result = await new EventHandlerBookAudited(context).handleEvent(book, event);
                break;
            default:
        }

        return c.json(result);
    } catch (err: any) {
        console.error(err);
        return c.json({ error: err.stack ? err.stack.split('\n') : err });
    }
}
