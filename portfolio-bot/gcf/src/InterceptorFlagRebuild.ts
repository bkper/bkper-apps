import { Book } from "bkper-js";
import { Result } from "./index.js";
import { BotService } from "./BotService.js";
import { NEEDS_REBUILD_PROP } from "./constants.js";
import { AppContext } from "./AppContext.js";

export class InterceptorFlagRebuild {

  private botService: BotService;

  constructor(context: AppContext) {
    this.botService = new BotService(context);
  }

  async intercept(baseBook: Book, event: bkper.Event): Promise<Result> {
    if (this.botService.isStockBook(baseBook) && event.agent.id != 'stock-bot') {
      let operation = event.data.object as bkper.TransactionOperation;
      let transactionPayload = operation.transaction;
      let transaction = await baseBook.getTransaction(transactionPayload.id);
      
      let stockAccount = await this.botService.getStockAccount(transaction);

      if(stockAccount && stockAccount.getProperty(NEEDS_REBUILD_PROP) == null) {
        stockAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
          const msg = `Flagging account ${stockAccount.getName()} for rebuild`;
        return {warning: msg, result: msg};
      }
    }
    return {result: false};
  }

}