import { Book, Transaction } from "bkper-js";
import { EventHandlerTransaction } from "./EventHandlerTransaction.js";
import { InterceptorOrderProcessorDeleteInstruments } from "./InterceptorOrderProcessorDeleteInstruments.js";
import { InterceptorOrderProcessorDeleteFinancial } from "./InterceptorOrderProcessorDeleteFinancial.js";
import { Result } from "./index.js";

export class EventHandlerTransactionDeleted extends EventHandlerTransaction {

  async intercept(book: Book, event: bkper.Event): Promise<Result> {
    let result: Result;
    if (this.botService.isStockBook(book)) {
      result = await new InterceptorOrderProcessorDeleteInstruments(this.context).intercept(book, event);
    } else {
      result = await new InterceptorOrderProcessorDeleteFinancial(this.context).intercept(book, event);
    }
    return result;
  }

  protected getTransactionQuery(transaction: bkper.Transaction): string {
    return `remoteId:${transaction.id}`;
  }

  protected connectedTransactionNotFound(financialBook: Book, stockBook: Book, financialTransaction: bkper.Transaction, stockExcCode: string): Promise<string> {
    return null;
  }

  protected async connectedTransactionFound(financialBook: Book, stockBook: Book, financialTransaction: bkper.Transaction, stockTransaction: Transaction, stockExcCode: string): Promise<string> {
    let bookAnchor = super.buildBookAnchor(stockBook);

    if (stockTransaction.isChecked()) {
      stockTransaction.uncheck();
    }

    await this.botService.flagStockAccountForRebuildIfNeeded(stockTransaction);

    await stockTransaction.trash();

    let amountFormatted = stockBook.formatValue(stockTransaction.getAmount())

    let record = `DELETED: ${stockTransaction.getDateFormatted()} ${amountFormatted} ${await stockTransaction.getCreditAccountName()} ${await stockTransaction.getDebitAccountName()} ${stockTransaction.getDescription()}`;

    return `${bookAnchor}: ${record}`;
  }

}
