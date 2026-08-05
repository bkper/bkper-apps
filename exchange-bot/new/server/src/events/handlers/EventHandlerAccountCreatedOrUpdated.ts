import { Account, type AccountType, type Book } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { EventHandlerAccount } from './EventHandlerAccount.js';

export class EventHandlerAccountCreatedOrUpdated extends EventHandlerAccount {
    constructor(context: AppContext) {
        super(context);
    }

    public async connectedAccountNotFound(
        baseBook: Book,
        connectedBook: Book,
        baseAccount: bkper.Account
    ): Promise<string | null> {
        const timeTagWrite = `AccountCreatedOrUpdated not found write. [Book ${connectedBook.getName()}] [Owner ${connectedBook.getOwnerName()}] ${Math.random()}`;
        console.time(timeTagWrite);

        let connectedAccount = new Account(connectedBook);
        this.syncAccounts(baseBook, connectedBook, baseAccount, connectedAccount);
        await connectedAccount.create();
        let bookAnchor = super.buildBookAnchor(connectedBook);

        console.timeEnd(timeTagWrite);

        return `${bookAnchor}: ACCOUNT ${connectedAccount.getName()} CREATED`;
    }

    protected async connectedAccountFound(
        baseBook: Book,
        connectedBook: Book,
        baseAccount: bkper.Account,
        connectedAccount: Account
    ): Promise<string | null> {
        const timeTagWrite = `AccountCreatedOrUpdated found write. [Book ${connectedBook.getName()}] [Owner ${connectedBook.getOwnerName()}] ${Math.random()}`;
        console.time(timeTagWrite);
        this.syncAccounts(baseBook, connectedBook, baseAccount, connectedAccount);
        await connectedAccount.update();
        let bookAnchor = super.buildBookAnchor(connectedBook);
        console.timeEnd(timeTagWrite);
        return `${bookAnchor}: ACCOUNT ${connectedAccount.getName()} UPDATED`;
    }

    protected syncAccounts(
        baseBook: Book,
        connectedBook: Book,
        baseAccount: bkper.Account,
        connectedAccount: Account
    ): void {
        connectedAccount.setGroups(baseAccount.groups!);
        connectedAccount
            .setName(baseAccount.name!)
            .setType(baseAccount.type as AccountType)
            .setVisibleProperties(baseAccount.properties!)
            .setArchived(baseAccount.archived!);
    }
}
