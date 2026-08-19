import type { Account, Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import type { EventResult } from '../types.js';
import { InterceptorOrderProcessorDelete } from './InterceptorOrderProcessorDelete.js';

export class InterceptorOrderProcessorDeleteInstruments extends InterceptorOrderProcessorDelete {
    constructor(context: AppContext) {
        super(context);
    }

    async intercept(stockBook: Book, event: bkper.Event): Promise<EventResult> {
        const operation = event.data!.object as bkper.TransactionOperation;
        const transactionPayload = operation.transaction!;

        if (!transactionPayload.posted) {
            return { result: false };
        }

        const stockTransaction = (await stockBook.getTransaction(transactionPayload.id!))!;
        const stockAccount = await this.getStockAccount(stockTransaction);
        if (!stockAccount) {
            return { result: false };
        }
        const stockExchangeCode = await this.botService.getExchangeCode(stockAccount);
        const financialBook = await this.botService.getFinancialBook(
            stockBook,
            stockExchangeCode ?? undefined
        );

        await this.cascadeDelete(financialBook, transactionPayload);

        return {
            result: `DELETED: ${stockTransaction.getDateFormatted()} ${stockTransaction.getAmount()} ${await stockTransaction.getCreditAccountName()} ${await stockTransaction.getDebitAccountName()} ${stockTransaction.getDescription()}`,
        };
    }

    async getStockAccount(stockTransaction: Transaction): Promise<Account | null> {
        const creditAccount = (await stockTransaction.getCreditAccount())!;
        if (creditAccount.isPermanent()) {
            return creditAccount;
        }
        const debitAccount = (await stockTransaction.getDebitAccount())!;
        if (debitAccount.isPermanent()) {
            return debitAccount;
        }
        return null;
    }
}
