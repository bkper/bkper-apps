import type { Book } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { BotService } from '../services/BotService.js';
import type { EventResult } from '../types.js';

export abstract class EventHandler {
    protected context: AppContext;
    protected botService: BotService;

    constructor(context: AppContext) {
        this.context = context;
        this.botService = new BotService(context);
    }

    protected async processObject(
        _baseBook: Book,
        _connectedBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        return null;
    }

    protected async intercept(_baseBook: Book, _event: bkper.Event): Promise<EventResult> {
        return { result: false };
    }

    async handleEvent(event: bkper.Event): Promise<EventResult> {
        const baseBook = await this.context.bkper.getBook(event.bookId!);

        const interceptionResponse = await this.intercept(baseBook, event);
        if (interceptionResponse.result) {
            return interceptionResponse;
        }
        const responses: string[] = [];

        const stockBook = this.botService.getStockBook(baseBook);

        const logtag = `Handling ${event.type} event on book ${baseBook.getName()} from user ${event.user!.username} ${Math.random()}`;
        console.time(logtag);

        if (stockBook) {
            const response = await this.processObject(baseBook, stockBook, event);
            if (response) {
                responses.push(response);
            }
        } else {
            return { result: 'No book with 0 decimal places found in the collection' };
        }

        console.timeEnd(logtag);

        if (responses.length == 0) {
            return { result: false };
        }

        return { result: responses };
    }

    protected matchStockExchange(stockExcCode?: string | null, excCode?: string | null): boolean {
        if (stockExcCode == null || stockExcCode.trim() == '') {
            return false;
        }
        stockExcCode = stockExcCode.trim();
        if (excCode != null && stockExcCode != excCode) {
            return false;
        }
        return true;
    }

    protected buildBookAnchor(book: Book): string {
        return `<a href='https://app.bkper.com/b/#transactions:bookId=${book.getId()}'>${book.getName()}</a>`;
    }
}
