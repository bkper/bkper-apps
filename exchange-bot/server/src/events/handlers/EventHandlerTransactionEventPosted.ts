import type { Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { EventHandlerTransactionEvent } from './EventHandlerTransactionEvent.js';

export class EventHandlerTransactionPosted extends EventHandlerTransactionEvent {
    constructor(context: AppContext) {
        super(context);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    protected async connectedTransactionFound(
        baseBook: Book,
        connectedBook: Book,
        transaction: bkper.Transaction,
        connectedTransaction: Transaction
    ): Promise<string | null> {
        return null;
    }

    protected async connectedTransactionNotFound(
        baseBook: Book,
        connectedBook: Book,
        transaction: bkper.Transaction
    ): Promise<string | null> {
        const timeTagWrite = `Posted not found. [Book ${connectedBook.getName()}] [Owner ${connectedBook.getOwnerName()}] ${Math.random()}`;
        console.time(timeTagWrite);

        let newTransaction = await super.mirrorTransaction(baseBook, connectedBook, transaction);

        console.timeEnd(timeTagWrite);

        return newTransaction
            ? `${super.buildBookAnchor(connectedBook)}: ${newTransaction.getDate()} ${newTransaction.getAmount()} ${newTransaction.getDescription()}`
            : null;
    }
}
