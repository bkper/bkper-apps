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

  protected abstract processObject(baseBook: Book, connectedBook: Book, event: bkper.Event): Promise<string>;

  protected async intercept(baseBook: Book, event: bkper.Event): Promise<Result> {
    return { result: false };
  }

  async handleEvent(event: bkper.Event): Promise<Result> {

    let baseBook = await this.context.bkper.getBook(event.bookId);

    let interceptionResponse = await this.intercept(baseBook, event);
    if (interceptionResponse.result) {
      return interceptionResponse;
    }
    let responses: string[] = [];

    let stockBook = this.botService.getStockBook(baseBook);

    const logtag = `Handling ${event.type} event on book ${baseBook.getName()} from user ${event.user.username} ${Math.random()}`;
    console.time(logtag);

    if (stockBook) {
      let response = await this.processObject(baseBook, stockBook, event);
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

  protected matchStockExchange(stockExcCode: string, excCode: string): boolean {
    if (stockExcCode == null || stockExcCode.trim() == '') {
      return false;
    }
    stockExcCode = stockExcCode.trim();
    if (excCode != null && stockExcCode != excCode) {
      return false;
    }
    return true;
  }

  protected buildBookAnchor(book: Book) {
    return `<a href='https://app.bkper.com/b/#transactions:bookId=${book.getId()}'>${book.getName()}</a>`;
  }

}
