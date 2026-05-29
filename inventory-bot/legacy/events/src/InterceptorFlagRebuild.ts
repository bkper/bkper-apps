import { Book } from "bkper-js";
import { Result } from "./index.js";
import { BotService } from "./BotService.js";
import { NEEDS_REBUILD_PROP } from "./constants.js";
import { AppContext } from "./AppContext.js";

export class InterceptorFlagRebuild {

    protected context: AppContext;
    protected botService: BotService;

    constructor(context: AppContext) {
        this.context = context;
        this.botService = new BotService(context);
    }

    async intercept(eventBook: Book, event: bkper.Event): Promise<Result> {
        if (this.botService.isInventoryBook(eventBook) && event.agent?.id != 'inventory-bot') {
            if (event.data) {
                if (!event.data.object) {
                    return { result: false };
                }
                let operation = event.data.object as bkper.TransactionOperation;
                let transactionPayload = operation.transaction;
                let transaction = (await eventBook.listTransactions(transactionPayload!.id!)).getFirst();
                
                let goodAccount = transaction ? await this.botService.getGoodAccount(transaction) : null;
                
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