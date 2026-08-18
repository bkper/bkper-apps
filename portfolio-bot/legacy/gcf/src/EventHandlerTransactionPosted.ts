import { Result } from "./index.js";
import { InterceptorOrderProcessor } from "./InterceptorOrderProcessor.js";
import { AppContext } from "./AppContext.js";

export class EventHandlerTransactionPosted {

  private context: AppContext;

  constructor(context: AppContext) {
    this.context = context;
  }

  async handleEvent(event: bkper.Event): Promise<Result> {
    let baseBook = await this.context.bkper.getBook(event.bookId);
    const response = await new InterceptorOrderProcessor(this.context).intercept(baseBook, event)
    if (response) {
      return response;
    }
    return {result: false};
  }

}