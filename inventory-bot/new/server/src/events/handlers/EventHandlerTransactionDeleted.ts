import type { Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionDeleted extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected async connectedTransactionNotFound(
        _inventoryBook: Book,
        _financialTransaction: bkper.Transaction,
        _goodExcCode?: string
    ): Promise<undefined> {
        return undefined;
    }

    protected async connectedTransactionFound(
        _inventoryBook: Book,
        _connectedTransaction: Transaction
    ): Promise<undefined> {
        return undefined;
    }
}
