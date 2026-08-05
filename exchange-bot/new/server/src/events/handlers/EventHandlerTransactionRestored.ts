import type { Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionRestored extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id} is:trashed`;
    }

    protected connectedTransactionNotFound(
        _baseBook: Book,
        _connectedBook: Book,
        _transaction: bkper.Transaction
    ): null {
        return null;
    }

    protected async connectedTransactionFound(
        _baseBook: Book,
        connectedBook: Book,
        _transaction: bkper.Transaction,
        connectedTransaction: Transaction
    ): Promise<string | null> {
        let bookAnchor = super.buildBookAnchor(connectedBook);

        await connectedTransaction.untrash();

        let amountFormatted = connectedBook.formatValue(connectedTransaction.getAmount());

        let record = `RESTORED: ${connectedTransaction.getDateFormatted()} ${amountFormatted} ${connectedTransaction.getDescription()}`;

        return `${bookAnchor}: ${record}`;
    }
}
