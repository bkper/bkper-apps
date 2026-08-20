import type { Book, Group } from 'bkper-js';
import { STOCK_EXC_CODE_PROP } from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import { EventHandler } from './EventHandler.js';

export abstract class EventHandlerGroup extends EventHandler {
    protected override async processObject(
        financialBook: Book,
        stockBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        const excCode = this.botService.getExcCode(financialBook);
        const financialGroup = event.data!.object as bkper.Group;
        const stockExcCode = financialGroup.properties![STOCK_EXC_CODE_PROP];

        if (!this.matchStockExchange(stockExcCode, excCode)) {
            return null;
        }

        let stockGroup = await optionalLookup(() => stockBook.getGroup(financialGroup.name));
        const previousName = event.data!.previousAttributes?.['name'];
        if (stockGroup == null && previousName) {
            stockGroup = await optionalLookup(() => stockBook.getGroup(previousName));
        }

        if (stockGroup) {
            return this.connectedGroupFound(financialBook, stockBook, financialGroup, stockGroup);
        }
        return this.connectedGroupNotFound(financialBook, stockBook, financialGroup);
    }

    protected abstract connectedGroupNotFound(
        financialBook: Book,
        stockBook: Book,
        financialGroup: bkper.Group
    ): Promise<string>;

    protected abstract connectedGroupFound(
        financialBook: Book,
        stockBook: Book,
        financialGroup: bkper.Group,
        stockGroup: Group
    ): Promise<string>;
}
