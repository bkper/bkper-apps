import { Account, type Book, Group } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { CHILD_BOOK_ID_PROP, PARENT_ACCOUNT_PROP } from '../../constants.js';
import { EventHandlerGroup } from './EventHandlerGroup.js';

export class EventHandlerGroupCreatedOrUpdated extends EventHandlerGroup {
    constructor(context: AppContext) {
        super(context);
    }

    // parent >> child
    protected async childGroupNotFound(
        parentBook: Book,
        childBook: Book,
        parentGroup: bkper.Group
    ): Promise<string> {
        console.log(`CREATE: ${parentGroup.name}`);
        const childGroup = await new Group(childBook)
            .setName(parentGroup.name!)
            .setVisibleProperties(parentGroup.properties!)
            .deleteProperty(CHILD_BOOK_ID_PROP)
            .create();
        const bookAnchor = super.buildBookAnchor(childBook);
        return `${bookAnchor}: CHILD GROUP ${childGroup.getName()} CREATED`;
    }

    protected async childGroupFound(
        parentBook: Book,
        childBook: Book,
        parentGroup: bkper.Group,
        childGroup: Group
    ): Promise<string> {
        console.log(`UPDATE: ${parentGroup.name}`);
        await childGroup
            .setName(parentGroup.name!)
            .setVisibleProperties(parentGroup.properties!)
            .deleteProperty(CHILD_BOOK_ID_PROP)
            .update();
        const bookAnchor = super.buildBookAnchor(childBook);
        return `${bookAnchor}: CHILD GROUP ${childGroup.getName()} UPDATED`;
    }

    // child >> parent
    protected async parentAccountNotFound(
        childBook: Book,
        parentBook: Book,
        childGroup: bkper.Group
    ): Promise<string> {
        console.log(`CREATE: ${childGroup.properties![PARENT_ACCOUNT_PROP]}`);
        const parentAccount = await new Account(parentBook)
            .setName(childGroup.properties![PARENT_ACCOUNT_PROP])
            .setType(await this.getChildGroupAccountType(childBook, childGroup))
            .create();
        const bookAnchor = super.buildBookAnchor(parentBook);
        return `${bookAnchor}: PARENT ACCOUNT ${parentAccount.getName()} CREATED`;
    }

    public async parentAccountFound(
        childBook: Book,
        parentBook: Book,
        childGroup: bkper.Group,
        parentAccount: Account
    ): Promise<string> {
        console.log(`UPDATE: ${childGroup.properties![PARENT_ACCOUNT_PROP]}`);
        await parentAccount
            .setName(childGroup.properties![PARENT_ACCOUNT_PROP])
            .setType(await this.getChildGroupAccountType(childBook, childGroup))
            .update();
        const bookAnchor = super.buildBookAnchor(parentBook);
        return `${bookAnchor}: PARENT ACCOUNT ${parentAccount.getName()} UPDATED`;
    }
}
