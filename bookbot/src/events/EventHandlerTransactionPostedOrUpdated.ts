import { Book, Transaction } from 'bkper-js';
import { Result } from './event-handler.js';
import { EventHandler } from './EventHandler.js';

/** Bookbot's posted/updated job: rediscover pending drafts after an Account correction. Extraction learning belongs to Parser Bot. */
export class EventHandlerTransactionPostedOrUpdated extends EventHandler {
    async handleEvent(book: Book, event: bkper.Event): Promise<Result> {
        const operation = event.data?.object as bkper.TransactionOperation;

        const transaction = operation.transaction;

        if (!transaction?.posted) {
            console.log('Transaction is not posted');
            return { result: false };
        }

        const rediscovered = await this.context.createRediscoveryService().rediscover(book, new Transaction(book, transaction), event);
        return rediscovered != null ? { result: rediscovered } : { result: false };
    }
}
