import type { Account, Book } from 'bkper-js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import { EventHandler } from './EventHandler.js';

export abstract class EventHandlerAccount extends EventHandler {
    protected override async processObject(
        financialBook: Book,
        stockBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        const excCode = this.botService.getExcCode(financialBook);
        const financialAccount = event.data!.object as bkper.Account;
        const stockExcCode = this.botService.getStockExchangeCode(financialAccount);

        if (!this.matchStockExchange(stockExcCode, excCode)) {
            return null;
        }

        let stockAccount = await optionalLookup(() => stockBook.getAccount(financialAccount.name));
        const previousName = event.data!.previousAttributes?.['name'];
        if (stockAccount == null && previousName) {
            stockAccount = await optionalLookup(() => stockBook.getAccount(previousName));
        }

        if (stockAccount) {
            return this.connectedAccountFound(
                financialBook,
                stockBook,
                financialAccount,
                stockAccount
            );
        }
        return this.connectedAccountNotFound(financialBook, stockBook, financialAccount);
    }

    protected abstract connectedAccountNotFound(
        financialBook: Book,
        stockBook: Book,
        financialAccount: bkper.Account
    ): Promise<string>;

    protected abstract connectedAccountFound(
        financialBook: Book,
        stockBook: Book,
        financialAccount: bkper.Account,
        stockAccount: Account
    ): Promise<string>;
}
