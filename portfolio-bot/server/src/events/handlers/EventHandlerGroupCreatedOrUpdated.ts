import { type Book, Group } from 'bkper-js';
import { EventHandlerGroup } from './EventHandlerGroup.js';

export class EventHandlerGroupCreatedOrUpdated extends EventHandlerGroup {
    protected async connectedGroupNotFound(
        _financialBook: Book,
        stockBook: Book,
        financialGroup: bkper.Group
    ): Promise<string> {
        const stockGroup = await new Group(stockBook)
            .setName(financialGroup.name!)
            .setHidden(financialGroup.hidden!)
            .setVisibleProperties(financialGroup.properties ?? {})
            .create();
        const bookAnchor = super.buildBookAnchor(stockBook);
        return `${bookAnchor}: GROUP ${stockGroup.getName()} CREATED`;
    }

    protected async connectedGroupFound(
        _financialBook: Book,
        stockBook: Book,
        financialGroup: bkper.Group,
        stockGroup: Group
    ): Promise<string> {
        await stockGroup
            .setName(financialGroup.name!)
            .setHidden(financialGroup.hidden!)
            .setVisibleProperties(financialGroup.properties ?? {})
            .update();
        const bookAnchor = super.buildBookAnchor(stockBook);
        return `${bookAnchor}: GROUP ${stockGroup.getName()} UPDATED`;
    }
}
