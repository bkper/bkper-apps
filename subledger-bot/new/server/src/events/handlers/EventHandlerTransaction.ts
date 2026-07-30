import { Account, type Book } from 'bkper-js';
import { PARENT_ACCOUNT_PROP } from '../../constants.js';
import { EventHandler } from './EventHandler.js';

export abstract class EventHandlerTransaction extends EventHandler {
    protected processParentBookEvent(
        _parentBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        return Promise.resolve(null);
    }

    protected processChildBookEvent(
        _childBook: Book,
        _parentBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        return Promise.resolve(null);
    }

    protected async getParentAccount(
        childBook: Book,
        parentBook: Book,
        childAccount: Account
    ): Promise<Account | null | undefined> {
        if (childAccount.getProperty(PARENT_ACCOUNT_PROP)) {
            const parentAccountName = childAccount.getProperty(PARENT_ACCOUNT_PROP);
            return parentBook.getAccount(parentAccountName);
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
                    } catch (error: unknown) {
                        console.log(error);
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
                const sameNameParentAccount = await parentBook.getAccount(childAccount.getName());
                return sameNameParentAccount;
            }
        }

        return parentBook.getAccount(childAccount.getName());
    }
}
