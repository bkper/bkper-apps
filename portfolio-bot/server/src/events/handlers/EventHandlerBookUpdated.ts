import type { Book } from 'bkper-js';
import {
    EXC_HISTORICAL_PROP,
    STOCK_BOOK_PROP,
    STOCK_HISTORICAL_PROP,
} from '../../shared/constants.js';
import { EventHandler } from './EventHandler.js';

export class EventHandlerBookUpdated extends EventHandler {
    protected override async processObject(
        book: Book,
        _connectedBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        let response = '';
        const baseBook = this.botService.getBaseBook(book);

        if (this.botService.isStockBook(book)) {
            const stockHistorical = book.getProperty(STOCK_HISTORICAL_PROP);
            if (stockHistorical != baseBook!.getProperty(EXC_HISTORICAL_PROP)) {
                baseBook!.setProperty(EXC_HISTORICAL_PROP, stockHistorical);
                response += ` ${EXC_HISTORICAL_PROP}: ${stockHistorical}`;
            }
        }

        const pendingUpdates: Promise<Book>[] = [];
        const stockBookProperty = book.getProperty(STOCK_BOOK_PROP);
        if (stockBookProperty) {
            const collection = book.getCollection();
            if (collection) {
                for (const collectionBook of collection.getBooks()) {
                    if (
                        collectionBook.getProperty(STOCK_BOOK_PROP) &&
                        collectionBook.getId() !== book.getId()
                    ) {
                        pendingUpdates.push(
                            collectionBook.setProperty(STOCK_BOOK_PROP, '').update()
                        );
                    }
                }
            }
        }

        if (response !== '') {
            pendingUpdates.push(baseBook!.update());
            await this.waitForUpdates(pendingUpdates);
            return `${this.buildBookAnchor(baseBook!)}: ${response}`;
        }

        await this.waitForUpdates(pendingUpdates);
        return null;
    }

    private async waitForUpdates(updates: Promise<Book>[]): Promise<void> {
        const results = await Promise.allSettled(updates);
        for (const result of results) {
            if (result.status === 'rejected') {
                throw result.reason;
            }
        }
    }
}
