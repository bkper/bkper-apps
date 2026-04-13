import { Book } from "bkper-js";
import { Result } from "./index.js";
import { EventHandlerTransaction } from "./EventHandlerTransaction.js";
import { AppContext } from "./AppContext.js";
import { InterceptorOrderProcessorDeleteGoods } from "./InterceptorOrderProcessorDeleteGoods.js";
import { InterceptorOrderProcessorDeleteFinancial } from "./InterceptorOrderProcessorDeleteFinancial.js";

export class EventHandlerTransactionDeleted extends EventHandlerTransaction {

    constructor(context: AppContext) {
        super(context);
    }

    async intercept(book: Book, event: bkper.Event): Promise<Result> {
        let result: Result;
        if (this.botService.isInventoryBook(book)) {
            result = await new InterceptorOrderProcessorDeleteGoods(this.context).intercept(book, event);
        } else {
            result = await new InterceptorOrderProcessorDeleteFinancial(this.context).intercept(book, event);
        }
        return result;
    }

    protected connectedTransactionNotFound(inventoryBook: Book, financialTransaction: bkper.Transaction, goodExcCode?: string): Promise<string | undefined> {
        return new Promise((resolve, reject) => {
            const result = undefined;
            resolve(result);
        });
    }

    protected connectedTransactionFound(): Promise<string | undefined> {
        return new Promise((resolve, reject) => {
            const result = undefined;
            resolve(result);
        });
    }

}