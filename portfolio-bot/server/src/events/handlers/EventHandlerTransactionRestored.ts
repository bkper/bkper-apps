import type { Book, Transaction } from 'bkper-js';
import { InterceptorOrderProcessor } from '../interceptors/InterceptorOrderProcessor.js';
import type { EventResult } from '../types.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionRestored extends EventHandlerTransaction {
    protected override async intercept(baseBook: Book, event: bkper.Event): Promise<EventResult> {
        return new InterceptorOrderProcessor(this.context).intercept(baseBook, event);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id} is:trashed`;
    }

    protected async connectedTransactionNotFound(
        _financialBook: Book,
        _stockBook: Book,
        _financialTransaction: bkper.Transaction,
        _stockExcCode: string
    ): Promise<null> {
        return null;
    }

    protected async connectedTransactionFound(
        _financialBook: Book,
        stockBook: Book,
        _financialTransaction: bkper.Transaction,
        stockTransaction: Transaction,
        _stockExcCode: string
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(stockBook);

        await stockTransaction.untrash();

        const amountFormatted = stockBook.formatValue(stockTransaction.getAmount());
        const record = `RESTORED: ${stockTransaction.getDateFormatted()} ${amountFormatted} ${await stockTransaction.getCreditAccountName()} ${await stockTransaction.getDebitAccountName()} ${stockTransaction.getDescription()}`;

        return `${bookAnchor}: ${record}`;
    }
}
