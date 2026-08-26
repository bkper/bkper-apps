import { Account, AccountType, Amount, Transaction, type Book, type Group } from 'bkper-js';
import {
    DATE_PROP,
    EXC_ACCOUNT_PROP,
    EXC_AGGREGATE_PROP,
    EXC_AMOUNT_PROP,
    EXC_CODE_PROP,
    MAX_DECIMAL_PLACES,
    MTM_SUFFIX,
    OPEN_QUANTITY_PROP,
    PRICE_PROP,
    PURCHASE_EXC_RATE_PROP,
    REALIZED_EXC_SUFFIX,
    REALIZED_HIST_EXC_SUFFIX,
    REALIZED_HIST_SUFFIX,
    REALIZED_SUFFIX,
    SALE_EXC_RATE_PROP,
    UNREALIZED_EXC_SUFFIX,
    UNREALIZED_HIST_EXC_SUFFIX,
    UNREALIZED_HIST_SUFFIX,
    UNREALIZED_SUFFIX,
} from '../../../shared/constants.js';
import { optionalLookup } from '../../../shared/optional-lookup.js';
import { BotService } from '../bot-service.js';
import type { StockAccount } from '../stock-account.js';
import type { Summary } from '../summary.js';
import type { CalculateRealizedResultsProcessor } from './calculate-realized-results-processor.js';
import type { LiquidationLogEntry, PurchaseLogEntry } from './types.js';

export class CalculateRealizedResultsService {
    private readonly botService = new BotService();

    async checkAndRecordExchangeRates(
        baseBook: Book,
        financialBook: Book,
        saleTransactions: Transaction[],
        purchaseTransactions: Transaction[],
        processor: CalculateRealizedResultsProcessor
    ): Promise<void> {
        for (const saleTx of saleTransactions) {
            if (!saleTx.isChecked()) {
                await this.recordExcRateProp(
                    baseBook,
                    financialBook,
                    saleTx,
                    SALE_EXC_RATE_PROP,
                    processor
                );
            }
        }
        for (const purchaseTx of purchaseTransactions) {
            if (!purchaseTx.isChecked()) {
                await this.recordExcRateProp(
                    baseBook,
                    financialBook,
                    purchaseTx,
                    PURCHASE_EXC_RATE_PROP,
                    processor
                );
            }
        }
    }

    async recordExcRateProp(
        baseBook: Book,
        financialBook: Book,
        transaction: Transaction,
        exchangeRateProperty: string,
        processor: CalculateRealizedResultsProcessor
    ): Promise<void> {
        if (transaction.isChecked()) {
            return;
        }
        const excRateProp = transaction.getProperty(exchangeRateProperty);
        if (!excRateProp) {
            const excRate = await this.botService.getExcRate(
                baseBook,
                financialBook,
                transaction,
                exchangeRateProperty
            );
            transaction.setProperty(exchangeRateProperty, excRate?.toString());
        }
        const fwdExcRatePropKey = `fwd_${exchangeRateProperty}`;
        const fwdExcRateProp = transaction.getProperty(fwdExcRatePropKey);
        if (!fwdExcRateProp) {
            const excRate = await this.botService.getExcRate(
                baseBook,
                financialBook,
                transaction,
                exchangeRateProperty
            );
            const fwdExcRate = this.botService.getFwdExcRate(
                transaction,
                fwdExcRatePropKey,
                excRate
            );
            transaction.setProperty(fwdExcRatePropKey, fwdExcRate?.toString());
        }
        // Update transaction if necessary
        if (!excRateProp || !fwdExcRateProp) {
            // Store transaction to be updated
            processor.setStockBookTransactionToUpdate(transaction);
        }
    }

    async checkAndRecordInterestMtm(
        principalStockAccount: StockAccount,
        stockBook: Book,
        financialInterestAccount: Account,
        financialBook: Book,
        onDateIso: string,
        lastTransactionId: string,
        summary: Summary,
        processor: CalculateRealizedResultsProcessor
    ): Promise<void> {
        // Check principal account quantity on Stock Book
        const principalQuantity = await this.getAccountBalance(
            stockBook,
            principalStockAccount,
            stockBook.parseDate(onDateIso)
        );
        if (principalQuantity.eq(0)) {
            // Check interest account balance on Financial Book
            const interestBalance = await this.getAccountBalance(
                financialBook,
                financialInterestAccount,
                financialBook.parseDate(onDateIso)
            );
            if (!interestBalance.eq(0)) {
                // Record interest account MTM on financial book
                const financialUnrealizedAccount = await this.getUnrealizedAccount(
                    financialBook,
                    financialInterestAccount
                );
                this.recordInterestAccountMtm(
                    financialBook,
                    financialInterestAccount,
                    financialUnrealizedAccount,
                    interestBalance,
                    onDateIso,
                    lastTransactionId,
                    processor
                );
            }
        }
    }

    async checkLastTxDate(
        stockAccount: StockAccount,
        stockAccountSaleTransactions: Transaction[],
        stockAccountPurchaseTransactions: Transaction[]
    ): Promise<void> {
        const lastSaleTx =
            stockAccountSaleTransactions.length > 0
                ? stockAccountSaleTransactions[stockAccountSaleTransactions.length - 1]
                : null;
        const lastPurchaseTx =
            stockAccountPurchaseTransactions.length > 0
                ? stockAccountPurchaseTransactions[stockAccountPurchaseTransactions.length - 1]
                : null;

        let lastTxDateValue = lastSaleTx?.getDateValue() ?? null;
        let lastTxDate = lastSaleTx?.getDate() ?? null;
        if (
            (lastTxDateValue == null && lastPurchaseTx != null) ||
            (lastPurchaseTx != null &&
                Number(lastPurchaseTx.getDateValue()) > Number(lastTxDateValue))
        ) {
            lastTxDate = lastPurchaseTx.getDate() ?? null;
            lastTxDateValue = lastPurchaseTx.getDateValue() ?? null;
        }
        const stockAccountLastTxDateValue = stockAccount.getRealizedDateValue();
        if (
            lastTxDate != null &&
            lastTxDateValue != null &&
            (stockAccountLastTxDateValue == null || lastTxDateValue > stockAccountLastTxDateValue)
        ) {
            await stockAccount.setRealizedDate(lastTxDate).update();
        }
    }

    logLiquidation(transaction: Transaction, price: Amount, excRate: Amount): LiquidationLogEntry {
        return {
            id: transaction.getId()!,
            dt: transaction.getDate()!,
            qt: transaction.getAmount()!.toString(),
            pr: price.toString(),
            rt: excRate?.toString(),
        };
    }

    logPurchase(
        stockBook: Book,
        quantity: Amount,
        price: Amount,
        transaction: Transaction,
        excRate: Amount
    ): PurchaseLogEntry {
        return {
            qt: quantity.toString(),
            pr: price.toString(),
            dt: transaction.getProperty(DATE_PROP) || transaction.getDate()!,
            rt: excRate?.toString(),
        };
    }

    isShortSale(purchaseTransaction: Transaction, saleTransaction: Transaction): boolean {
        return this.botService.compareToFIFO(saleTransaction, purchaseTransaction) < 0;
    }

    async addRealizedResult(
        baseBook: Book,
        stockAccount: StockAccount,
        financialBook: Book,
        unrealizedAccount: Account,
        transaction: Transaction,
        gain: Amount,
        gainBaseNoFX: Amount,
        shouldRecordAsHistResult: boolean,
        processor: CalculateRealizedResultsProcessor
    ): Promise<void> {
        const gainDate = transaction.getProperty(DATE_PROP) || transaction.getDate();
        const isBaseBook = baseBook.getId() == financialBook.getId();

        if (gain.round(MAX_DECIMAL_PLACES).gt(0)) {
            // Realized account
            let realizedAccount: Account | null | undefined = null;

            // Try old XXX Realized Gain account
            if (!shouldRecordAsHistResult) {
                realizedAccount = await optionalLookup(() =>
                    financialBook.getAccount(`${stockAccount.getName()} Realized Gain`)
                );
            }
            // XXX Realized OR XXX Realized Hist
            if (!realizedAccount) {
                realizedAccount = await this.getRealizedAccount(
                    financialBook,
                    stockAccount,
                    shouldRecordAsHistResult
                );
            }

            const baseRemoteId = transaction.getId() || processor.getTemporaryId(transaction);
            const remoteId = shouldRecordAsHistResult ? `hist_${baseRemoteId}` : `${baseRemoteId}`;

            const description = shouldRecordAsHistResult ? '#stock_gain_hist' : '#stock_gain';

            const rrTransaction = new Transaction(financialBook)
                .addRemoteId(remoteId)
                .setDate(gainDate!)
                .setAmount(gain)
                .setDescription(description)
                .setProperty(
                    EXC_AMOUNT_PROP,
                    this.getStockGainLossTransactionExcAmountProp(
                        financialBook,
                        isBaseBook,
                        gainBaseNoFX
                    )
                )
                .setProperty(
                    EXC_CODE_PROP,
                    this.getStockGainLossTransactionExcCodeProp(financialBook, isBaseBook, baseBook)
                )
                .from(realizedAccount)
                .to(unrealizedAccount)
                .setChecked(true);

            // Store transaction to be created
            processor.setFinancialBookTransactionToCreate(rrTransaction);
        } else if (gain.round(MAX_DECIMAL_PLACES).lt(0)) {
            // Realized account
            let realizedAccount: Account | null | undefined = null;

            // Try old XXX Realized Loss account
            if (!shouldRecordAsHistResult) {
                realizedAccount = await optionalLookup(() =>
                    financialBook.getAccount(`${stockAccount.getName()} Realized Loss`)
                );
            }
            // XXX Realized OR XXX Realized Hist
            if (!realizedAccount) {
                realizedAccount = await this.getRealizedAccount(
                    financialBook,
                    stockAccount,
                    shouldRecordAsHistResult
                );
            }

            const baseRemoteId = transaction.getId() || processor.getTemporaryId(transaction);
            const remoteId = shouldRecordAsHistResult ? `hist_${baseRemoteId}` : `${baseRemoteId}`;

            const description = shouldRecordAsHistResult ? '#stock_loss_hist' : '#stock_loss';

            const rrTransaction = new Transaction(financialBook)
                .addRemoteId(remoteId)
                .setDate(gainDate!)
                .setAmount(gain)
                .setDescription(description)
                .setProperty(
                    EXC_AMOUNT_PROP,
                    this.getStockGainLossTransactionExcAmountProp(
                        financialBook,
                        isBaseBook,
                        gainBaseNoFX
                    )
                )
                .setProperty(
                    EXC_CODE_PROP,
                    this.getStockGainLossTransactionExcCodeProp(financialBook, isBaseBook, baseBook)
                )
                .from(unrealizedAccount)
                .to(realizedAccount)
                .setChecked(true);

            // Store transaction to be created
            processor.setFinancialBookTransactionToCreate(rrTransaction);
        }
    }

    getStockGainLossTransactionExcAmountProp(
        financialBook: Book,
        isBaseBook: boolean,
        gainBaseNoFX: Amount
    ): string | null {
        if (!this.botService.hasBaseBookDefined(financialBook)) {
            return null;
        }
        return isBaseBook ? null : gainBaseNoFX.abs().toString();
    }

    getStockGainLossTransactionExcCodeProp(
        financialBook: Book,
        isBaseBook: boolean,
        baseBook: Book
    ): string | null | undefined {
        if (!this.botService.hasBaseBookDefined(financialBook)) {
            return null;
        }
        return isBaseBook ? null : this.botService.getExcCode(baseBook);
    }

    async addMarkToMarket(
        stockBook: Book,
        transaction: Transaction,
        stockAccount: StockAccount,
        financialBook: Book,
        unrealizedAccount: Account,
        price: Amount,
        shouldRecordAsHistResult: boolean,
        processor: CalculateRealizedResultsProcessor
    ): Promise<void> {
        // Remote id
        const baseRemoteId = transaction.getId() || processor.getTemporaryId(transaction);
        const remoteId = shouldRecordAsHistResult
            ? `mtm_hist_${baseRemoteId}`
            : `mtm_${baseRemoteId}`;
        // Date
        const isoDate = transaction.getProperty(DATE_PROP) || transaction.getDate();
        const date = stockBook.parseDate(isoDate!);
        // Quantity amount
        const totalQuantity = await this.getAccountBalance(stockBook, stockAccount, date);
        // Accounts
        const instrumentAccount = (await financialBook.getAccount(stockAccount.getName()))!;
        const contraAccount = shouldRecordAsHistResult
            ? await this.botService.getSupportAccount(
                  financialBook,
                  stockAccount,
                  MTM_SUFFIX,
                  await this.botService.getTypeByAccountSuffix(financialBook, MTM_SUFFIX)
              )
            : instrumentAccount;
        // Financial amount
        const balance = await this.getAccountBalance(financialBook, instrumentAccount, date);
        const newBalance = totalQuantity.times(price);
        const amount = shouldRecordAsHistResult
            ? newBalance.minus(balance.plus(await processor.getHistMtmBalance(isoDate!)))
            : newBalance.minus(balance.plus(await processor.getMtmBalance(isoDate!)));

        if (amount.round(MAX_DECIMAL_PLACES).gt(0)) {
            const mtmTx = new Transaction(financialBook)
                .setDate(date)
                .setAmount(amount)
                .setDescription(`#mtm`)
                .setProperty(PRICE_PROP, financialBook.formatValue(price))
                .setProperty(
                    OPEN_QUANTITY_PROP,
                    totalQuantity.toFixed(stockBook.getFractionDigits())
                )
                .from(unrealizedAccount)
                .to(contraAccount)
                .addRemoteId(remoteId)
                .setChecked(true);
            processor.setFinancialBookTransactionToCreate(mtmTx);
        } else if (amount.round(MAX_DECIMAL_PLACES).lt(0)) {
            const mtmTx = new Transaction(financialBook)
                .setDate(date)
                .setAmount(amount)
                .setDescription(`#mtm`)
                .setProperty(PRICE_PROP, financialBook.formatValue(price))
                .setProperty(
                    OPEN_QUANTITY_PROP,
                    totalQuantity.toFixed(stockBook.getFractionDigits())
                )
                .from(contraAccount)
                .to(unrealizedAccount)
                .addRemoteId(remoteId)
                .setChecked(true);
            processor.setFinancialBookTransactionToCreate(mtmTx);
        }
    }

    recordInterestAccountMtm(
        book: Book,
        account: Account,
        urAccount: Account,
        amount: Amount,
        date: string,
        remoteId: string,
        processor: CalculateRealizedResultsProcessor
    ): void {
        if (amount.gt(0)) {
            const interestMtmTx = new Transaction(book)
                .setDate(date)
                .setAmount(amount)
                .setDescription(`#interest_mtm`)
                .from(account)
                .to(urAccount)
                .addRemoteId(`interestmtm_${remoteId}`)
                .setChecked(true);
            processor.setFinancialBookTransactionToCreate(interestMtmTx);
        } else if (amount.lt(0)) {
            const interestMtmTx = new Transaction(book)
                .setDate(date)
                .setAmount(amount.abs())
                .setDescription(`#interest_mtm`)
                .from(urAccount)
                .to(account)
                .addRemoteId(`interestmtm_${remoteId}`)
                .setChecked(true);
            processor.setFinancialBookTransactionToCreate(interestMtmTx);
        }
    }

    getLastTransactionId(sales: Transaction[], purchases: Transaction[]): string | null {
        const transactions = [...sales.concat(purchases)].sort(this.botService.compareToFIFO);
        if (transactions.length > 0) {
            const lastTransaction = transactions[transactions.length - 1];
            if (lastTransaction) {
                return lastTransaction.getId() ?? null;
            }
        }
        return null;
    }

    async getAccountBalance(
        book: Book,
        account: Account | StockAccount,
        date: Date
    ): Promise<Amount> {
        let balances = await book.getBalancesReport(
            `account:"${account.getName()}" on:${book.formatDate(date)}`
        );
        let containers = balances.getBalancesContainers();
        if (containers == null || containers.length == 0) {
            return new Amount(0);
        }
        return containers[0].getCumulativeBalance();
    }

    async addFxResult(
        stockAccount: StockAccount,
        stockExcCode: string,
        baseBook: Book,
        unrealizedFxAccount: Account,
        transaction: Transaction,
        gainBaseWithFx: Amount,
        gainBaseNoFx: Amount,
        summary: Summary,
        shouldRecordAsHistResult: boolean,
        processor: CalculateRealizedResultsProcessor
    ): Promise<void> {
        const gainDate = transaction.getProperty(DATE_PROP) || transaction.getDate();

        if (!gainBaseWithFx) {
            console.log('Missing gain with FX');
            return;
        }
        if (!gainBaseNoFx) {
            console.log('Missing gain no FX');
            return;
        }

        // Realized FX account
        const realizedFxAccountName = await this.getRealizedFxAccountName(
            baseBook,
            unrealizedFxAccount,
            stockExcCode,
            shouldRecordAsHistResult
        );
        const realizedFxAccount = await this.getRealizedFxAccount(baseBook, realizedFxAccountName);

        const fxGain = gainBaseWithFx.minus(gainBaseNoFx);

        const baseRemoteId = transaction.getId() || processor.getTemporaryId(transaction);
        const remoteId = shouldRecordAsHistResult
            ? `fx_hist_${baseRemoteId}`
            : `fx_${baseRemoteId}`;

        if (fxGain.round(MAX_DECIMAL_PLACES).gt(0)) {
            const description = shouldRecordAsHistResult ? '#exchange_gain_hist' : '#exchange_gain';

            const fxTransaction = new Transaction(baseBook)
                .addRemoteId(remoteId)
                .setDate(gainDate!)
                .setAmount(fxGain)
                .setDescription(description)
                .setProperty(EXC_AMOUNT_PROP, '0')
                .from(realizedFxAccount)
                .to(unrealizedFxAccount)
                .setChecked(true);

            // Store transaction to be created
            processor.setBaseBookTransactionToCreate(fxTransaction);
        } else if (fxGain.round(MAX_DECIMAL_PLACES).lt(0)) {
            const description = shouldRecordAsHistResult ? '#exchange_loss_hist' : '#exchange_loss';

            const fxTransaction = new Transaction(baseBook)
                .addRemoteId(remoteId)
                .setDate(gainDate!)
                .setAmount(fxGain)
                .setDescription(description)
                .setProperty(EXC_AMOUNT_PROP, '0')
                .from(unrealizedFxAccount)
                .to(realizedFxAccount)
                .setChecked(true);

            // Store transaction to be created
            processor.setBaseBookTransactionToCreate(fxTransaction);
        }
    }

    async getUnrealizedAccount(
        financialBook: Book,
        stockAccount: StockAccount | Account
    ): Promise<Account> {
        return this.botService.getSupportAccount(
            financialBook,
            stockAccount,
            UNREALIZED_SUFFIX,
            await this.botService.getTypeByAccountSuffix(financialBook, UNREALIZED_SUFFIX)
        );
    }

    async getUnrealizedHistAccount(
        financialBook: Book,
        stockAccount: StockAccount
    ): Promise<Account> {
        return this.botService.getSupportAccount(
            financialBook,
            stockAccount,
            UNREALIZED_HIST_SUFFIX,
            await this.botService.getTypeByAccountSuffix(financialBook, UNREALIZED_HIST_SUFFIX)
        );
    }

    async getUnrealizedFxBaseAccount(
        baseBook: Book,
        stockAccount: StockAccount,
        excAggregateProp: string | undefined
    ): Promise<Account> {
        if (excAggregateProp) {
            return this.botService.getSupportAccount(
                baseBook,
                stockAccount,
                UNREALIZED_SUFFIX,
                await this.botService.getTypeByAccountSuffix(baseBook, UNREALIZED_SUFFIX)
            );
        }
        return this.botService.getSupportAccount(
            baseBook,
            stockAccount,
            UNREALIZED_EXC_SUFFIX,
            await this.botService.getTypeByAccountSuffix(baseBook, UNREALIZED_EXC_SUFFIX)
        );
    }

    async getUnrealizedFxHistBaseAccount(
        baseBook: Book,
        stockAccount: StockAccount,
        excAggregateProp: string | undefined
    ): Promise<Account> {
        if (excAggregateProp) {
            return this.botService.getSupportAccount(
                baseBook,
                stockAccount,
                UNREALIZED_HIST_SUFFIX,
                await this.botService.getTypeByAccountSuffix(baseBook, UNREALIZED_HIST_SUFFIX)
            );
        }
        return this.botService.getSupportAccount(
            baseBook,
            stockAccount,
            UNREALIZED_HIST_EXC_SUFFIX,
            await this.botService.getTypeByAccountSuffix(baseBook, UNREALIZED_HIST_EXC_SUFFIX)
        );
    }

    async getRealizedAccount(
        financialBook: Book,
        stockAccount: StockAccount,
        historical: boolean
    ): Promise<Account> {
        const suffix = historical ? REALIZED_HIST_SUFFIX : REALIZED_SUFFIX;
        return this.botService.getSupportAccount(
            financialBook,
            stockAccount,
            suffix,
            AccountType.INCOMING
        );
    }

    async getRealizedFxAccountName(
        baseBook: Book,
        unrealizedFxAccount: Account,
        stockExcCode: string,
        historical: boolean
    ): Promise<string> {
        let excAccountProp = unrealizedFxAccount.getProperty(EXC_ACCOUNT_PROP);
        if (excAccountProp) {
            return excAccountProp;
        }
        const groups = await unrealizedFxAccount.getGroups();
        if (groups) {
            for (const group of groups) {
                excAccountProp = group.getProperty(EXC_ACCOUNT_PROP);
                if (excAccountProp) {
                    return excAccountProp;
                }
            }
        }
        const excAggregateProp = baseBook.getProperty(EXC_AGGREGATE_PROP);
        if (excAggregateProp) {
            return historical ? `Exchange_${stockExcCode} Hist` : `Exchange_${stockExcCode}`;
        }
        return `${unrealizedFxAccount.getName()!.replace(UNREALIZED_SUFFIX, REALIZED_SUFFIX)}`;
    }

    async getRealizedFxAccount(baseBook: Book, realizedFxAccountName: string): Promise<Account> {
        let account = await optionalLookup(() => baseBook.getAccount(realizedFxAccountName));
        if (!account) {
            account = new Account(baseBook).setName(realizedFxAccountName);
            const groups = await this.getRealizedFxAccountGroups(baseBook, realizedFxAccountName);
            for (const group of groups) {
                account.addGroup(group);
            }
            account.setType(await this.botService.getRealizedExcAccountType(baseBook));
            account = await account.create();
        }
        return account;
    }

    async getRealizedFxAccountGroups(
        baseBook: Book,
        realizedFxAccountName: string
    ): Promise<Set<Group>> {
        if (realizedFxAccountName.startsWith('Exchange_')) {
            // Exchange_XXX Hist
            if (realizedFxAccountName.endsWith(' Hist')) {
                return this.getExcAccountGroups(baseBook, true);
            }
            // Exchange_XXX
            return this.getExcAccountGroups(baseBook, false);
        } else if (realizedFxAccountName.endsWith(` ${REALIZED_EXC_SUFFIX}`)) {
            // XXX Realized EXC
            return this.botService.getGroupsByAccountSuffix(baseBook, REALIZED_EXC_SUFFIX);
        } else if (realizedFxAccountName.endsWith(` ${REALIZED_HIST_EXC_SUFFIX}`)) {
            // XXX Realized Hist EXC
            return this.botService.getGroupsByAccountSuffix(baseBook, REALIZED_HIST_EXC_SUFFIX);
        }
        return new Set<Group>();
    }

    async getExcAccountGroups(baseBook: Book, historical: boolean): Promise<Set<Group>> {
        let accountNames = new Set<string>();
        for (const account of await baseBook.getAccounts()) {
            const accountName = account.getName();
            if (!accountName) {
                continue;
            }
            if (historical) {
                if (accountName.startsWith('Exchange_') && accountName.endsWith(' Hist')) {
                    accountNames.add(accountName);
                }
            } else {
                if (accountName.startsWith('Exchange_')) {
                    accountNames.add(accountName);
                }
            }
        }
        let groups = new Set<Group>();
        if (accountNames.size === 0) {
            return groups;
        }
        for (const group of await baseBook.getGroups()) {
            const groupAccounts = await group.getAccounts();
            if (groupAccounts && groupAccounts.length > 0) {
                let shouldAddGroup = true;
                for (const accountName of accountNames) {
                    const account = await optionalLookup(() => baseBook.getAccount(accountName));
                    if (!account) {
                        continue;
                    }
                    if (!(await account.isInGroup(group))) {
                        shouldAddGroup = false;
                        break;
                    }
                }
                if (shouldAddGroup) {
                    groups.add(group);
                }
            }
        }
        return groups;
    }
}
