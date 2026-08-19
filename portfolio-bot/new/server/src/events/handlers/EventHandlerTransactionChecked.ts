import { Account, AccountType, Amount, type Book, Group, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import {
    NEEDS_REBUILD_PROP,
    ORDER_PROP,
    ORIGINAL_AMOUNT_PROP,
    ORIGINAL_QUANTITY_PROP,
    PRICE_HIST_PROP,
    PURCHASE_PRICE_HIST_PROP,
    PURCHASE_PRICE_PROP,
    SALE_PRICE_HIST_PROP,
    SALE_PRICE_PROP,
    STOCK_BUY_ACCOUNT_NAME,
    STOCK_EXC_CODE_PROP,
    STOCK_SELL_ACCOUNT_NAME,
    TRADE_EXC_RATE_HIST_PROP,
    TRADE_EXC_RATE_PROP,
} from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import { InterceptorFlagRebuild } from '../interceptors/InterceptorFlagRebuild.js';
import type { EventResult } from '../types.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionChecked extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    protected override async intercept(baseBook: Book, event: bkper.Event): Promise<EventResult> {
        return new InterceptorFlagRebuild(this.context).intercept(baseBook, event);
    }

    protected async connectedTransactionFound(
        financialBook: Book,
        stockBook: Book,
        financialTransaction: bkper.Transaction,
        connectedTransaction: Transaction,
        stockExcCode: string
    ): Promise<string> {
        const stockAccount = await this.botService.getStockAccount(connectedTransaction);
        if (stockAccount && stockAccount.getProperty(NEEDS_REBUILD_PROP) == null) {
            await this.checkLastTxDate(stockAccount, financialTransaction);
        }

        const bookAnchor = super.buildBookAnchor(stockBook);
        const record = `${connectedTransaction.getDate()} ${connectedTransaction.getAmount()} ${await connectedTransaction.getCreditAccountName()} ${await connectedTransaction.getDebitAccountName()} ${connectedTransaction.getDescription()}`;
        return `FOUND: ${bookAnchor}: ${record}`;
    }

    protected async connectedTransactionNotFound(
        financialBook: Book,
        stockBook: Book,
        financialTransaction: bkper.Transaction,
        stockExcCode: string
    ): Promise<string | null> {
        const financialCreditAccount = financialTransaction.creditAccount!;
        const financialDebitAccount = financialTransaction.debitAccount!;
        const stockBookAnchor = super.buildBookAnchor(stockBook);

        const quantity = this.getQuantity(stockBook, financialTransaction);
        if (quantity == null || quantity.eq(0)) {
            return null;
        }

        const originalAmount = new Amount(financialTransaction.amount!);
        const price = originalAmount.div(quantity);

        let priceHist: Amount | null = null;
        let tradeExcRate: Amount | null = null;
        let tradeExcRateHist: Amount | null = null;

        const priceHistProperty = financialTransaction.properties?.[PRICE_HIST_PROP];
        if (priceHistProperty) {
            priceHist = new Amount(priceHistProperty).abs();
        }
        const tradeExcRateProperty = financialTransaction.properties?.[TRADE_EXC_RATE_PROP];
        if (tradeExcRateProperty) {
            tradeExcRate = new Amount(tradeExcRateProperty);
        }
        const tradeExcRateHistProperty =
            financialTransaction.properties?.[TRADE_EXC_RATE_HIST_PROP];
        if (tradeExcRateHistProperty) {
            tradeExcRateHist = new Amount(tradeExcRateHistProperty);
        }

        let stockAccount = await this.getConnectedStockAccount(
            financialBook,
            stockBook,
            financialCreditAccount
        );

        if (stockAccount && !stockAccount.isArchived()) {
            // Selling
            let stockSellAccount = await optionalLookup(() =>
                stockBook.getAccount(STOCK_SELL_ACCOUNT_NAME)
            );
            if (stockSellAccount == null) {
                stockSellAccount = await new Account(stockBook)
                    .setName(STOCK_SELL_ACCOUNT_NAME)
                    .setType(AccountType.OUTGOING)
                    .create();
            }

            const newTransaction = await new Transaction(stockBook)
                .setDate(financialTransaction.date!)
                .setAmount(quantity)
                .setCreditAccount(stockAccount)
                .setDebitAccount(stockSellAccount)
                .setDescription(financialTransaction.description!)
                .addRemoteId(financialTransaction.id!)
                .setProperty(SALE_PRICE_PROP, price.toString())
                .setProperty(SALE_PRICE_HIST_PROP, priceHist?.toString())
                .setProperty(TRADE_EXC_RATE_PROP, tradeExcRate?.toString())
                .setProperty(TRADE_EXC_RATE_HIST_PROP, tradeExcRateHist?.toString())
                .setProperty(ORDER_PROP, financialTransaction.properties?.[ORDER_PROP])
                .setProperty(ORIGINAL_QUANTITY_PROP, quantity.toString())
                .setProperty(ORIGINAL_AMOUNT_PROP, originalAmount.toString())
                .setProperty(STOCK_EXC_CODE_PROP, stockExcCode)
                .post();

            await this.checkLastTxDate(stockAccount, financialTransaction);

            const record = `${newTransaction.getDate()} ${newTransaction.getAmount()} ${stockAccount.getName()} ${stockSellAccount.getName()} ${newTransaction.getDescription()}`;
            return `SELL: ${stockBookAnchor}: ${record}`;
        }

        stockAccount = await this.getConnectedStockAccount(
            financialBook,
            stockBook,
            financialDebitAccount
        );
        if (stockAccount) {
            // Buying
            let stockBuyAccount = await optionalLookup(() =>
                stockBook.getAccount(STOCK_BUY_ACCOUNT_NAME)
            );
            if (stockBuyAccount == null) {
                stockBuyAccount = await new Account(stockBook)
                    .setName(STOCK_BUY_ACCOUNT_NAME)
                    .setType(AccountType.INCOMING)
                    .create();
            }

            const newTransaction = await new Transaction(stockBook)
                .setDate(financialTransaction.date!)
                .setAmount(quantity)
                .setCreditAccount(stockBuyAccount)
                .setDebitAccount(stockAccount)
                .setDescription(financialTransaction.description!)
                .addRemoteId(financialTransaction.id!)
                .setProperty(PURCHASE_PRICE_PROP, price.toString())
                .setProperty(PURCHASE_PRICE_HIST_PROP, priceHist?.toString())
                .setProperty(TRADE_EXC_RATE_PROP, tradeExcRate?.toString())
                .setProperty(TRADE_EXC_RATE_HIST_PROP, tradeExcRateHist?.toString())
                .setProperty(ORDER_PROP, financialTransaction.properties?.[ORDER_PROP])
                .setProperty(ORIGINAL_QUANTITY_PROP, quantity.toString())
                .setProperty(ORIGINAL_AMOUNT_PROP, originalAmount.toString())
                .setProperty(STOCK_EXC_CODE_PROP, stockExcCode)
                .post();

            await this.checkLastTxDate(stockAccount, financialTransaction);

            const record = `${newTransaction.getDate()} ${newTransaction.getAmount()} ${stockBuyAccount.getName()} ${stockAccount.getName()} ${newTransaction.getDescription()}`;
            return `BUY: ${stockBookAnchor}: ${record}`;
        }

        return null;
    }

    private async checkLastTxDate(
        stockAccount: Account,
        transaction: bkper.Transaction
    ): Promise<void> {
        const lastTransactionDate = this.botService.getRealizedDateValue(stockAccount);
        if (lastTransactionDate != null && transaction.dateValue! <= +lastTransactionDate) {
            await stockAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
        }
    }

    private async getConnectedStockAccount(
        financialBook: Book,
        stockBook: Book,
        financialAccount: bkper.Account
    ): Promise<Account | null> {
        const stockExchangeCode = this.botService.getStockExchangeCode(financialAccount);
        if (stockExchangeCode != null) {
            let stockAccount = await optionalLookup(() =>
                stockBook.getAccount(financialAccount.name)
            );
            if (stockAccount == null) {
                stockAccount = new Account(stockBook)
                    .setName(financialAccount.name!)
                    .setType(financialAccount.type as AccountType)
                    .setVisibleProperties(financialAccount.properties ?? {})
                    .setArchived(financialAccount.archived!);
                if (financialAccount.groups) {
                    for (const financialGroup of financialAccount.groups) {
                        if (financialGroup) {
                            let stockGroup = await optionalLookup(() =>
                                stockBook.getGroup(financialGroup.name)
                            );
                            const stockExcCode = financialGroup.properties?.[STOCK_EXC_CODE_PROP];
                            if (
                                stockGroup == null &&
                                stockExcCode != null &&
                                stockExcCode.trim() != ''
                            ) {
                                stockGroup = await new Group(stockBook)
                                    .setHidden(financialGroup.hidden!)
                                    .setName(financialGroup.name!)
                                    .setVisibleProperties(financialGroup.properties ?? {})
                                    .create();
                            }
                            stockAccount.addGroup(stockGroup!);
                        }
                    }
                }
                stockAccount = await stockAccount.create();
            }
            return stockAccount;
        }
        return null;
    }
}
