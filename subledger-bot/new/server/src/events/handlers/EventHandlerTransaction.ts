import { Account, type Book } from 'bkper-js';
import { PARENT_ACCOUNT_PROP } from '../../constants.js';
import { EventHandler } from './EventHandler.js';

export abstract class EventHandlerTransaction extends EventHandler {
    protected processParentBookEvent(parentBook: Book, event: bkper.Event): Promise<string | null> {
        return Promise.resolve(null);
    }

    protected processChildBookEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return Promise.resolve(null);
    }

    protected async getParentAccount(
        childBook: Book,
        parentBook: Book,
        childAccount: Account
    ): Promise<Account | null | undefined> {
        // If the parent_account property is set directly on the child account, use it to find the parent account
        if (childAccount.getProperty(PARENT_ACCOUNT_PROP)) {
            const parentAccountName = childAccount.getProperty(PARENT_ACCOUNT_PROP);
            const parentAccount = await parentBook.getAccount(parentAccountName);
            return parentAccount;
        }

        const childGroups = await childAccount.getGroups();

        for (const childGroup of childGroups) {
            const parentAccountName = childGroup.getProperty(PARENT_ACCOUNT_PROP);
            if (parentAccountName) {
                let parentAccount = await parentBook.getAccount(parentAccountName);
                if (parentAccount == null) {
                    try {
                        parentAccount = await new Account(parentBook)
                            .setName(parentAccountName)
                            .setType(childGroup.getType())
                            .create();
                    } catch (err: unknown) {
                        console.log(err);
                        return null;
                    }
                }

                return parentAccount;
            }

            const linkedParentGroup = await this.getLinkedParentGroup(
                childBook,
                parentBook,
                childGroup
            );

            if (linkedParentGroup) {
                const parentAccountName = childAccount.getName();
                const parentAccount = await parentBook.getAccount(parentAccountName);
                return parentAccount;
            }
        }

        // Falback for account with same name as child
        return await parentBook.getAccount(childAccount.getName());
    }
}
