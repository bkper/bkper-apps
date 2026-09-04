import { Amount, type Book, type Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import {
    ORIGINAL_AMOUNT_PROP,
    ORIGINAL_QUANTITY_PROP,
    PURCHASE_PRICE_PROP,
    SALE_PRICE_PROP,
} from '../../shared/constants.js';
import { InterceptorOrderProcessor } from '../interceptors/InterceptorOrderProcessor.js';
import { InterceptorOrderProcessorDeleteFinancial } from '../interceptors/InterceptorOrderProcessorDeleteFinancial.js';
import type { EventResult } from '../types.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionUpdated extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected override async intercept(baseBook: Book, event: bkper.Event): Promise<EventResult> {
        if (this.shouldCascadeDeletion(event)) {
            await new InterceptorOrderProcessorDeleteFinancial(this.context).intercept(
                baseBook,
                event
            );
        }
        return new InterceptorOrderProcessor(this.context).intercept(baseBook, event);
    }

    private shouldCascadeDeletion(event: bkper.Event): boolean {
        if (!event.data!.previousAttributes) {
            return false;
        }
        const keys = Object.keys(event.data!.previousAttributes);
        if (keys.length === 0 || (keys.length === 1 && keys[0] === 'description')) {
            return false;
        }
        return true;
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    protected async connectedTransactionNotFound(
        _financialBook: Book,
        _stockBook: Book,
        _financialTransaction: bkper.Transaction,
        _stockExcCode: string
    ): Promise<null> {
        return null;
    }

    protected async connectedTransactionFound(
        _financialBook: Book,
        stockBook: Book,
        financialTransaction: bkper.Transaction,
        stockTransaction: Transaction,
        _stockExcCode: string
    ): Promise<string | null> {
        if (!financialTransaction.posted) {
            return null;
        }

        const quantity = this.getQuantity(stockBook, financialTransaction);
        if (quantity == null || quantity.eq(0)) {
            return null;
        }

        if (stockTransaction.isChecked()) {
            await stockTransaction.uncheck();
        }

        const originalAmount = new Amount(financialTransaction.amount!);
        const price = originalAmount.div(quantity);

        stockTransaction
            .setDate(financialTransaction.date!)
            .setAmount(quantity)
            .setDescription(financialTransaction.description!)
            .setProperty(ORIGINAL_QUANTITY_PROP, quantity.toFixed(stockBook.getFractionDigits()))
            .setProperty(ORIGINAL_AMOUNT_PROP, originalAmount.toString());

        if (await this.botService.isPurchase(stockTransaction)) {
            stockTransaction.setProperty(PURCHASE_PRICE_PROP, price.toString());
        }

        if (await this.botService.isSale(stockTransaction)) {
            stockTransaction.setProperty(SALE_PRICE_PROP, price.toString());
        }

        try {
            await stockTransaction.update();
        } catch (_error: unknown) {
            await stockTransaction.uncheck();
            await stockTransaction.update();
        }

        await this.botService.flagStockAccountForRebuildIfNeeded(stockTransaction);

        const bookAnchor = super.buildBookAnchor(stockBook);
        const record = `EDITED: ${stockTransaction.getDateFormatted()} ${quantity} ${await stockTransaction.getCreditAccountName()} ${await stockTransaction.getDebitAccountName()} ${stockTransaction.getDescription()}`;
        return `${bookAnchor}: ${record}`;
    }
}
