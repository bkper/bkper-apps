import { Amount, Transaction, type Book } from 'bkper-js';
import {
    CREDIT_NOTE_PROP,
    EXC_CODE_PROP,
    LIQUIDATION_LOG_PROP,
    ORDER_PROP,
    ORIGINAL_QUANTITY_PROP,
    PARENT_ID_PROP as PARENT_ID,
    PURCHASE_CODE_PROP,
    PURCHASE_LOG_PROP,
    TOTAL_ADDITIONAL_COSTS_PROP as ADD_COSTS_PROP,
    TOTAL_COST_PROP,
} from '../../../shared/constants.js';
import { BotService } from '../bot-service.js';
import { GoodAccount } from '../good-account.js';
import { getAccountQuery } from '../helper.js';
import type { OperationContext } from '../operation-service.js';
import { ResetCostOfSalesService } from '../reset/reset-cost-of-sales-service.js';
import { Summary } from '../summary.js';
import { CalculateCostOfSalesProcessor } from './calculate-cost-of-sales-processor.js';
import { CalculateCostOfSalesSupport } from './calculate-cost-of-sales-support.js';
import type { PurchaseLogEntry } from './types.js';

export class CalculateCostOfSalesService {
    private readonly botService = new BotService();
    private readonly support = new CalculateCostOfSalesSupport();

    async execute(context: OperationContext, toDate?: string): Promise<Summary> {
        const inventoryBook = context.inventoryBook;
        if (!toDate) {
            toDate = inventoryBook.formatDate(new Date());
        }

        const goodAccount = new GoodAccount(context.inventoryAccount);

        const summary = new Summary(goodAccount.getId()!);

        if (goodAccount.needsRebuild()) {
            // Fire reset async
            await new ResetCostOfSalesService().execute(context);
            return summary.rebuild();
        }

        const goodExcCode = await goodAccount.getExchangeCode();
        let financialBook = this.botService.getFinancialBook(inventoryBook, goodExcCode);

        // Skip
        if (financialBook == null) {
            return summary;
        }
        financialBook = context.financialBook;

        const beforeDate = this.botService.getBeforeDateIsoString(inventoryBook, toDate);

        const query = getAccountQuery(goodAccount.getName()!, beforeDate);
        const transactions = await this.listTransactions(inventoryBook, query);

        let goodAccountSaleTransactions: Transaction[] = [];

        const goodAccountPurchaseTransactionsMap = new Map<string, Transaction>();
        const goodAccountCreditNoteTransactionsMap = new Map<string, Transaction>();

        let totalSalesQuantity = 0;
        let totalPurchasedQuantity = 0;

        for (const tx of transactions) {
            // Filter only unchecked
            if (tx.isChecked()) {
                continue;
            }
            if (await this.botService.isSale(tx)) {
                goodAccountSaleTransactions.push(tx);
                totalSalesQuantity += tx.getAmount()!.toNumber();
            }
            if (await this.botService.isPurchase(tx)) {
                goodAccountPurchaseTransactionsMap.set(tx.getProperty(PURCHASE_CODE_PROP)!, tx);
                totalPurchasedQuantity += tx.getAmount()!.toNumber();
            }
            if (await this.botService.isCreditNote(tx)) {
                goodAccountCreditNoteTransactionsMap.set(tx.getProperty(CREDIT_NOTE_PROP)!, tx);
                totalPurchasedQuantity -= tx.getAmount()!.toNumber();
            }
        }

        if (totalSalesQuantity == 0) {
            return summary;
        }

        // Total sales quantity cannot be greater than available quantity in inventory
        if (totalSalesQuantity > totalPurchasedQuantity) {
            return summary.salequantityError();
        }

        // Processor
        const processor = new CalculateCostOfSalesProcessor(inventoryBook, financialBook);

        // process credit notes before sales
        for (const [creditNote, creditNoteTx] of goodAccountCreditNoteTransactionsMap.entries()) {
            const purchaseCode = creditNoteTx.getProperty(PURCHASE_CODE_PROP)!;
            const purchaseTransaction = goodAccountPurchaseTransactionsMap.get(purchaseCode);
            if (purchaseTransaction) {
                const creditNoteQuantity = new Amount(creditNoteTx.getAmount()!.toNumber());
                const remainingQuantity = purchaseTransaction
                    .getAmount()!
                    .minus(creditNoteQuantity);

                if (remainingQuantity.toNumber() <= 0) {
                    return summary.creditNoteQuantityError(
                        creditNoteTx.getProperty(CREDIT_NOTE_PROP)!
                    );
                } else {
                    // split purchase transaction
                    const splittedPurchaseTransaction = new Transaction(inventoryBook)
                        .setDate(purchaseTransaction.getDate()!)
                        .setAmount(creditNoteQuantity)
                        .setCreditAccount(await purchaseTransaction.getCreditAccount())
                        .setDebitAccount(await purchaseTransaction.getDebitAccount())
                        .setDescription(purchaseTransaction.getDescription())
                        .setProperty(PARENT_ID, purchaseTransaction.getId())
                        .setProperty(PURCHASE_CODE_PROP, purchaseCode.toString())
                        .setProperty(CREDIT_NOTE_PROP, creditNote)
                        .addRemoteId(creditNote)
                        .setChecked(true);

                    // Store transaction to be created
                    processor.setInventoryBookTransactionToCreate(splittedPurchaseTransaction);

                    // update purchase transaction
                    purchaseTransaction.setAmount(remainingQuantity);
                    processor.setInventoryBookTransactionToUpdate(purchaseTransaction);
                    goodAccountPurchaseTransactionsMap.set(purchaseCode, purchaseTransaction);

                    // check credit note transaction
                    creditNoteTx.setChecked(true);
                    processor.setInventoryBookTransactionToUpdate(creditNoteTx);
                }
            }
        }

        goodAccountSaleTransactions = goodAccountSaleTransactions.sort(
            this.botService.compareToFIFO
        );
        const goodAccountPurchaseTransactions = Array.from(
            goodAccountPurchaseTransactionsMap.values()
        ).sort(this.botService.compareToFIFO);

        // Process sales
        for (const saleTransaction of goodAccountSaleTransactions) {
            if (goodAccountSaleTransactions.length > 0) {
                await this.processSale(
                    financialBook,
                    inventoryBook,
                    saleTransaction,
                    goodAccountPurchaseTransactions,
                    processor
                );
            }
            // Abort if any transaction is locked
            if (processor.hasLockedTransaction()) {
                return summary.lockError();
            }
        }

        // Fire batch operations
        await processor.fireBatchOperations();

        await this.support.storeLastCalcTxDate(goodAccount, goodAccountSaleTransactions);

        return summary.calculatingAsync();
    }

    private async processSale(
        financialBook: Book,
        inventoryBook: Book,
        saleTransaction: Transaction,
        purchaseTransactions: Transaction[],
        processor: CalculateCostOfSalesProcessor
    ): Promise<void> {
        // Log operation status
        console.log(
            `processing sale: ${saleTransaction.getId()} - ${saleTransaction.getDescription()}`
        );

        // Sale info: quantity, prices, exchange rates
        let soldQuantity = saleTransaction.getAmount()!;

        let saleCost = new Amount(0);
        const purchaseLogEntries: PurchaseLogEntry[] = [];

        for (const purchaseTransaction of purchaseTransactions) {
            if (purchaseTransaction.isChecked()) {
                // Only process unchecked purchases
                continue;
            }

            // Log operation status
            console.log(
                `processing purchase: ${purchaseTransaction.getId()} - ${purchaseTransaction.getDescription()}`
            );

            // Original purchase info: quantity and price
            const purchaseCode = purchaseTransaction.getProperty(PURCHASE_CODE_PROP)!;
            const originalQuantity = new Amount(
                purchaseTransaction.getProperty(ORIGINAL_QUANTITY_PROP)!
            );
            const transactionQuantity = purchaseTransaction.getAmount()!;
            const transactionCost = new Amount(purchaseTransaction.getProperty(TOTAL_COST_PROP)!);

            const creditNotesQuantity = originalQuantity.minus(transactionQuantity).toNumber();
            let additionalCosts = new Amount(0);
            let creditNotesAmount = new Amount(0);
            if (
                purchaseTransaction.getProperty(CREDIT_NOTE_PROP) == undefined &&
                purchaseTransaction.getProperty(ADD_COSTS_PROP) == undefined
            ) {
                // transaction hasn't been previously processed in FIFO execution. Get additional costs & credit notes to update purchase transaction
                ({ additionalCosts, creditNotesAmount } =
                    await this.support.getAdditionalCostsAndCreditNotes(
                        financialBook,
                        purchaseTransaction
                    ));
            }

            // Updated purchase costs
            const updatedCost = transactionCost.plus(additionalCosts).minus(creditNotesAmount);

            const costOfSalePerUnit = updatedCost.div(transactionQuantity);

            // Sold quantity is greater than or equal to purchase quantity
            if (soldQuantity.gte(transactionQuantity)) {
                // compute COGS
                saleCost = saleCost.plus(updatedCost);

                // update & check purchase transaction
                const liquidationLog = this.support.getLiquidationLog(
                    saleTransaction,
                    costOfSalePerUnit
                );
                purchaseTransaction
                    .setProperty(TOTAL_COST_PROP, updatedCost.toString())
                    .setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(liquidationLog))
                    .setProperty(ADD_COSTS_PROP, additionalCosts.toString())
                    .setProperty(
                        CREDIT_NOTE_PROP,
                        JSON.stringify({
                            quantity: creditNotesQuantity,
                            amount: creditNotesAmount.toNumber(),
                        })
                    )
                    .setChecked(true);

                // Store transaction to be updated
                processor.setInventoryBookTransactionToUpdate(purchaseTransaction);

                // store purchase log entry
                purchaseLogEntries.push(
                    this.support.getPurchaseLog(
                        transactionQuantity,
                        costOfSalePerUnit,
                        purchaseTransaction
                    )
                );

                // update sold quantity
                soldQuantity = soldQuantity.minus(transactionQuantity);
            } else {
                // Sold quantity is less than purchase quantity: split and update purchase transaction
                const remainingQuantity = transactionQuantity.minus(soldQuantity);
                const partialBuyQuantity = transactionQuantity.minus(remainingQuantity);
                const splittedCost = partialBuyQuantity.times(costOfSalePerUnit);
                const remainingCost = updatedCost.minus(splittedCost);

                // compute COGS
                saleCost = saleCost.plus(splittedCost);

                // update purchase transaction
                purchaseTransaction
                    .setAmount(remainingQuantity)
                    .setProperty(TOTAL_COST_PROP, remainingCost.toString())
                    .setProperty(ADD_COSTS_PROP, additionalCosts.toString())
                    .setProperty(
                        CREDIT_NOTE_PROP,
                        JSON.stringify({
                            quantity: creditNotesQuantity,
                            amount: creditNotesAmount.toNumber(),
                        })
                    );

                purchaseTransaction.setProperty(ADD_COSTS_PROP, additionalCosts.toString());

                purchaseTransaction.setProperty(
                    CREDIT_NOTE_PROP,
                    JSON.stringify({
                        quantity: creditNotesQuantity,
                        amount: creditNotesAmount.toNumber(),
                    })
                );

                // Store transaction to be updated
                processor.setInventoryBookTransactionToUpdate(purchaseTransaction);

                // create splitted purchase transaction
                const liquidationLog = this.support.getLiquidationLog(
                    saleTransaction,
                    costOfSalePerUnit
                );
                const splittedPurchaseTransaction = new Transaction(inventoryBook)
                    .setDate(purchaseTransaction.getDate()!)
                    .setAmount(partialBuyQuantity)
                    .setCreditAccount(await purchaseTransaction.getCreditAccount())
                    .setDebitAccount(await purchaseTransaction.getDebitAccount())
                    .setDescription(purchaseTransaction.getDescription())
                    .setProperty(EXC_CODE_PROP, purchaseTransaction.getProperty(EXC_CODE_PROP))
                    .setProperty(PARENT_ID, purchaseTransaction.getId())
                    .setProperty(PURCHASE_CODE_PROP, purchaseCode.toString())
                    .setProperty(TOTAL_COST_PROP, splittedCost.toString())
                    .setProperty(LIQUIDATION_LOG_PROP, JSON.stringify(liquidationLog))
                    .setProperty(ORDER_PROP, purchaseTransaction.getProperty(ORDER_PROP))
                    .addRemoteId(processor.generateId())
                    .setChecked(true);

                // Store transaction to be created
                processor.setInventoryBookTransactionToCreate(splittedPurchaseTransaction);

                // store purchase log entry
                purchaseLogEntries.push(
                    this.support.getPurchaseLog(
                        partialBuyQuantity,
                        costOfSalePerUnit,
                        purchaseTransaction
                    )
                );

                // update sold quantity
                soldQuantity = soldQuantity.minus(partialBuyQuantity);
            }
            // Break loop if sale is fully processed, otherwise proceed to next purchase
            if (soldQuantity.eq(0)) {
                break;
            }
        }

        // Sold quantity EQ zero: update & check sale transaction
        if (soldQuantity.round(inventoryBook.getFractionDigits()).eq(0)) {
            if (purchaseLogEntries.length > 0) {
                saleTransaction
                    .setProperty(TOTAL_COST_PROP, saleCost.toString())
                    .setProperty(PURCHASE_LOG_PROP, JSON.stringify(purchaseLogEntries))
                    .setChecked(true);
            }

            // Store transaction to be updated
            processor.setInventoryBookTransactionToUpdate(saleTransaction);
        }

        // post cost of sale transaction in financial book
        await this.support.addCostOfSales(financialBook, saleTransaction, saleCost, processor);
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
}
