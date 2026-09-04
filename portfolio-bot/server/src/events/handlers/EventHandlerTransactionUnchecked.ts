import type { AppContext } from '../../shared/app-context.js';
import { InterceptorFlagRebuild } from '../interceptors/InterceptorFlagRebuild.js';
import type { EventResult } from '../types.js';

export class EventHandlerTransactionUnchecked {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    async handleEvent(event: bkper.Event): Promise<EventResult> {
        const baseBook = await this.context.bkper.getBook(event.bookId!);
        const response = await new InterceptorFlagRebuild(this.context).intercept(baseBook, event);
        if (response) {
            return response;
        }
        return { result: false };
    }
}
