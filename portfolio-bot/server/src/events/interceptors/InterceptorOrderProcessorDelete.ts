import type { Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { CalculationModel } from '../CalculationModel.js';
import { BotService } from '../services/BotService.js';

export abstract class InterceptorOrderProcessorDelete {
    protected botService: BotService;

    constructor(context: AppContext) {
        this.botService = new BotService(context);
    }

    protected async cascadeDelete(
        book: Book | null,
        transaction: bkper.Transaction
    ): Promise<void> {
        if (!book) {
            return;
        }

        const baseBook = this.botService.getBaseBook(book);
        const deletions = [
            this.cascadeDeleteTransactions(book, transaction, ''),
            this.cascadeDeleteTransactions(book, transaction, 'mtm_'),
        ];
        if (baseBook) {
            deletions.push(this.cascadeDeleteTransactions(baseBook, transaction, 'fx_'));
        }

        const stockBook = this.botService.getStockBook(book)!;
        if (this.botService.getCalculationModel(stockBook) == CalculationModel.BOTH) {
            deletions.push(
                this.cascadeDeleteTransactions(book, transaction, 'hist_'),
                this.cascadeDeleteTransactions(book, transaction, 'mtm_hist_')
            );
            if (baseBook) {
                deletions.push(this.cascadeDeleteTransactions(baseBook, transaction, 'fx_hist_'));
            }
        }

        const results = await Promise.allSettled(deletions);
        for (const result of results) {
            if (result.status === 'rejected') {
                throw result.reason;
            }
        }
    }

    protected async cascadeDeleteTransactions(
        book: Book,
        remoteTransaction: bkper.Transaction,
        prefix: string
    ): Promise<void> {
        let transaction = (
            await book.listTransactions(`remoteId:${prefix}${remoteTransaction.id}`)
        ).getFirst();
        if (transaction) {
            if (transaction.isChecked()) {
                transaction = await transaction.uncheck();
            }
            await transaction.trash();
        }
    }

    protected async buildDeleteResponse(transaction: Transaction): Promise<string> {
        return `DELETED: ${transaction.getDateFormatted()} ${transaction.getAmount()} ${await transaction.getCreditAccountName()} ${await transaction.getDebitAccountName()} ${transaction.getDescription()}`;
    }

    protected async deleteTransaction(book: Book, remoteId: string): Promise<Transaction | null> {
        let transaction = (await book.listTransactions(`remoteId:${remoteId}`)).getFirst();
        if (transaction) {
            if (transaction.isChecked()) {
                transaction = await transaction.uncheck();
            }
            return transaction.trash();
        }
        return null;
    }

    protected async deleteOnStockBook(
        financialBook: Book,
        remoteId: string
    ): Promise<Transaction | null> {
        const stockBook = this.botService.getStockBook(financialBook)!;
        const deletedStockTransaction = await this.deleteTransaction(stockBook, remoteId);
        if (deletedStockTransaction) {
            await this.botService.flagStockAccountForRebuildIfNeeded(deletedStockTransaction);
            await this.cascadeDelete(financialBook, deletedStockTransaction.json());
        }
        return deletedStockTransaction;
    }
}
