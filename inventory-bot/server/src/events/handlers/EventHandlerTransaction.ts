import type { Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { GOOD_PROP } from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import { EventHandler } from './EventHandler.js';

export abstract class EventHandlerTransaction extends EventHandler {
    constructor(context: AppContext) {
        super(context);
    }

    protected abstract connectedTransactionNotFound(
        inventoryBook: Book,
        financialTransaction: bkper.Transaction,
        goodExcCode?: string
    ): Promise<string | undefined>;

    protected abstract connectedTransactionFound(
        connectedBook: Book,
        connectedTransaction: Transaction
    ): Promise<string | undefined>;

    /**
     * Returns the remoteId query to find the matching transaction between Financial and Inventory Books
     * @param transaction The transaction to find the match for
     * @returns Query string in the format "remoteId:<transaction.id>"
     */
    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    override async processObject(
        financialBook: Book,
        inventoryBook: Book,
        event: bkper.Event
    ): Promise<string | undefined> {
        if (!event.data) {
            return undefined;
        }
        const excCode = this.botService.getBookExcCode(financialBook);
        const operation = event.data.object as bkper.TransactionOperation;
        const financialTransaction = operation.transaction;

        if (!financialTransaction || !financialTransaction.posted) {
            return undefined;
        }

        // The current SDK throws 404 for a missing Account; legacy returned undefined.
        const goodExcCode = await this.getGoodExcCodeFromTransaction(
            financialTransaction,
            financialBook
        );
        if (goodExcCode && excCode && !this.matchGoodExchange(goodExcCode, excCode)) {
            return undefined;
        }

        const transactions = await inventoryBook.listTransactions(
            this.getTransactionQuery(financialTransaction)
        );
        const goodTransaction = transactions.getFirst();
        if (goodTransaction) {
            return await this.connectedTransactionFound(inventoryBook, goodTransaction);
        }

        return await this.connectedTransactionNotFound(
            inventoryBook,
            financialTransaction,
            goodExcCode
        );
    }

    private async getGoodExcCodeFromTransaction(
        financialTransaction: bkper.Transaction,
        financialBook: Book
    ): Promise<string | undefined> {
        if (!financialTransaction.properties) {
            return undefined;
        }
        const goodProp = financialTransaction.properties[GOOD_PROP];
        const goodAccount = await optionalLookup(() => financialBook.getAccount(goodProp));
        if (goodAccount) {
            // sale
            return await this.botService.getExchangeCodeFromAccount(goodAccount);
        }
        // purchase
        const financialDebitAccount = financialTransaction.debitAccount;
        if (financialDebitAccount) {
            return await this.botService.getExchangeCodeFromAccount(financialDebitAccount);
        }
        return undefined;
    }
}
