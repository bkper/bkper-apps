import { Book, Transaction } from "bkper-js";
import { EventHandler } from "./EventHandler.js";
import { GOOD_PROP } from "./constants.js";
import { AppContext } from "./AppContext.js";

export abstract class EventHandlerTransaction extends EventHandler {

    constructor(context: AppContext) {
        super(context);
    }

    protected abstract connectedTransactionNotFound(inventoryBook: Book, financialTransaction: bkper.Transaction, goodExcCode?: string): Promise<string | undefined>;
    protected abstract connectedTransactionFound(connectedBook: Book, connectedTransaction: Transaction): Promise<string | undefined>;

    /**
     * Returns the remoteId query to find the matching transaction between Financial and Inventory Books
     * @param transaction The transaction to find the match for
     * @returns Query string in the format "remoteId:<transaction.id>"
     */
    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    async processObject(financialBook: Book, inventoryBook: Book, event: bkper.Event): Promise<string | undefined> {
        if (!event.data) {
            return undefined;
        }
        let excCode = this.botService.getBookExcCode(financialBook);
        let operation = event.data.object as bkper.TransactionOperation;
        let financialTransaction = operation.transaction;

        if (!financialTransaction || !financialTransaction.posted) {
            return undefined;
        }

        // Get the good exchange code from transaction and verify if it matches the book's exchange code
        // If they don't match, skip processing the transaction
        let goodExcCode = await this.getGoodExcCodeFromTransaction(financialTransaction, financialBook);
        if (goodExcCode && excCode && !this.matchGoodExchange(goodExcCode, excCode)) {
            return undefined;
        }
        
        let goodTransaction = (await inventoryBook.listTransactions(this.getTransactionQuery(financialTransaction))).getFirst();
        if (goodTransaction) {
            return await this.connectedTransactionFound(inventoryBook, goodTransaction);
        } else {
            return await this.connectedTransactionNotFound(inventoryBook, financialTransaction, goodExcCode)
        }
    }

    private async getGoodExcCodeFromTransaction(financialTransaction: bkper.Transaction, financialBook: Book): Promise<string | undefined> {
        if (!financialTransaction.properties) {
            return undefined;
        }
        let goodProp = financialTransaction.properties[GOOD_PROP];
        let goodAccount = await financialBook.getAccount(goodProp);
        if (goodAccount) {
            // sale
            return await this.botService.getExchangeCodeFromAccount(goodAccount);
        } else {
            // purchase
            const financialDebitAccount = financialTransaction.debitAccount;
            if (financialDebitAccount) {
                return await this.botService.getExchangeCodeFromAccount(financialDebitAccount);
            }
        }
        return undefined;
    }
}
