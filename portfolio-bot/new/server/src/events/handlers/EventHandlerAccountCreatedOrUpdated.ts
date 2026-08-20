import { Account, AccountType, type Book, Group } from 'bkper-js';
import { STOCK_EXC_CODE_PROP } from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import { EventHandlerAccount } from './EventHandlerAccount.js';

export class EventHandlerAccountCreatedOrUpdated extends EventHandlerAccount {
    protected async connectedAccountNotFound(
        financialBook: Book,
        stockBook: Book,
        financialAccount: bkper.Account
    ): Promise<string> {
        const stockAccount = new Account(stockBook);
        await this.syncAccounts(financialBook, stockBook, financialAccount, stockAccount);
        await stockAccount.create();
        const bookAnchor = super.buildBookAnchor(stockBook);
        return `${bookAnchor}: ACCOUNT ${stockAccount.getName()} CREATED`;
    }

    protected async connectedAccountFound(
        financialBook: Book,
        stockBook: Book,
        financialAccount: bkper.Account,
        stockAccount: Account
    ): Promise<string> {
        await this.syncAccounts(financialBook, stockBook, financialAccount, stockAccount);
        await stockAccount.update();
        const bookAnchor = super.buildBookAnchor(stockBook);
        return `${bookAnchor}: ACCOUNT ${stockAccount.getName()} UPDATED`;
    }

    private async syncAccounts(
        financialBook: Book,
        stockBook: Book,
        financialAccount: bkper.Account,
        stockAccount: Account
    ): Promise<void> {
        stockAccount
            .setGroups([])
            .setName(financialAccount.name!)
            .setType(financialAccount.type as AccountType)
            .setArchived(financialAccount.archived!);

        if (financialAccount.groups) {
            for (const group of financialAccount.groups) {
                const financialGroup = await optionalLookup(() => financialBook.getGroup(group.id));
                if (financialGroup) {
                    let stockGroup = await optionalLookup(() =>
                        stockBook.getGroup(financialGroup.getName())
                    );
                    const stockExcCode = financialGroup.getProperty(STOCK_EXC_CODE_PROP);
                    if (stockGroup == null && stockExcCode != null && stockExcCode.trim() != '') {
                        stockGroup = await new Group(stockBook)
                            .setHidden(financialGroup.isHidden()!)
                            .setName(financialGroup.getName()!)
                            .setVisibleProperties(financialGroup.getProperties())
                            .create();
                    }
                    stockAccount.addGroup(stockGroup!);
                }
            }
        }
    }
}
