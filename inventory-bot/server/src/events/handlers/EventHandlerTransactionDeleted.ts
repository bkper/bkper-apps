import type { Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { InterceptorOrderProcessorDeleteFinancial } from '../interceptors/InterceptorOrderProcessorDeleteFinancial.js';
import { InterceptorOrderProcessorDeleteGoods } from '../interceptors/InterceptorOrderProcessorDeleteGoods.js';
import type { EventResult } from '../types.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionDeleted extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected override async intercept(book: Book, event: bkper.Event): Promise<EventResult> {
        if (this.botService.isInventoryBook(book)) {
            return new InterceptorOrderProcessorDeleteGoods(this.context).intercept(book, event);
        }
        return new InterceptorOrderProcessorDeleteFinancial(this.context).intercept(book, event);
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
