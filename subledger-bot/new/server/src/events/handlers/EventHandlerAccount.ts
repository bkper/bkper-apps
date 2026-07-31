import { Account, type Book } from 'bkper-js';
import { CHILD_BOOK_ID_PROP } from '../../constants.js';
import { EventHandler } from './EventHandler.js';

export abstract class EventHandlerAccount extends EventHandler {
    // parent >> child
    protected abstract childAccountNotFound(
        parentBook: Book,
        childBook: Book,
        parentAccount: bkper.Account
    ): Promise<string | null>;

    protected abstract childAccountFound(
        parentBook: Book,
        childBook: Book,
        parentAccount: bkper.Account,
        childAccount: Account
    ): Promise<string | null>;

    public async processParentBookEvent(
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        const parentAccount = event.data!.object as bkper.Account;
        try {
            const childBook = await this.getChildBook(parentBook, parentAccount);

            if (childBook == null) {
                return null;
            }

            let childAccount = await childBook.getAccount(parentAccount.name);

            if (
                childAccount == null &&
                event.data!.previousAttributes &&
                event.data!.previousAttributes['name']
            ) {
                childAccount = await childBook.getAccount(event.data!.previousAttributes['name']);
            }

            if (childAccount) {
                return await this.childAccountFound(
                    parentBook,
                    childBook,
                    parentAccount,
                    childAccount
                );
            } else {
                return await this.childAccountNotFound(parentBook, childBook, parentAccount);
            }
        } catch (err: unknown) {
            throw `Failed to handle account [${parentAccount.name}] event: ${err}`;
        }
    }

    private async getChildBook(
        parentBook: Book,
        parentAccount: bkper.Account
    ): Promise<Book | null> {
        if (parentAccount.groups) {
            for (const g of parentAccount.groups) {
                const group = await parentBook.getGroup(g.id);
                if (group!.getProperty(CHILD_BOOK_ID_PROP)) {
                    return await this.context.bkper.getBook(
                        group!.getProperty(CHILD_BOOK_ID_PROP)!
                    );
                }
            }
        }
        return null;
    }

    // child >> parent
    public async processChildBookEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return null;
    }
}
