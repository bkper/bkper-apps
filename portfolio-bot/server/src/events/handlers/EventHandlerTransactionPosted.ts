import type { AppContext } from '../../shared/app-context.js';
import { InterceptorOrderProcessor } from '../interceptors/InterceptorOrderProcessor.js';
import type { EventResult } from '../types.js';

export class EventHandlerTransactionPosted {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    async handleEvent(event: bkper.Event): Promise<EventResult> {
        const baseBook = await this.context.bkper.getBook(event.bookId!);
        const response = await new InterceptorOrderProcessor(this.context).intercept(
            baseBook,
            event
        );
        if (response) {
            return response;
        }
        return { result: false };
    }
}
