import { Amount, Book, Transaction } from "bkper-js";
import { QUANTITY_PROP } from "./constants.js";
import { EventHandler } from "./EventHandler.js";

export interface AmountDescription {
  amount: Amount;
  description: string;
}

export abstract class EventHandlerTransaction extends EventHandler {

  async processObject(financialBook: Book, stockBook: Book, event: bkper.Event): Promise<string> {
    let excCode = this.botService.getExcCode(financialBook);
    let operation = event.data.object as bkper.TransactionOperation;
    let financialTransaction = operation.transaction;

    if (!financialTransaction.posted) {
      return null;
    }

    let stockTransaction = (await stockBook.listTransactions(this.getTransactionQuery(financialTransaction))).getFirst();

    let stockExcCode = this.getStockExcCodeFromTransaction(financialBook, financialTransaction);
    
    if (!this.matchStockExchange(stockExcCode, excCode)) {
      return null;
    }

    if (stockTransaction) {
      return await this.connectedTransactionFound(financialBook, stockBook, financialTransaction, stockTransaction, stockExcCode);
    } else {
      return await this.connectedTransactionNotFound(financialBook, stockBook, financialTransaction, stockExcCode)
    }
  }
  
  protected getQuantity(stockBook: Book, transaction: bkper.Transaction): Amount {
    let quantityStr = transaction.properties[QUANTITY_PROP];
    if (quantityStr == null || quantityStr.trim() == '') {
      return null;
    }
    return stockBook.parseValue(quantityStr).abs();
  }

  private getStockExcCodeFromTransaction(financialBook: Book, fiancialTransaction: bkper.Transaction) {

    let financialCreditAccount = fiancialTransaction.creditAccount;
    let financialDebitAccount = fiancialTransaction.debitAccount;

    let stockExcCode = this.botService.getStockExchangeCode(financialCreditAccount);
    if (stockExcCode == null) {
      stockExcCode = this.botService.getStockExchangeCode(financialDebitAccount);
    }
    return stockExcCode;
  }


  protected abstract getTransactionQuery(transaction: bkper.Transaction): string;

  protected abstract connectedTransactionNotFound(financialBook: Book, stockBook: Book, financialTransaction: bkper.Transaction, stockExcCode: string): Promise<string>;

  protected abstract connectedTransactionFound(baseBook: Book, connectedBook: Book, financialTransaction: bkper.Transaction, stockTransaction: Transaction, stockExcCode: string): Promise<string>;
}