import type { Book, Group } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { EventHandlerGroup } from './EventHandlerGroup.js';

export class EventHandlerGroupDeleted extends EventHandlerGroup {
    constructor(context: AppContext) {
        super(context);
    }

    protected async connectedGroupNotFound(
        baseBook: Book,
        connectedBook: Book,
        group: bkper.Group
    ): Promise<string | null> {
        let bookAnchor = super.buildBookAnchor(connectedBook);
        return `${bookAnchor}: GROUP ${group.name} NOT Found`;
    }

    protected async connectedGroupFound(
        baseBook: Book,
        connectedBook: Book,
        group: bkper.Group,
        connectedGroup: Group
    ): Promise<string | null> {
        await connectedGroup.remove();
        let bookAnchor = super.buildBookAnchor(connectedBook);
        return `${bookAnchor}: GROUP ${connectedGroup.getName()} DELETED`;
    }
}
