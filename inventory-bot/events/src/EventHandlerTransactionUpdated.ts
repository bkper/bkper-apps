import { Book, Transaction } from "bkper-js";
import { EventHandlerTransaction } from "./EventHandlerTransaction.js";
import { InterceptorOrderProcessorDeleteFinancial } from "./InterceptorOrderProcessorDeleteFinancial.js";
import { Result } from "./index.js";

export class EventHandlerTransactionUpdated extends EventHandlerTransaction {

    // async intercept(eventBook: Book, event: bkper.Event): Promise<Result> {
    //     if (this.shouldCascadeDeletion(event)) {
    //         return await new InterceptorOrderProcessorDeleteFinancial().intercept(eventBook, event);
    //     }
    //     return await new InterceptorOrderProcessor().intercept(eventBook, event);
    // }

    // private shouldCascadeDeletion(event: bkper.Event): boolean {
    //     // No previousAttributes
    //     if (!event.data?.previousAttributes) {
    //         return false;
    //     }
    //     // No changes OR changed the description only
    //     const keys = Object.keys(event.data.previousAttributes);
    //     if (keys.length === 0 || (keys.length === 1 && keys[0] === 'description')) {
    //         return false;
    //     }
    //     return true;
    // }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        throw new Error("Method not implemented.");
    }
    protected connectedTransactionNotFound(inventoryBook: Book, financialTransaction: bkper.Transaction, goodExcCode: string): Promise<string> {
        throw new Error("Method not implemented.");
    }
    protected connectedTransactionFound(eventBook: Book, transaction: Transaction): Promise<string> {
        throw new Error("Method not implemented.");
    }

}