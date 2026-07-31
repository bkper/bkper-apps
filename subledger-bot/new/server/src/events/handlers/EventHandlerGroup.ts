import type { Account, AccountType, Book, Group } from 'bkper-js';
import { CHILD_BOOK_ID_PROP, PARENT_ACCOUNT_PROP } from '../../constants.js';
import { EventHandler } from './EventHandler.js';

export abstract class EventHandlerGroup extends EventHandler {
    // parent >> child
    protected abstract childGroupNotFound(
        parentBook: Book,
        childBook: Book,
        parentGroup: bkper.Group
    ): Promise<string | null>;

    protected abstract childGroupFound(
        parentBook: Book,
        childBook: Book,
        parentGroup: bkper.Group,
        childGroup: Group
    ): Promise<string | null>;

    public async processParentBookEvent(
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        const parentGroup = event.data!.object as bkper.Group;

        try {
            const childBook = await this.getChildBook(parentGroup);
            if (childBook == null) {
                return null;
            }

            let childGroup = await childBook.getGroup(parentGroup.name);
            if (
                childGroup == null &&
                event.data!.previousAttributes &&
                event.data!.previousAttributes['name']
            ) {
                childGroup = await childBook.getGroup(event.data!.previousAttributes['name']);
            }

            if (childGroup) {
                return await this.childGroupFound(parentBook, childBook, parentGroup, childGroup);
            } else {
                return await this.childGroupNotFound(parentBook, childBook, parentGroup);
            }
        } catch (err: unknown) {
            throw `Failed to handle group [${parentGroup.name}] event: ${err}`;
        }
    }

    private async getChildBook(parentGroup: bkper.Group): Promise<Book | null> {
        if (parentGroup.properties![CHILD_BOOK_ID_PROP]) {
            return await this.context.bkper.getBook(parentGroup.properties![CHILD_BOOK_ID_PROP]);
        }
        return null;
    }

    // child >> parent
    protected abstract parentAccountNotFound(
        childBook: Book,
        parentBook: Book,
        childGroup: bkper.Group
    ): Promise<string | null>;

    protected abstract parentAccountFound(
        childBook: Book,
        parentBook: Book,
        childGroup: bkper.Group,
        parentAccount: Account
    ): Promise<string | null>;

    public async processChildBookEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        const childGroup = event.data!.object as bkper.Group;

        const parentAccountName = childGroup.properties![PARENT_ACCOUNT_PROP];
        if (parentAccountName) {
            let parentAccount = await parentBook.getAccount(parentAccountName);
            if (
                parentAccount == null &&
                event.data!.previousAttributes &&
                event.data!.previousAttributes[PARENT_ACCOUNT_PROP]
            ) {
                parentAccount = await parentBook.getAccount(
                    event.data!.previousAttributes[PARENT_ACCOUNT_PROP]
                );
            }
            if (parentAccount) {
                return await this.parentAccountFound(
                    childBook,
                    parentBook,
                    childGroup,
                    parentAccount
                );
            } else {
                return await this.parentAccountNotFound(childBook, parentBook, childGroup);
            }
        }
        return null;
    }

    protected async getChildGroupAccountType(
        childBook: Book,
        childGroup: bkper.Group
    ): Promise<AccountType> {
        const group = await childBook.getGroup(childGroup.id);
        return group!.getType();
    }
}
