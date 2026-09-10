import type { Book } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { NEEDS_REBUILD_PROP } from '../../shared/constants.js';
import { BotService } from '../services/BotService.js';
import type { EventResult } from '../types.js';

export class InterceptorFlagRebuild {
    protected context: AppContext;
    protected botService: BotService;

    constructor(context: AppContext) {
        this.context = context;
        this.botService = new BotService(context);
    }

    async intercept(eventBook: Book, event: bkper.Event): Promise<EventResult> {
        if (this.botService.isInventoryBook(eventBook) && event.agent?.id != 'inventory-bot') {
            if (event.data) {
                if (!event.data.object) {
                    return { result: false };
                }
                const operation = event.data.object as bkper.TransactionOperation;
                const transactionPayload = operation.transaction;
                const transaction = (
                    await eventBook.listTransactions(transactionPayload!.id!)
                ).getFirst();

                const goodAccount = transaction
                    ? await this.botService.getGoodAccount(transaction)
                    : null;

                if (goodAccount && goodAccount.getProperty(NEEDS_REBUILD_PROP) == null) {
                    await goodAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
                    const msg = `Flagging account ${goodAccount.getName()} for rebuild`;
                    return { warning: msg, result: msg };
                }
            }
        }
        return { result: false };
    }
}
