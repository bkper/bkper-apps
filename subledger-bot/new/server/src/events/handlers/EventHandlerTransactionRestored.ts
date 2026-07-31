import { type Book, Transaction } from 'bkper-js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionRestored extends EventHandlerTransaction {
    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    protected parentTransactionNotFound(
        childBook: Book,
        parentBook: Book,
        childTransaction: bkper.Transaction
    ): Promise<string | null> {
        return Promise.resolve(null);
    }

    protected parentTransactionFound(
        childBook: Book,
        parentBook: Book,
        childTransaction: bkper.Transaction,
        parentTransaction: Transaction
    ): Promise<string | null> {
        return Promise.resolve(null);
    }
}
