import { Book } from "bkper-js";
import { Result } from "./index.js";
import { BotService } from "./BotService.js";
import { AppContext } from "./AppContext.js";

export abstract class EventHandler {

    protected context: AppContext;
    protected botService: BotService;

    constructor(context: AppContext) {
        this.context = context;
        this.botService = new BotService(context);
    }

    protected abstract processObject(eventBook: Book, connectedBook: Book, event: bkper.Event): Promise<string | undefined>;

    protected async intercept(eventBook: Book, event: bkper.Event): Promise<Result> {
        return { result: false };
    }

    async handleEvent(event: bkper.Event): Promise<Result> {

        let eventBook = new Book(event.book, this.context.bkper.getConfig());

        let interceptionResponse = await this.intercept(eventBook, event);
        if (interceptionResponse.result) {
            return interceptionResponse;
        }

        let responses: string[] = [];
        let warningMsg: string | undefined = undefined;

        let inventoryBook = this.botService.getInventoryBook(eventBook);

        const logtag = `Handling ${event.type} event on book ${eventBook.getName()} from user ${event.user?.username ?? 'unknown'}`;
        console.time(logtag);

        if (inventoryBook) {
            try {
                let response = await this.processObject(eventBook, inventoryBook, event);
                if (response) {
                    if (response.includes('WARNING')) {
                        warningMsg = response.split(' / ')[1];
                        response = response.split(' / ')[0];
                    }
                    if (response.includes('ERROR')) {
                        return { error: response };
                    }
                    responses.push(response);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.timeEnd(logtag);
                return { error: errorMessage };
            }
        } else {
            return { result: 'Inventory book not found in the collection (property inventory_book = true)' };
        }

        console.timeEnd(logtag);

        if (responses.length == 0) {
            return { result: false };
        }

        return { result: responses, warning: warningMsg };
    }

    protected matchGoodExchange(goodExcCode: string, excCode: string): boolean {
        goodExcCode = goodExcCode.trim();
        if (goodExcCode != excCode) {
            return false;
        }
        return true;
    }

}