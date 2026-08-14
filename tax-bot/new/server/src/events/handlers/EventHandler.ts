import { Book } from 'bkper-js';
import { AppContext } from '../../AppContext.js';
import type { EventResultValue } from '../types.js';

export default abstract class EventHandler {
    protected context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    protected abstract processTransaction(
        book: Book,
        transaction: bkper.Transaction,
        event: bkper.Event
    ): Promise<EventResultValue>;

    async handleEvent(event: bkper.Event): Promise<EventResultValue> {
        const operation = event.data!.object as bkper.TransactionOperation;
        const transaction = operation.transaction!;
        const book = new Book(event.book, this.context.bkper.getConfig());

        if (!transaction.posted) {
            return false;
        }

        if (transaction.agentId === 'exchange-bot') {
            console.log('Skipping Exchange Bot Agent.');
            return false;
        }

        const logtag = `Handling ${event.type} event on book ${book.getName()} from user ${event.user!.username}`;
        console.time(logtag);

        const response = this.processTransaction(book, transaction, event);

        console.timeEnd(logtag);

        return response;
    }

    protected getId(
        taxTag: string,
        transaction: bkper.Transaction,
        accountOrGroup: bkper.Account | bkper.Group
    ): string {
        return `${taxTag}_${transaction.id}_${accountOrGroup.id}`;
    }
}
