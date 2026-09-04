import { Amount, type Book, type Transaction } from 'bkper-js';
import {
    DATE_PROP,
    EXC_RATE_PROP,
    FWD_LIQUIDATION_PROP,
    FWD_LOG_PROP,
    FWD_PURCHASE_AMOUNT_PROP,
    FWD_PURCHASE_EXC_RATE_PROP,
    FWD_PURCHASE_LOG_PROP,
    FWD_PURCHASE_PRICE_PROP,
    FWD_SALE_AMOUNT_PROP,
    FWD_SALE_EXC_RATE_PROP,
    FWD_SALE_PRICE_PROP,
    FWD_TX_PROP,
    GAIN_AMOUNT_HIST_PROP,
    GAIN_AMOUNT_PROP,
    HIST_ORDER_PROP,
    HIST_QUANTITY_PROP,
    LIQUIDATION_LOG_PROP,
    ORDER_PROP,
    ORIGINAL_AMOUNT_PROP,
    ORIGINAL_QUANTITY_PROP,
    PURCHASE_AMOUNT_PROP,
    PURCHASE_EXC_RATE_PROP,
    PURCHASE_LOG_PROP,
    PURCHASE_PRICE_PROP,
    SALE_AMOUNT_PROP,
    SALE_DATE_PROP,
    SALE_EXC_RATE_PROP,
    SALE_PRICE_PROP,
    SHORT_SALE_PROP,
} from '../../../shared/constants.js';
import { BotService } from '../bot-service.js';
import type { OperationContext } from '../operation-service.js';
import { StockAccount } from '../stock-account.js';
import { Summary } from '../summary.js';
import { ResetRealizedResultsProcessor } from './reset-realized-results-processor.js';

export class ResetRealizedResultsService {
    private readonly botService = new BotService();

    async execute(context: OperationContext, full: boolean): Promise<Summary> {
        const stockBook = context.portfolioBook;
        const financialBook = context.financialBook;
        const baseBook = context.baseBook;

        const stockAccount = new StockAccount(context.portfolioAccount);

        // Summary
        const summary = new Summary();

        const query = this.botService.getAccountQuery(stockAccount, full);
        const transactions = await this.listTransactions(stockBook, query);

        // Processor
        const processor = new ResetRealizedResultsProcessor(stockBook, financialBook, baseBook);

        for (let tx of transactions) {
            // Log operation status
            console.log(`processing transaction: ${tx.getId()}`);

            if (tx.isChecked()) {
                tx.setChecked(false);
            }

            if (tx.getAgentId() == 'stock-bot') {
                // Trash fwd log
                if (tx.getProperty(FWD_TX_PROP)) {
                    // Store transaction to be trashed
                    processor.setStockBookTransactionToTrash(tx);
                    continue;
                }

                // Trash fwd liquidation
                if (tx.getProperty(FWD_LIQUIDATION_PROP)) {
                    // Trash forwarded result
                    let i = await this.listTransactions(
                        financialBook,
                        `remoteId:fwd_${tx.getId()}`
                    );
                    for (let fwdTx of i) {
                        if (fwdTx.isChecked()) {
                            fwdTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(fwdTx);
                    }
                    // Store transaction to be trashed
                    processor.setStockBookTransactionToTrash(tx);
                    continue;
                }

                // Trash transactions connected to liquidations
                if (this.isLiquidationTransaction(tx)) {
                    // RRs
                    let i = await this.listTransactions(financialBook, `remoteId:${tx.getId()}`);
                    for (let rrTx of i) {
                        if (rrTx.isChecked()) {
                            rrTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(rrTx);
                    }

                    // MTMs
                    i = await this.listTransactions(financialBook, `remoteId:mtm_${tx.getId()}`);
                    for (let mtmTx of i) {
                        if (mtmTx.isChecked()) {
                            mtmTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(mtmTx);
                    }

                    // Interest MTMs
                    i = await this.listTransactions(
                        financialBook,
                        `remoteId:interestmtm_${tx.getId()}`
                    );
                    for (let interestMtmTx of i) {
                        if (interestMtmTx.isChecked()) {
                            interestMtmTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(interestMtmTx);
                    }

                    // FXs
                    i = await this.listTransactions(baseBook, `remoteId:fx_${tx.getId()}`);
                    for (let fxTx of i) {
                        if (fxTx.isChecked()) {
                            fxTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setBaseBookTransactionToTrash(fxTx);
                    }
                }

                // Trash transactions connected to historical liquidations
                if (this.isHistLiquidationTransaction(tx)) {
                    // RRs
                    let i = await this.listTransactions(
                        financialBook,
                        `remoteId:hist_${tx.getId()}`
                    );
                    for (let rrTx of i) {
                        if (rrTx.isChecked()) {
                            rrTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(rrTx);
                    }

                    // MTMs
                    i = await this.listTransactions(
                        financialBook,
                        `remoteId:mtm_hist_${tx.getId()}`
                    );
                    for (let mtmTx of i) {
                        if (mtmTx.isChecked()) {
                            mtmTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setFinancialBookTransactionToTrash(mtmTx);
                    }

                    // FXs
                    i = await this.listTransactions(baseBook, `remoteId:fx_hist_${tx.getId()}`);
                    for (let fxTx of i) {
                        if (fxTx.isChecked()) {
                            fxTx.setChecked(false);
                        }
                        // Store transaction to be trashed
                        processor.setBaseBookTransactionToTrash(fxTx);
                    }
                }

                // Reset properties
                let originalAmountProp = tx.getProperty(ORIGINAL_AMOUNT_PROP);
                let originalQuantityProp = tx.getProperty(ORIGINAL_QUANTITY_PROP);

                if (full) {
                    tx.setProperty(ORDER_PROP, tx.getProperty(HIST_ORDER_PROP));
                    const originalDate = tx.getProperty(DATE_PROP);
                    if (originalDate) {
                        tx.setDate(originalDate);
                    }
                    const histQuantity = tx.getProperty(HIST_QUANTITY_PROP);
                    if (histQuantity) {
                        tx.setProperty(ORIGINAL_QUANTITY_PROP, histQuantity);
                        originalQuantityProp = histQuantity;
                    }
                    tx.deleteProperty(DATE_PROP)
                        .deleteProperty(HIST_ORDER_PROP)
                        .deleteProperty(HIST_QUANTITY_PROP)
                        .deleteProperty(FWD_PURCHASE_PRICE_PROP)
                        .deleteProperty(FWD_SALE_PRICE_PROP)
                        .deleteProperty(FWD_PURCHASE_EXC_RATE_PROP)
                        .deleteProperty(FWD_SALE_EXC_RATE_PROP)
                        .deleteProperty(FWD_LOG_PROP);
                }

                // Trash splitted transaction
                if (!originalQuantityProp) {
                    // Store transaction to be trashed
                    processor.setStockBookTransactionToTrash(tx);
                } else {
                    // Reset parent transaction

                    // Fix wrong negative prices from forwarded date error
                    if (tx.getProperty(FWD_SALE_PRICE_PROP)) {
                        tx.setProperty(
                            FWD_SALE_PRICE_PROP,
                            new Amount(tx.getProperty(FWD_SALE_PRICE_PROP)!).abs().toString()
                        );
                    }
                    if (tx.getProperty(FWD_PURCHASE_PRICE_PROP)) {
                        tx.setProperty(
                            FWD_PURCHASE_PRICE_PROP,
                            new Amount(tx.getProperty(FWD_PURCHASE_PRICE_PROP)!).abs().toString()
                        );
                    }
                    tx.deleteProperty(GAIN_AMOUNT_PROP)
                        .deleteProperty(GAIN_AMOUNT_HIST_PROP)
                        .deleteProperty(PURCHASE_AMOUNT_PROP)
                        .deleteProperty('gain_log')
                        .deleteProperty(SALE_AMOUNT_PROP)
                        .deleteProperty(SHORT_SALE_PROP)
                        .deleteProperty(EXC_RATE_PROP)
                        .deleteProperty(PURCHASE_EXC_RATE_PROP)
                        .deleteProperty(SALE_EXC_RATE_PROP)
                        .deleteProperty(FWD_PURCHASE_AMOUNT_PROP)
                        .deleteProperty(FWD_SALE_AMOUNT_PROP)
                        .deleteProperty(LIQUIDATION_LOG_PROP);

                    // Sales
                    if (await this.botService.isSale(tx)) {
                        let salePriceProp = tx.getProperty(SALE_PRICE_PROP);
                        // OLD way to find price
                        if (originalAmountProp && originalQuantityProp && !salePriceProp) {
                            let salePrice = new Amount(originalAmountProp).div(
                                new Amount(originalQuantityProp)
                            );
                            tx.setProperty(SALE_PRICE_PROP, salePrice.toString());
                        }
                        tx.deleteProperty(PURCHASE_LOG_PROP)
                            .deleteProperty(PURCHASE_PRICE_PROP)
                            .deleteProperty(FWD_PURCHASE_LOG_PROP)
                            .setAmount(originalQuantityProp);
                        // Store transaction to be updated
                        processor.setStockBookTransactionToUpdate(tx);
                        // Purchases
                    } else if (await this.botService.isPurchase(tx)) {
                        let purchasePriceProp = tx.getProperty(PURCHASE_PRICE_PROP);
                        // OLD way to find price
                        if (originalAmountProp && originalQuantityProp && !purchasePriceProp) {
                            let purchasePrice = new Amount(originalAmountProp).div(
                                new Amount(originalQuantityProp)
                            );
                            tx.setProperty(PURCHASE_PRICE_PROP, purchasePrice.toString());
                        }
                        tx.deleteProperty(SALE_DATE_PROP)
                            .deleteProperty(SALE_PRICE_PROP)
                            .deleteProperty(FWD_SALE_PRICE_PROP)
                            .deleteProperty(FWD_SALE_EXC_RATE_PROP)
                            .setAmount(originalQuantityProp);
                        // Store transaction to be updated
                        processor.setStockBookTransactionToUpdate(tx);
                    }
                }
            }
        }

        // Abort if any transaction is locked
        if (processor.hasLockedTransaction()) {
            return summary.lockError();
        }

        // Fire batch operations
        await processor.fireBatchOperations();

        // Update account
        stockAccount.clearNeedsRebuild();
        if (full) {
            stockAccount
                .deleteRealizedDate()
                .deleteForwardedDate()
                .deleteForwardedExcRate()
                .deleteForwardedPrice();
        }

        let forwardedDate = stockAccount.getForwardedDate();
        if (forwardedDate) {
            stockAccount.setRealizedDate(forwardedDate);
        } else {
            stockAccount.deleteRealizedDate();
        }

        await stockAccount.update();

        return summary.resetingAsync();
    }

    async executeSync(
        context: OperationContext,
        stockAccount: StockAccount,
        full: boolean,
        resetTransactions?: Transaction[]
    ): Promise<Summary> {
        const stockBook = context.portfolioBook;

        let transactions: Transaction[];
        if (resetTransactions) {
            transactions = resetTransactions;
        } else {
            transactions = await this.listTransactions(
                stockBook,
                this.botService.getAccountQuery(stockAccount, full)
            );
        }

        let stockAccountSaleTransactions: Transaction[] = [];
        let stockAccountPurchaseTransactions: Transaction[] = [];

        const financialBook = context.financialBook;
        const baseBook = context.baseBook;

        for (let tx of transactions) {
            // Log operation status
            console.log(`processing transaction: ${tx.getId()}`);

            if (tx.isChecked()) {
                tx = await tx.uncheck();
            }

            if (tx.getAgentId() == 'stock-bot') {
                // Trash fwd log
                if (tx.getProperty(FWD_TX_PROP)) {
                    await tx.trash();
                    continue;
                }

                // Trash fwd liquidation
                if (tx.getProperty(FWD_LIQUIDATION_PROP)) {
                    // Trash forwarded result
                    let i = await this.listTransactions(
                        financialBook,
                        `remoteId:fwd_${tx.getId()}`
                    );
                    for (let fwdTx of i) {
                        if (fwdTx.isChecked()) {
                            fwdTx = await fwdTx.uncheck();
                        }
                        await fwdTx.trash();
                    }
                    await tx.trash();
                    continue;
                }

                // Trash transactions connected to liquidations
                if (this.isLiquidationTransaction(tx)) {
                    // Trash RRs, MTMs and FXs
                    let i = await this.listTransactions(financialBook, `remoteId:${tx.getId()}`);
                    for (let rrTx of i) {
                        if (rrTx.isChecked()) {
                            rrTx = await rrTx.uncheck();
                        }
                        await rrTx.trash();
                    }
                    i = await this.listTransactions(financialBook, `remoteId:mtm_${tx.getId()}`);
                    for (let mtmTx of i) {
                        if (mtmTx.isChecked()) {
                            mtmTx = await mtmTx.uncheck();
                        }
                        await mtmTx.trash();
                    }
                    i = await this.listTransactions(
                        financialBook,
                        `remoteId:interestmtm_${tx.getId()}`
                    );
                    for (let interestMtmTx of i) {
                        if (interestMtmTx.isChecked()) {
                            interestMtmTx = await interestMtmTx.uncheck();
                        }
                        await interestMtmTx.trash();
                    }
                    i = await this.listTransactions(baseBook, `remoteId:fx_${tx.getId()}`);
                    for (let fxTx of i) {
                        if (fxTx.isChecked()) {
                            fxTx = await fxTx.uncheck();
                        }
                        await fxTx.trash();
                    }
                }

                // Trash transactions connected to historical liquidations
                if (this.isHistLiquidationTransaction(tx)) {
                    // Trash RRs, MTMs and FXs
                    let i = await this.listTransactions(
                        financialBook,
                        `remoteId:hist_${tx.getId()}`
                    );
                    for (let rrTx of i) {
                        if (rrTx.isChecked()) {
                            rrTx = await rrTx.uncheck();
                        }
                        await rrTx.trash();
                    }
                    i = await this.listTransactions(
                        financialBook,
                        `remoteId:mtm_hist_${tx.getId()}`
                    );
                    for (let mtmTx of i) {
                        if (mtmTx.isChecked()) {
                            mtmTx = await mtmTx.uncheck();
                        }
                        await mtmTx.trash();
                    }
                    i = await this.listTransactions(baseBook, `remoteId:fx_hist_${tx.getId()}`);
                    for (let fxTx of i) {
                        if (fxTx.isChecked()) {
                            fxTx = await fxTx.uncheck();
                        }
                        await fxTx.trash();
                    }
                }

                let originalAmountProp = tx.getProperty(ORIGINAL_AMOUNT_PROP);
                let originalQuantityProp = tx.getProperty(ORIGINAL_QUANTITY_PROP);

                if (full) {
                    tx.setProperty(ORDER_PROP, tx.getProperty(HIST_ORDER_PROP));
                    if (tx.getProperty(DATE_PROP)) {
                        tx.setDate(tx.getProperty(DATE_PROP)!);
                    }
                    const histQuantity = tx.getProperty(HIST_QUANTITY_PROP);
                    if (histQuantity) {
                        tx.setProperty(ORIGINAL_QUANTITY_PROP, histQuantity);
                        originalQuantityProp = histQuantity;
                    }
                    tx.deleteProperty(DATE_PROP)
                        .deleteProperty(HIST_ORDER_PROP)
                        .deleteProperty(HIST_QUANTITY_PROP)
                        .deleteProperty(FWD_PURCHASE_PRICE_PROP)
                        .deleteProperty(FWD_SALE_PRICE_PROP)
                        .deleteProperty(FWD_PURCHASE_EXC_RATE_PROP)
                        .deleteProperty(FWD_SALE_EXC_RATE_PROP)
                        .deleteProperty(FWD_LOG_PROP);
                }

                if (!originalQuantityProp) {
                    await tx.trash();
                } else {
                    // Fix wrong negative prices from forwarded date error
                    if (tx.getProperty(FWD_SALE_PRICE_PROP)) {
                        tx.setProperty(
                            FWD_SALE_PRICE_PROP,
                            new Amount(tx.getProperty(FWD_SALE_PRICE_PROP)!).abs().toString()
                        );
                    }
                    if (tx.getProperty(FWD_PURCHASE_PRICE_PROP)) {
                        tx.setProperty(
                            FWD_PURCHASE_PRICE_PROP,
                            new Amount(tx.getProperty(FWD_PURCHASE_PRICE_PROP)!).abs().toString()
                        );
                    }

                    tx.deleteProperty(GAIN_AMOUNT_PROP)
                        .deleteProperty(GAIN_AMOUNT_HIST_PROP)
                        .deleteProperty(PURCHASE_AMOUNT_PROP)
                        .deleteProperty('gain_log')
                        .deleteProperty(SALE_AMOUNT_PROP)
                        .deleteProperty(SHORT_SALE_PROP)
                        .deleteProperty(EXC_RATE_PROP)
                        .deleteProperty(PURCHASE_EXC_RATE_PROP)
                        .deleteProperty(SALE_EXC_RATE_PROP)
                        .deleteProperty(FWD_PURCHASE_AMOUNT_PROP)
                        .deleteProperty(FWD_SALE_AMOUNT_PROP)
                        .deleteProperty(LIQUIDATION_LOG_PROP);

                    if (await this.botService.isSale(tx)) {
                        let salePriceProp = tx.getProperty(SALE_PRICE_PROP);
                        // OLD way to find price
                        if (originalAmountProp && originalQuantityProp && !salePriceProp) {
                            let salePrice = new Amount(originalAmountProp).div(
                                new Amount(originalQuantityProp)
                            );
                            tx.setProperty(SALE_PRICE_PROP, salePrice.toString());
                        }
                        await tx
                            .deleteProperty(PURCHASE_LOG_PROP)
                            .deleteProperty(PURCHASE_PRICE_PROP)
                            .deleteProperty(FWD_PURCHASE_LOG_PROP)
                            .setAmount(originalQuantityProp)
                            .update();
                        stockAccountSaleTransactions.push(tx);
                    } else if (await this.botService.isPurchase(tx)) {
                        let purchasePriceProp = tx.getProperty(PURCHASE_PRICE_PROP);
                        // OLD way to find price
                        if (originalAmountProp && originalQuantityProp && !purchasePriceProp) {
                            let purchasePrice = new Amount(originalAmountProp).div(
                                new Amount(originalQuantityProp)
                            );
                            tx.setProperty(PURCHASE_PRICE_PROP, purchasePrice.toString());
                        }
                        await tx
                            .deleteProperty(SALE_DATE_PROP)
                            .deleteProperty(SALE_PRICE_PROP)
                            .deleteProperty(FWD_SALE_PRICE_PROP)
                            .deleteProperty(FWD_SALE_EXC_RATE_PROP)
                            .setAmount(originalQuantityProp)
                            .update();
                        stockAccountPurchaseTransactions.push(tx);
                    }
                }
            }
        }

        stockAccount.clearNeedsRebuild();

        if (full) {
            stockAccount
                .deleteRealizedDate()
                .deleteForwardedDate()
                .deleteForwardedExcRate()
                .deleteForwardedPrice();
        }

        let forwardedDate = stockAccount.getForwardedDate();
        if (forwardedDate) {
            stockAccount.setRealizedDate(forwardedDate);
        } else {
            stockAccount.deleteRealizedDate();
        }

        await stockAccount.update();

        return new Summary().done();
    }

    private async listTransactions(book: Book, query: string): Promise<Transaction[]> {
        const transactions: Transaction[] = [];
        let cursor: string | undefined;
        do {
            const page = await book.listTransactions(query, undefined, cursor);
            transactions.push(...page.getItems());
            cursor = page.getCursor();
        } while (cursor);
        return transactions;
    }

    private isLiquidationTransaction(transaction: Transaction): boolean {
        return transaction.getProperty(GAIN_AMOUNT_PROP) ? true : false;
    }

    private isHistLiquidationTransaction(transaction: Transaction): boolean {
        return transaction.getProperty(GAIN_AMOUNT_HIST_PROP) ? true : false;
    }
}
