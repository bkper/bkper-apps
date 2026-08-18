import { Account, AccountType, Book, Group } from "bkper-js";
import { STOCK_EXC_CODE_PROP } from "./constants.js";
import { EventHandlerAccount } from "./EventHandlerAccount.js";

export class EventHandlerAccountCreatedOrUpdated extends EventHandlerAccount {

  public async connectedAccountNotFound(baseBook: Book, connectedBook: Book, baseAccount: bkper.Account): Promise<string> {
    let connectedAccount = new Account(connectedBook);
    await this.syncAccounts(baseBook, connectedBook, baseAccount, connectedAccount);
    await connectedAccount.create();
    let bookAnchor = super.buildBookAnchor(connectedBook);
    return `${bookAnchor}: ACCOUNT ${connectedAccount.getName()} CREATED`;
  }

  protected async connectedAccountFound(financialBook: Book, stockBook: Book, financialAccount: bkper.Account, stockAccount: Account): Promise<string> {
    await this.syncAccounts(financialBook, stockBook, financialAccount, stockAccount);
    await stockAccount.update();
    let bookAnchor = super.buildBookAnchor(stockBook);
    return `${bookAnchor}: ACCOUNT ${stockAccount.getName()} UPDATED`;
  }

  protected async syncAccounts(financialBook: Book, stockBook: Book, financialAccount: bkper.Account, stockAccount: Account) {
    stockAccount.setGroups([]);
    stockAccount.setName(financialAccount.name)
      .setType(financialAccount.type as AccountType)
      .setArchived(financialAccount.archived);
    if (financialAccount.groups) {
      for (const g of financialAccount.groups) {
        let baseGroup = await financialBook.getGroup(g.id);
        if (baseGroup) {
          let connectedGroup = await stockBook.getGroup(baseGroup.getName());
          let stockExcCode = baseGroup.getProperty(STOCK_EXC_CODE_PROP);
          if (connectedGroup == null && stockExcCode != null && stockExcCode.trim() != '') {
            connectedGroup = await new Group(stockBook)
              .setHidden(baseGroup.isHidden())
              .setName(baseGroup.getName())
              .setVisibleProperties(baseGroup.getProperties())
              .create();
          }
          stockAccount.addGroup(connectedGroup);
        }
      }
    }

  }

}