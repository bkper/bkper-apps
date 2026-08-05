import type { Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionDeleted extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    protected connectedTransactionNotFound(
        baseBook: Book,
        connectedBook: Book,
        transaction: bkper.Transaction
    ): null {
        return null;
    }
    protected async connectedTransactionFound(
        baseBook: Book,
        connectedBook: Book,
        transaction: bkper.Transaction,
        connectedTransaction: Transaction
    ): Promise<string | null> {
        const timeTag = `Deleted found ${Math.random()}`;
        console.time(timeTag);

        let bookAnchor = super.buildBookAnchor(connectedBook);

        if (connectedTransaction.isChecked()) {
            await connectedTransaction.uncheck();
        }
        await connectedTransaction.trash();

        let amountFormatted = connectedBook.formatValue(connectedTransaction.getAmount());

        let record = `DELETED: ${connectedTransaction.getDateFormatted()} ${amountFormatted} ${connectedTransaction.getDescription()}`;

        console.timeEnd(timeTag);

        return `${bookAnchor}: ${record}`;
    }
}
