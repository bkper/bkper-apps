import { Account, Book, Transaction } from "bkper-js";
import { Result } from "./index.js";
import { InterceptorOrderProcessorDelete } from "./InterceptorOrderProcessorDelete.js";

export class InterceptorOrderProcessorDeleteInstruments extends InterceptorOrderProcessorDelete {

    async intercept(stockBook: Book, event: bkper.Event): Promise<Result> {

        let operation = event.data.object as bkper.TransactionOperation;
        let transactionPayload = operation.transaction;

        if (!transactionPayload.posted) {
            return {result: false};
        }

        let stockTx = await stockBook.getTransaction(transactionPayload.id);
        let stockAccount = await this.getStockAccount(stockTx);
        if (!stockAccount) {
            return {result: false};
        }
        let stockExcCode = await this.botService.getExchangeCode(stockAccount);
        let financialBook = await this.botService.getFinancialBook(stockBook, stockExcCode);

        this.cascadeDelete(financialBook, transactionPayload);

        return {result: `DELETED: ${stockTx.getDateFormatted()} ${stockTx.getAmount()} ${await stockTx.getCreditAccountName()} ${await stockTx.getDebitAccountName()} ${stockTx.getDescription()}`};
    }

    async getStockAccount(stockTransaction: Transaction): Promise<Account> {
        let creditAccount = await stockTransaction.getCreditAccount();
        if (creditAccount.isPermanent()) {
            return creditAccount;
        }
        let debitAccount = await stockTransaction.getDebitAccount();
        if (debitAccount.isPermanent()) {
            return debitAccount;
        }
        return null;
    }

}