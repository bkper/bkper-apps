import { Account, AccountType, Amount, Transaction, type Book } from 'bkper-js';
import {
    ADDITIONAL_COSTS_CREDITS_QUERY_RANGE,
    COGS_ACCOUNT,
    CREDIT_NOTE_PROP,
    PURCHASE_CODE_PROP,
    PURCHASE_INVOICE_PROP,
    QUANTITY_SOLD_PROP,
    SALE_INVOICE_PROP,
} from '../../../shared/constants.js';
import { optionalLookup } from '../../../shared/optional-lookup.js';
import type { GoodAccount } from '../good-account.js';
import { getAccountQuery, getTimeRange, parseDate } from '../helper.js';
import type { CalculateCostOfSalesProcessor } from './calculate-cost-of-sales-processor.js';
import type { LiquidationLogEntry, PurchaseLogEntry } from './types.js';

export class CalculateCostOfSalesSupport {
    async storeLastCalcTxDate(
        goodAccount: GoodAccount,
        goodAccountSaleTransactions: Transaction[]
    ): Promise<void> {
        const length = goodAccountSaleTransactions.length;
        const lastSaleTx = length > 0 ? goodAccountSaleTransactions[length - 1] : null;

        const lastTxDateValue = lastSaleTx != null ? lastSaleTx.getDateValue() : null;
        const lastTxDate = lastSaleTx != null ? lastSaleTx.getDate() : null;

        const goodAccountLastTxDateValue = goodAccount.getCOGSCalculationDateValue();
        if (
            lastTxDateValue != null &&
            (goodAccountLastTxDateValue == null || lastTxDateValue > goodAccountLastTxDateValue)
        ) {
            await goodAccount.setCOGSCalculationDate(lastTxDate || '').update();
        }
    }

    async addCostOfSales(
        financialBook: Book,
        saleTransaction: Transaction,
        saleCost: Amount,
        processor: CalculateCostOfSalesProcessor
    ): Promise<void> {
        let costOfSalesAccount = await optionalLookup(() => financialBook.getAccount(COGS_ACCOUNT));
        if (!costOfSalesAccount) {
            costOfSalesAccount = await new Account(financialBook)
                .setName(COGS_ACCOUNT)
                .setType(AccountType.OUTGOING)
                .create();
        }

        const financialGoodAccountName = await saleTransaction.getCreditAccountName()!;
        const financialGoodAccount = await financialBook.getAccount(financialGoodAccountName);

        const remoteId = saleTransaction.getId()!;
        const description = `#COGS ${saleTransaction.getDescription()}`;

        // link COGS transaction in financial book to sale transaction in inventory book
        const costOfSaleTransaction = new Transaction(financialBook)
            .addRemoteId(remoteId)
            .setDate(saleTransaction.getDate()!)
            .setAmount(saleCost)
            .setDescription(description)
            .from(financialGoodAccount)
            .to(costOfSalesAccount)
            .setProperty(QUANTITY_SOLD_PROP, `${saleTransaction.getAmount()!.toNumber()}`)
            .setProperty(SALE_INVOICE_PROP, `${saleTransaction.getProperty(SALE_INVOICE_PROP)}`)
            .setChecked(true);

        // Store transaction to be created
        processor.setFinancialBookTransactionToCreate(costOfSaleTransaction);
    }

    async getAdditionalCostsAndCreditNotes(
        financialBook: Book,
        inventoryTransaction: Transaction
    ): Promise<{ additionalCosts: Amount; creditNotesAmount: Amount }> {
        // Calculate date range for searching related transactions
        const transactionDate = parseDate(inventoryTransaction.getDate()!);
        const timeRange = getTimeRange(ADDITIONAL_COSTS_CREDITS_QUERY_RANGE);

        // Set upper bound of date range
        const beforeDate = new Date(transactionDate.getTime() + timeRange);
        const beforeDateIsoString = financialBook.formatDate(beforeDate);

        // Set lower bound of date range
        const afterDate = new Date(transactionDate.getTime() - timeRange);
        const afterDateIsoString = financialBook.formatDate(afterDate);

        // Build query to get transactions for the inventory account within date range
        const inventoryAccountName = (await inventoryTransaction.getDebitAccount())!.getName()!;
        const query = getAccountQuery(
            inventoryAccountName,
            beforeDateIsoString,
            afterDateIsoString
        );

        // Get purchase code and account info for matching
        const purchaseCode = inventoryTransaction.getProperty(PURCHASE_CODE_PROP);
        const financialAccountId = (await financialBook.getAccount(inventoryAccountName))!.getId();

        // Initialize running totals
        let totalAdditionalCosts = new Amount(0);
        let totalCreditAmount = new Amount(0);

        // Process each transaction in the date range
        let cursor: string | undefined;
        do {
            const transactions = await financialBook.listTransactions(query, undefined, cursor);
            for (const tx of transactions.getItems()) {
                // Check for additional costs
                if (
                    tx.isChecked() &&
                    (await tx.getDebitAccount())!.getId() == financialAccountId &&
                    tx.getProperty(PURCHASE_CODE_PROP) == purchaseCode &&
                    tx.getProperty(PURCHASE_INVOICE_PROP) != undefined &&
                    tx.getProperty(PURCHASE_INVOICE_PROP) != purchaseCode
                ) {
                    totalAdditionalCosts = totalAdditionalCosts.plus(tx.getAmount()!);
                }
                // Check for credit notes
                else if (
                    tx.isChecked() &&
                    tx.getProperty(CREDIT_NOTE_PROP) != undefined &&
                    tx.getProperty(PURCHASE_CODE_PROP) == purchaseCode &&
                    (await tx.getCreditAccount())!.getId() == financialAccountId
                ) {
                    totalCreditAmount = totalCreditAmount.plus(tx.getAmount()!);
                }
            }
            cursor = transactions.getCursor();
        } while (cursor);

        return {
            additionalCosts: totalAdditionalCosts,
            creditNotesAmount: totalCreditAmount,
        };
    }

    getLiquidationLog(
        transaction: Transaction,
        costOfSalePerUnit: Amount,
        excRate?: Amount
    ): LiquidationLogEntry {
        return {
            id: transaction.getId()!,
            dt: transaction.getDate()!,
            qt: transaction.getAmount()!.toString(),
            uc: costOfSalePerUnit.toString(),
            rt: excRate?.toString() || '',
        };
    }

    getPurchaseLog(
        quantity: Amount,
        costOfSalePerUnit: Amount,
        transaction: Transaction,
        excRate?: Amount
    ): PurchaseLogEntry {
        return {
            id: transaction.getId()!,
            qt: quantity.toString(),
            uc: costOfSalePerUnit.toString(),
            rt: excRate?.toString() || '',
        };
    }
}
