import { Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { ORIGINAL_QUANTITY_PROP, PARENT_ID_PROP } from '../../shared/constants.js';
import { BotService } from '../services/BotService.js';

export abstract class InterceptorOrderProcessorDelete {
    protected context: AppContext;
    protected botService: BotService;

    constructor(context: AppContext) {
        this.context = context;
        this.botService = new BotService(context);
    }

    protected async cascadeDeleteInventoryTransactions(
        inventoryBook: Book,
        deletedTransaction: bkper.Transaction | Transaction
    ): Promise<Transaction[] | undefined> {
        const responses: Transaction[] = [];

        const transactionId =
            deletedTransaction instanceof Transaction
                ? deletedTransaction.getId()
                : deletedTransaction.id;
        const originalQuantity =
            deletedTransaction instanceof Transaction
                ? deletedTransaction.getProperty(ORIGINAL_QUANTITY_PROP)
                : deletedTransaction.properties?.[ORIGINAL_QUANTITY_PROP];
        const accountName =
            deletedTransaction instanceof Transaction
                ? await deletedTransaction.getDebitAccountName()
                : deletedTransaction.debitAccount?.name;

        // Split purchase Transactions in the Inventory Book.
        if (originalQuantity) {
            const goodAccountTransactions = (
                await inventoryBook.listTransactions(`account:'${accountName}'`)
            ).getItems();
            for (const transaction of goodAccountTransactions) {
                const parentId = transaction.getProperty(PARENT_ID_PROP);
                if (parentId == transactionId) {
                    responses.push(await this.botService.uncheckAndTrash(transaction));
                }
            }
        }

        return responses.length > 0 ? responses : undefined;
    }

    protected async cascadeDeleteFinancialTransactions(
        financialBook: Book,
        remoteTransaction: bkper.Transaction | Transaction
    ): Promise<Transaction[] | undefined> {
        let responses: Transaction[] | undefined = undefined;

        const remoteId =
            remoteTransaction instanceof Transaction
                ? remoteTransaction.getId()
                : remoteTransaction.id;

        // COGS Transaction in the Financial Book.
        let transaction = (await financialBook.listTransactions(`remoteId:${remoteId}`)).getFirst();
        if (transaction) {
            if (transaction.isChecked()) {
                transaction = await transaction.uncheck();
            }
            responses = [];
            responses.push(await transaction.trash());
            return responses;
        }

        return responses;
    }

    protected async buildDeleteResults(responses: Transaction[], book?: Book): Promise<string[]> {
        const results: string[] = [];
        for (const response of responses) {
            const bookAnchor = book ? this.botService.buildBookAnchor(book) : undefined;
            results.push(
                bookAnchor
                    ? `${bookAnchor}: ${await this.buildDeleteResponse(response)}`
                    : await this.buildDeleteResponse(response)
            );
        }
        return results;
    }

    protected async buildDeleteResponse(transaction: Transaction): Promise<string> {
        return `DELETED: ${transaction.getDateFormatted()} ${transaction.getAmount()} ${await transaction.getCreditAccountName()} ${await transaction.getDebitAccountName()} ${transaction.getDescription()}`;
    }

    protected async deleteTransactionByRemoteId(
        book: Book,
        remoteId?: string
    ): Promise<Transaction | undefined> {
        let transaction = remoteId
            ? (await book.listTransactions(`remoteId:${remoteId}`)).getFirst()
            : undefined;
        if (transaction) {
            transaction = await this.botService.uncheckAndTrash(transaction);
            return transaction;
        }
        return undefined;
    }
}
