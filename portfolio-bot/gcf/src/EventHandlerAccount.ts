import { Account, Book } from "bkper-js";
import { EventHandler } from "./EventHandler.js";

export abstract class EventHandlerAccount extends EventHandler {

  protected async processObject(financialBook: Book, stockBook: Book, event: bkper.Event): Promise<string> {
    let excCode = this.botService.getExcCode(financialBook);
    let financialAccount = event.data.object as bkper.Account;

    let baseAccount = financialAccount;
    let stockExcCode = this.botService.getStockExchangeCode(baseAccount);

    if (!this.matchStockExchange(stockExcCode, excCode)) {
      return null;
    }

    let stockAccount = await stockBook.getAccount(financialAccount.name);
    if (stockAccount == null && (event.data.previousAttributes && event.data.previousAttributes['name'])) {
      stockAccount = await stockBook.getAccount(event.data.previousAttributes['name']);
    }

    if (stockAccount) {
      return await this.connectedAccountFound(financialBook, stockBook, financialAccount, stockAccount);
    } else {
      return await this.connectedAccountNotFound(financialBook, stockBook, financialAccount);
    }
}

  protected abstract connectedAccountNotFound(financialBook: Book, stockBook: Book, financialAccount: bkper.Account): Promise<string>;

  protected abstract connectedAccountFound(financialBook: Book, stockBook: Book, financialAccount: bkper.Account, stockAccount: Account): Promise<string>;

}