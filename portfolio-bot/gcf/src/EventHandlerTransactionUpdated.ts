import { Amount, Book, Transaction } from "bkper-js";
import { Result } from "./index.js";
import { ORIGINAL_AMOUNT_PROP, ORIGINAL_QUANTITY_PROP, PURCHASE_PRICE_PROP, SALE_PRICE_PROP } from "./constants.js";
import { EventHandlerTransaction } from "./EventHandlerTransaction.js";
import { InterceptorOrderProcessor } from "./InterceptorOrderProcessor.js";
import { InterceptorOrderProcessorDeleteFinancial } from "./InterceptorOrderProcessorDeleteFinancial.js";
import { AppContext } from "./AppContext.js";

export class EventHandlerTransactionUpdated extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    async intercept(baseBook: Book, event: bkper.Event): Promise<Result> {
        if (this.shouldCascadeDeletion(event)) {
            await new InterceptorOrderProcessorDeleteFinancial(this.context).intercept(baseBook, event);
        }
        return await new InterceptorOrderProcessor(this.context).intercept(baseBook, event);
    }

    private shouldCascadeDeletion(event: bkper.Event): boolean {
        // No previousAttributes
        if (!event.data.previousAttributes) {
            return false;
        }
        // No changes OR changed the description only
        const keys = Object.keys(event.data.previousAttributes);
        if (keys.length === 0 || (keys.length === 1 && keys[0] === 'description')) {
            return false;
        }
        return true;
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    protected connectedTransactionNotFound(financialBook: Book, stockBook: Book, financialTransaction: bkper.Transaction, stockExcCode: string): Promise<string> {
        return null;
    }

    protected async connectedTransactionFound(financialBook: Book, stockBook: Book, financialTransaction: bkper.Transaction, stockTransaction: Transaction, stockExcCode: string): Promise<string> {

        if (!financialTransaction.posted) {
            return null;
        }

        let quantity = this.getQuantity(stockBook, financialTransaction);
        if (quantity == null || quantity.eq(0)) {
            return null;
        }

        if (stockTransaction.isChecked()) {
            stockTransaction.uncheck();
        }

        const price = new Amount(financialTransaction.amount).div(quantity);
        const originalAmount = new Amount(financialTransaction.amount);

        stockTransaction
            .setDate(financialTransaction.date)
            .setAmount(quantity)
            .setDescription(financialTransaction.description)
            .setProperty(ORIGINAL_QUANTITY_PROP, quantity.toFixed(stockBook.getFractionDigits()))
            .setProperty(ORIGINAL_AMOUNT_PROP, originalAmount.toString())
        ;

        if (await this.botService.isPurchase(stockTransaction)) {
            stockTransaction.setProperty(PURCHASE_PRICE_PROP, price.toString());
        }

        if (await this.botService.isSale(stockTransaction)) {
            stockTransaction.setProperty(SALE_PRICE_PROP, price.toString());
        }

        try {
            await stockTransaction.update();
        } catch (err) {
            //Maybe is checked
            await stockTransaction.uncheck();
            await stockTransaction.update();
        }

        await this.botService.flagStockAccountForRebuildIfNeeded(stockTransaction);

        let bookAnchor = super.buildBookAnchor(stockBook);
        let record = `EDITED: ${stockTransaction.getDateFormatted()} ${quantity} ${await stockTransaction.getCreditAccountName()} ${await stockTransaction.getDebitAccountName()} ${stockTransaction.getDescription()}`;
        return `${bookAnchor}: ${record}`;
    }

}
