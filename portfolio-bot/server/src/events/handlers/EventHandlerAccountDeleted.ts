import type { Account, Book } from 'bkper-js';
import { EventHandlerAccount } from './EventHandlerAccount.js';

export class EventHandlerAccountDeleted extends EventHandlerAccount {
    protected async connectedAccountNotFound(
        _financialBook: Book,
        stockBook: Book,
        financialAccount: bkper.Account
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(stockBook);
        return `${bookAnchor}: ACCOUNT ${financialAccount.name} NOT Found`;
    }

    protected async connectedAccountFound(
        _financialBook: Book,
        stockBook: Book,
        _financialAccount: bkper.Account,
        stockAccount: Account
    ): Promise<string> {
        if (stockAccount.hasTransactionPosted()) {
            await stockAccount.setArchived(true).update();
        } else {
            await stockAccount.remove();
        }
        const bookAnchor = super.buildBookAnchor(stockBook);
        return `${bookAnchor}: ACCOUNT ${stockAccount.getName()} DELETED`;
    }
}
