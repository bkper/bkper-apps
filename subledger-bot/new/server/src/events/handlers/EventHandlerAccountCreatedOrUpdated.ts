import { Account, AccountType, type Book } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { CHILD_BOOK_ID_PROP } from '../../constants.js';
import { EventHandlerAccount } from './EventHandlerAccount.js';

export class EventHandlerAccountCreatedOrUpdated extends EventHandlerAccount {
    constructor(context: AppContext) {
        super(context);
    }

    // parent >> child
    public async childAccountNotFound(
        parentBook: Book,
        childBook: Book,
        parentAccount: bkper.Account
    ): Promise<string> {
        const childAccount = new Account(childBook);
        await this.syncChildAccount(parentBook, childBook, parentAccount, childAccount);
        await childAccount.create();
        const bookAnchor = super.buildBookAnchor(childBook);
        return `${bookAnchor}: CHILD ACCOUNT ${childAccount.getName()} CREATED`;
    }

    protected async childAccountFound(
        parentBook: Book,
        childBook: Book,
        parentAccount: bkper.Account,
        childAccount: Account
    ): Promise<string> {
        await this.syncChildAccount(parentBook, childBook, parentAccount, childAccount);
        await childAccount.update();
        const bookAnchor = super.buildBookAnchor(childBook);
        return `${bookAnchor}: CHILD ACCOUNT ${childAccount.getName()} UPDATED`;
    }

    protected async syncChildAccount(
        parentBook: Book,
        childBook: Book,
        parentAccount: bkper.Account,
        childAccount: Account
    ): Promise<void> {
        childAccount.setGroups([]);
        childAccount
            .setName(parentAccount.name!)
            .setType(parentAccount.type as AccountType)
            .setVisibleProperties(parentAccount.properties!)
            .setArchived(parentAccount.archived!);
        if (parentAccount.groups) {
            for (const g of parentAccount.groups) {
                const parentGroup = await parentBook.getGroup(g.id);
                if (parentGroup) {
                    const childGroup = await childBook.getGroup(parentGroup.getName());
                    if (
                        childGroup &&
                        parentGroup.getProperty(CHILD_BOOK_ID_PROP) == childBook.getId()
                    ) {
                        childAccount.addGroup(childGroup);
                    }
                }
            }
        }
    }
}
