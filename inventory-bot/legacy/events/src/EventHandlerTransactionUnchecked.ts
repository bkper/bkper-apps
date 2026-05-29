import { Book } from "bkper-js";
import { Result } from "./index.js";
import { InterceptorFlagRebuild } from "./InterceptorFlagRebuild.js";
import { AppContext } from "./AppContext.js";
import { BotService } from "./BotService.js";

export class EventHandlerTransactionUnchecked {

  protected context: AppContext;
  protected botService: BotService;

  constructor(context: AppContext) {
    this.context = context;
    this.botService = new BotService(context);
  }

  async handleEvent(event: bkper.Event): Promise<Result> {
    let eventBook = new Book(event.book, this.context.bkper.getConfig());
    const response = await new InterceptorFlagRebuild(this.context).intercept(eventBook, event);
    if (response.result) {
      return response;
    }
    return { result: false };
  }

}