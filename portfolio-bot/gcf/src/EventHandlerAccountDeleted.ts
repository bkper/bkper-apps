import { Account, Book } from "bkper-js";
import { EventHandlerAccount } from "./EventHandlerAccount.js";

export class EventHandlerAccountDeleted extends EventHandlerAccount {
  protected async connectedAccountNotFound(financialBook: Book, stockBook: Book, financialAccount: bkper.Account): Promise<string> {
    let bookAnchor = super.buildBookAnchor(stockBook);
    return `${bookAnchor}: ACCOUNT ${financialAccount.name} NOT Found`;
  }
  protected async connectedAccountFound(financialBook: Book, stockBook: Book, financialAccount: bkper.Account, stockAccount: Account): Promise<string> {
    if (stockAccount.hasTransactionPosted()) {
      await stockAccount.setArchived(true).update();
    } else {
      await stockAccount.remove();
    }
    let bookAnchor = super.buildBookAnchor(stockBook);
    return `${bookAnchor}: ACCOUNT ${stockAccount.getName()} DELETED`;
  }
}
