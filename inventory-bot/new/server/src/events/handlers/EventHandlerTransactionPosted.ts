import { Book } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { BotService } from '../services/BotService.js';
import type { EventResult } from '../types.js';

export class EventHandlerTransactionPosted {
    protected botService: BotService;
    protected context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
        this.botService = new BotService(context);
    }

    async handleEvent(event: bkper.Event): Promise<EventResult> {
        const eventBook = new Book(event.book, this.context.bkper.getConfig());

        // Prevent direct transactions posted in the Inventory Book.
        if (this.botService.isInventoryBook(eventBook)) {
            if (event.data) {
                if (!event.data.object) {
                    return { result: false };
                }
                const operation = event.data.object as bkper.TransactionOperation;
                const transactionPayload = operation.transaction;
                const transaction = (
                    await eventBook.listTransactions(transactionPayload!.id!)
                ).getFirst();
                if (transaction) {
                    await this.botService.uncheckAndTrash(transaction);
                }
                const warningMessage = `You can't post directly in the Inventory book. Transaction deleted.`;

                return { warning: warningMessage };
            }
        }
        return { result: false };
    }
}
