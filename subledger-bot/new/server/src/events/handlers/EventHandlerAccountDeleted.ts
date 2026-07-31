import { Account, type Book } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { EventHandlerAccount } from './EventHandlerAccount.js';

export class EventHandlerAccountDeleted extends EventHandlerAccount {
    constructor(context: AppContext) {
        super(context);
    }

    // parent >> child
    public async childAccountNotFound(
        parentBook: Book,
        childBook: Book,
        parentAccount: bkper.Group
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(childBook);
        return `${bookAnchor}: CHILD ACCOUNT ${parentAccount.name} NOT Found`;
    }

    public async childAccountFound(
        parentBook: Book,
        childBook: Book,
        parentAccount: bkper.Account,
        childAccount: Account
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(childBook);
        if (childAccount.hasTransactionPosted()) {
            await childAccount.remove();
            return `${bookAnchor}: CHILD ACCOUNT ${childAccount.getName()} DELETED`;
        } else {
            await childAccount.setArchived(true).update();
            return `${bookAnchor}: CHILD ACCOUNT ${childAccount.getName()} ARCHIVED`;
        }
    }
}
