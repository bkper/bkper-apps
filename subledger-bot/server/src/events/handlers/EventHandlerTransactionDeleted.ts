import { type Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionDeleted extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
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
        if (parentTransaction.isChecked()) {
            await parentTransaction.uncheck();
        }
        await parentTransaction.trash();
        const amountFormatted = parentBook.formatValue(parentTransaction.getAmount());
        const record = `DELETED: ${parentTransaction.getDateFormatted()} ${amountFormatted} ${await parentTransaction.getCreditAccountName()} ${await parentTransaction.getDebitAccountName()} ${parentTransaction.getDescription()}`;
        return `${bookAnchor}: ${record}`;
    }
}
