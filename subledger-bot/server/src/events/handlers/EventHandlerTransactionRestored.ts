import { type Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionRestored extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id} is:trashed`;
    }

    protected parentTransactionNotFound(
        childBook: Book,
        parentBook: Book,
        childTransaction: bkper.Transaction
    ): Promise<string | null> {
        return Promise.resolve(null);
    }

    protected async parentTransactionFound(
        childBook: Book,
        parentBook: Book,
        childTransaction: bkper.Transaction,
        parentTransaction: Transaction
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(parentBook);
        await parentTransaction.untrash();
        const amountFormatted = parentBook.formatValue(parentTransaction.getAmount());
        const record = `RESTORED: ${parentTransaction.getDateFormatted()} ${amountFormatted} ${await parentTransaction.getCreditAccountName()} ${await parentTransaction.getDebitAccountName()} ${parentTransaction.getDescription()}`;
        return `${bookAnchor}: ${record}`;
    }
}
