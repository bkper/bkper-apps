import type { Account, Book, Group } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { EventHandlerGroup } from './EventHandlerGroup.js';

export class EventHandlerGroupDeleted extends EventHandlerGroup {
    constructor(context: AppContext) {
        super(context);
    }

    // parent >> child
    public async childGroupNotFound(
        parentBook: Book,
        childBook: Book,
        parentGroup: bkper.Group
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(childBook);
        return `${bookAnchor}: CHILD GROUP ${parentGroup.name} NOT Found`;
    }

    public async childGroupFound(
        parentBook: Book,
        childBook: Book,
        parentGroup: bkper.Group,
        childGroup: Group
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(childBook);
        await childGroup.remove();
        return `${bookAnchor}: CHILD GROUP ${childGroup.getName()} DELETED`;
    }

    // child >> parent
    public async parentAccountNotFound(
        childBook: Book,
        parentBook: Book,
        childGroup: bkper.Group
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(parentBook);
        return `${bookAnchor}: PARENT ACCOUNT ${childGroup.name} NOT Found`;
    }

    public async parentAccountFound(
        childBook: Book,
        parentBook: Book,
        childGroup: bkper.Group,
        parentAccount: Account
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(parentBook);
        if (parentAccount.hasTransactionPosted()) {
            await parentAccount.remove();
            return `${bookAnchor}: PARENT ACCOUNT ${parentAccount.getName()} DELETED`;
        } else {
            await parentAccount.setArchived(true).update();
            return `${bookAnchor}: PARENT ACCOUNT ${parentAccount.getName()} ARCHIVED`;
        }
    }

    public async parentGroupNotFound(
        childBook: Book,
        parentBook: Book,
        childGroup: bkper.Group
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(parentBook);
        return `${bookAnchor}: PARENT GROUP ${childGroup.name} NOT Found`;
    }
}
