import { Result } from "./index.js";
import { InterceptorFlagRebuild } from "./InterceptorFlagRebuild.js";
import { AppContext } from "./AppContext.js";

export class EventHandlerTransactionUnchecked {

  private context: AppContext;

  constructor(context: AppContext) {
    this.context = context;
  }

  async handleEvent(event: bkper.Event): Promise<Result> {
    let baseBook = await this.context.bkper.getBook(event.bookId);
    const response = await  new InterceptorFlagRebuild(this.context).intercept(baseBook, event);
    if (response) {
      return response;
    }
    return {result: false};
  }

}