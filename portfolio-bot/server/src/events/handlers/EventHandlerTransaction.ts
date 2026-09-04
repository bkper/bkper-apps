import { type Amount, type Book, type Transaction } from 'bkper-js';
import { QUANTITY_PROP } from '../../shared/constants.js';
import { EventHandler } from './EventHandler.js';

export interface AmountDescription {
    amount: Amount;
    description: string;
}

export abstract class EventHandlerTransaction extends EventHandler {
    protected override async processObject(
        financialBook: Book,
        stockBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        const excCode = this.botService.getExcCode(financialBook);
        const operation = event.data!.object as bkper.TransactionOperation;
        const financialTransaction = operation.transaction!;

        if (!financialTransaction.posted) {
            return null;
        }

        const stockTransaction = (
            await stockBook.listTransactions(this.getTransactionQuery(financialTransaction))
        ).getFirst();

        const stockExcCode = this.getStockExcCodeFromTransaction(
            financialBook,
            financialTransaction
        );

        if (!this.matchStockExchange(stockExcCode, excCode)) {
            return null;
        }

        if (stockTransaction) {
            return this.connectedTransactionFound(
                financialBook,
                stockBook,
                financialTransaction,
                stockTransaction,
                stockExcCode!
            );
        }
        return this.connectedTransactionNotFound(
            financialBook,
            stockBook,
            financialTransaction,
            stockExcCode!
        );
    }

    protected getQuantity(stockBook: Book, transaction: bkper.Transaction): Amount | null {
        const quantityString = transaction.properties?.[QUANTITY_PROP];
        if (quantityString == null || quantityString.trim() == '') {
            return null;
        }
        return stockBook.parseValue(quantityString)!.abs();
    }

    private getStockExcCodeFromTransaction(
        financialBook: Book,
        financialTransaction: bkper.Transaction
    ): string | null {
        const financialCreditAccount = financialTransaction.creditAccount;
        const financialDebitAccount = financialTransaction.debitAccount;

        let stockExcCode = this.botService.getStockExchangeCode(financialCreditAccount);
        if (stockExcCode == null) {
            stockExcCode = this.botService.getStockExchangeCode(financialDebitAccount);
        }
        return stockExcCode;
    }

    protected abstract getTransactionQuery(transaction: bkper.Transaction): string;

    protected abstract connectedTransactionNotFound(
        financialBook: Book,
        stockBook: Book,
        financialTransaction: bkper.Transaction,
        stockExcCode: string
    ): Promise<string | null>;

    protected abstract connectedTransactionFound(
        financialBook: Book,
        stockBook: Book,
        financialTransaction: bkper.Transaction,
        stockTransaction: Transaction,
        stockExcCode: string
    ): Promise<string | null>;
}
