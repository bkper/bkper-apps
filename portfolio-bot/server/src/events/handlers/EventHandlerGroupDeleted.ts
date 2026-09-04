import type { Book, Group } from 'bkper-js';
import { EventHandlerGroup } from './EventHandlerGroup.js';

export class EventHandlerGroupDeleted extends EventHandlerGroup {
    protected async connectedGroupNotFound(
        _financialBook: Book,
        stockBook: Book,
        financialGroup: bkper.Group
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(stockBook);
        return `${bookAnchor}: GROUP ${financialGroup.name} NOT Found`;
    }

    protected async connectedGroupFound(
        _financialBook: Book,
        stockBook: Book,
        _financialGroup: bkper.Group,
        stockGroup: Group
    ): Promise<string> {
        await stockGroup.remove();
        const bookAnchor = super.buildBookAnchor(stockBook);
        return `${bookAnchor}: GROUP ${stockGroup.getName()} DELETED`;
    }
}
