import type { Book } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { NEEDS_REBUILD_PROP } from '../../shared/constants.js';
import { BotService } from '../services/BotService.js';
import type { EventResult } from '../types.js';

export class InterceptorFlagRebuild {
    private botService: BotService;

    constructor(context: AppContext) {
        this.botService = new BotService(context);
    }

    async intercept(baseBook: Book, event: bkper.Event): Promise<EventResult> {
        if (this.botService.isStockBook(baseBook) && event.agent!.id != 'stock-bot') {
            const operation = event.data!.object as bkper.TransactionOperation;
            const transactionPayload = operation.transaction!;
            const transaction = await baseBook.getTransaction(transactionPayload.id!);

            const stockAccount = await this.botService.getStockAccount(transaction!);

            if (stockAccount && stockAccount.getProperty(NEEDS_REBUILD_PROP) == null) {
                await stockAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
                const message = `Flagging account ${stockAccount.getName()} for rebuild`;
                return { warning: message, result: message };
            }
        }
        return { result: false };
    }
}
