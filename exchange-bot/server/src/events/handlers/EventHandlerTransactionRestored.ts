import type { Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionRestored extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id} is:trashed`;
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
        let bookAnchor = super.buildBookAnchor(connectedBook);

        await connectedTransaction.untrash();

        let amountFormatted = connectedBook.formatValue(connectedTransaction.getAmount());

        let record = `RESTORED: ${connectedTransaction.getDateFormatted()} ${amountFormatted} ${connectedTransaction.getDescription()}`;

        return `${bookAnchor}: ${record}`;
    }
}
