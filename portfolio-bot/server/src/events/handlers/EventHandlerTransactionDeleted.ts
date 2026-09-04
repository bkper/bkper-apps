import type { Book, Transaction } from 'bkper-js';
import { InterceptorOrderProcessorDeleteFinancial } from '../interceptors/InterceptorOrderProcessorDeleteFinancial.js';
import { InterceptorOrderProcessorDeleteInstruments } from '../interceptors/InterceptorOrderProcessorDeleteInstruments.js';
import type { EventResult } from '../types.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionDeleted extends EventHandlerTransaction {
    protected override async intercept(book: Book, event: bkper.Event): Promise<EventResult> {
        if (this.botService.isStockBook(book)) {
            return new InterceptorOrderProcessorDeleteInstruments(this.context).intercept(
                book,
                event
            );
        }
        return new InterceptorOrderProcessorDeleteFinancial(this.context).intercept(book, event);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
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

        if (stockTransaction.isChecked()) {
            await stockTransaction.uncheck();
        }

        await this.botService.flagStockAccountForRebuildIfNeeded(stockTransaction);
        await stockTransaction.trash();

        const amountFormatted = stockBook.formatValue(stockTransaction.getAmount());
        const record = `DELETED: ${stockTransaction.getDateFormatted()} ${amountFormatted} ${await stockTransaction.getCreditAccountName()} ${await stockTransaction.getDebitAccountName()} ${stockTransaction.getDescription()}`;

        return `${bookAnchor}: ${record}`;
    }
}
