import { Book, Transaction } from "bkper-js";
import { Result } from "./index.js";
import { EventHandlerTransaction } from "./EventHandlerTransaction.js";
import { InterceptorOrderProcessor } from "./InterceptorOrderProcessor.js";

export class EventHandlerTransactionRestored extends EventHandlerTransaction {

  async intercept(baseBook: Book, event: bkper.Event): Promise<Result> {
    return await new InterceptorOrderProcessor(this.context).intercept(baseBook, event);
  }

  protected getTransactionQuery(transaction: bkper.Transaction): string {
    return `remoteId:${transaction.id} is:trashed`;
  }

  protected connectedTransactionNotFound(financialBook: Book, stockBook: Book, financialTransaction: bkper.Transaction, stockExcCode: string): Promise<string> {
    return null;
  }
  protected async connectedTransactionFound(financialBook: Book, stockBook: Book, financialTransaction: bkper.Transaction, stockTransaction: Transaction, stockExcCode: string): Promise<string> {
    let bookAnchor = super.buildBookAnchor(stockBook);

    await stockTransaction.untrash();

    let amountFormatted = stockBook.formatValue(stockTransaction.getAmount())

    let record = `RESTORED: ${stockTransaction.getDateFormatted()} ${amountFormatted} ${await stockTransaction.getCreditAccountName()} ${await stockTransaction.getDebitAccountName()} ${stockTransaction.getDescription()}`;

    return `${bookAnchor}: ${record}`;
  }

}
