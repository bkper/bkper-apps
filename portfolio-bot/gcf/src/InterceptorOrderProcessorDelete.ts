import { Book, Transaction } from "bkper-js";
import { CalculationModel } from './CalculationModel.js';
import { BotService } from "./BotService.js";
import { AppContext } from "./AppContext.js";
export abstract class InterceptorOrderProcessorDelete {
  protected botService: BotService;

  constructor(context: AppContext) {
    this.botService = new BotService(context);
  }

  protected cascadeDelete(book: Book, transaction: bkper.Transaction) {
    if (!book) {
      return;
    }
    
    this.cascadeDeleteTransactions(book, transaction, ``);
    this.cascadeDeleteTransactions(book, transaction, `mtm_`);
    this.cascadeDeleteTransactions(this.botService.getBaseBook(book), transaction, `fx_`);

    const stockBook = this.botService.getStockBook(book);
    if (this.botService.getCalculationModel(stockBook) == CalculationModel.BOTH) {
      this.cascadeDeleteTransactions(book, transaction, `hist_`);
      this.cascadeDeleteTransactions(book, transaction, `mtm_hist_`);
      this.cascadeDeleteTransactions(this.botService.getBaseBook(book), transaction, `fx_hist_`);
    }
  }

  protected async cascadeDeleteTransactions(book: Book, remoteTx: bkper.Transaction, prefix: string) {
    let tx = (await book.listTransactions(`remoteId:${prefix}${remoteTx.id}`)).getFirst();
    if (tx) {
      if (tx.isChecked()) {
        tx = await tx.uncheck();
      }
      await tx.trash();
    }
  }

  protected async buildDeleteResponse(tx: Transaction): Promise<string> {
    return `DELETED: ${tx.getDateFormatted()} ${tx.getAmount()} ${await tx.getCreditAccountName()} ${await tx.getDebitAccountName()} ${tx.getDescription()}`
  }

  protected async deleteTransaction(book: Book, remoteId: string): Promise<Transaction> {
    let tx = (await book.listTransactions(`remoteId:${remoteId}`)).getFirst();
    if (tx) {
      if (tx.isChecked()) {
        tx = await tx.uncheck();
      }
      tx = await tx.trash();
      return tx;
    }
    return null;
  }


  protected async deleteOnStockBook(financialBook: Book, remoteId: string): Promise<Transaction> {
    let stockBook = this.botService.getStockBook(financialBook);
    const deletedStockTx = await this.deleteTransaction(stockBook, remoteId);
    if (deletedStockTx) {
      await this.botService.flagStockAccountForRebuildIfNeeded(deletedStockTx);
      this.cascadeDelete(financialBook, deletedStockTx.json());
    }
    return deletedStockTx;
  }
}