import { Account, AccountType, Amount, type Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import {
    COST_BASE_PROP,
    COST_HIST_BASE_PROP,
    COST_HIST_PROP,
    FEES_PROP,
    INSTRUMENT_PROP,
    INTEREST_PROP,
    ORDER_PROP,
    PRICE_HIST_PROP,
    PRICE_PROP,
    QUANTITY_PROP,
    SETTLEMENT_DATE,
    STOCK_FEES_ACCOUNT_PROP,
    TRADE_DATE_PROP,
    TRADE_EXC_RATE_HIST_PROP,
    TRADE_EXC_RATE_PROP,
} from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import { CalculationModel } from '../CalculationModel.js';
import { BotService } from '../services/BotService.js';
import type { EventResult } from '../types.js';

export class InterceptorOrderProcessor {
    private botService: BotService;

    constructor(context: AppContext) {
        this.botService = new BotService(context);
    }

    async intercept(baseBook: Book, event: bkper.Event): Promise<EventResult> {
        if (event.agent!.id == 'exchange-bot') {
            return { result: false };
        }

        if (this.botService.isStockBook(baseBook)) {
            return { result: false };
        }

        const operation = event.data!.object as bkper.TransactionOperation;
        const transactionPayload = operation.transaction!;

        if (!transactionPayload.posted) {
            return { result: false };
        }

        const quantity = this.getQuantity(baseBook, transactionPayload);
        if (quantity == null) {
            return { result: false };
        }
        if (quantity.eq(0)) {
            throw 'Quantity must not be zero';
        }

        if (this.isPurchase(baseBook, transactionPayload)) {
            return this.processPurchase(baseBook, transactionPayload);
        }

        if (this.isSale(baseBook, transactionPayload)) {
            return this.processSale(baseBook, transactionPayload);
        }

        return { result: false };
    }

    protected async processSale(
        baseBook: Book,
        transactionPayload: bkper.Transaction
    ): Promise<EventResult> {
        const stockBook = this.botService.getStockBook(baseBook)!;
        const model = this.botService.getCalculationModel(stockBook);
        const exchangeAccount = this.getExchangeAccountOnSale(baseBook, transactionPayload);
        const responses: Array<string | null> = await Promise.all([
            this.postFees(baseBook, exchangeAccount, transactionPayload),
            this.postInterestOnSale(baseBook, exchangeAccount, transactionPayload),
            this.postInstrumentTradeOnSale(baseBook, exchangeAccount, transactionPayload, model),
        ]);
        return {
            result: responses.filter(
                (response): response is string => response != null && typeof response === 'string'
            ),
        };
    }

    protected async processPurchase(
        baseBook: Book,
        transactionPayload: bkper.Transaction
    ): Promise<EventResult> {
        const stockBook = this.botService.getStockBook(baseBook)!;
        const model = this.botService.getCalculationModel(stockBook);
        const exchangeAccount = this.getExchangeAccountOnPurchase(baseBook, transactionPayload);
        const responses: Array<string | null> = await Promise.all([
            this.postFees(baseBook, exchangeAccount, transactionPayload),
            this.postInterestOnPurchase(baseBook, exchangeAccount, transactionPayload),
            this.postInstrumentTradeOnPurchase(
                baseBook,
                exchangeAccount,
                transactionPayload,
                model
            ),
        ]);
        return {
            result: responses.filter(
                (response): response is string => response != null && typeof response === 'string'
            ),
        };
    }

    protected isPurchase(baseBook: Book, transactionPayload: bkper.Transaction): boolean {
        if (this.getInstrument(transactionPayload) == null) {
            return false;
        }

        if (this.getTradeDate(transactionPayload) == null) {
            return false;
        }

        const exchangeAccount = transactionPayload.debitAccount!;
        return this.getFeesAccountName(exchangeAccount) != null;
    }

    protected isSale(baseBook: Book, transactionPayload: bkper.Transaction): boolean {
        if (this.getInstrument(transactionPayload) == null) {
            return false;
        }

        if (this.getTradeDate(transactionPayload) == null) {
            return false;
        }

        const exchangeAccount = transactionPayload.creditAccount!;
        return this.getFeesAccountName(exchangeAccount) != null;
    }

    private getExchangeAccountOnSale(
        baseBook: Book,
        transactionPayload: bkper.Transaction
    ): bkper.Account {
        return transactionPayload.creditAccount!;
    }

    private getExchangeAccountOnPurchase(
        baseBook: Book,
        transactionPayload: bkper.Transaction
    ): bkper.Account {
        return transactionPayload.debitAccount!;
    }

    protected async getInstrumentAccount(
        baseBook: Book,
        transactionPayload: bkper.Transaction
    ): Promise<Account> {
        const instrument = this.getInstrument(transactionPayload)!;
        let instrumentAccount = await optionalLookup(() => baseBook.getAccount(instrument));
        if (instrumentAccount == null) {
            instrumentAccount = await new Account(baseBook)
                .setName(instrument)
                .setType(AccountType.ASSET)
                .create();
        }
        return instrumentAccount;
    }

    protected getQuantity(book: Book, transactionPayload: bkper.Transaction): Amount | null {
        const quantityProperty = transactionPayload.properties?.[QUANTITY_PROP];
        if (quantityProperty == null) {
            return null;
        }
        return book.parseValue(quantityProperty) ?? null;
    }

    protected getInstrument(transactionPayload: bkper.Transaction): string | null {
        return transactionPayload.properties?.[INSTRUMENT_PROP] ?? null;
    }

    protected getTradeDate(transactionPayload: bkper.Transaction): string | null {
        return transactionPayload.properties?.[TRADE_DATE_PROP] ?? null;
    }

    protected getOrder(book: Book, transactionPayload: bkper.Transaction): string | null {
        const orderProperty = transactionPayload.properties?.[ORDER_PROP];
        if (orderProperty == null) {
            return null;
        }
        const orderAmount = book.parseValue(orderProperty);
        if (orderAmount == null) {
            return null;
        }
        return orderAmount.round(0).toString();
    }

    protected getFees(book: Book, transactionPayload: bkper.Transaction): Amount {
        const feesProperty = transactionPayload.properties?.[FEES_PROP];
        if (feesProperty == null) {
            return new Amount(0);
        }
        return book.parseValue(feesProperty) ?? new Amount(0);
    }

    protected getInterest(book: Book, transactionPayload: bkper.Transaction): Amount {
        const interestProperty = transactionPayload.properties?.[INTEREST_PROP];
        if (interestProperty == null) {
            return new Amount(0);
        }
        return book.parseValue(interestProperty) ?? new Amount(0);
    }

    protected getFeesAccountName(exchangeAccount: bkper.Account): string | null {
        return exchangeAccount.properties?.[STOCK_FEES_ACCOUNT_PROP] ?? null;
    }

    protected async getFeesAccount(baseBook: Book, feesAccountName: string): Promise<Account> {
        let feesAccount = await optionalLookup(() => baseBook.getAccount(feesAccountName));
        if (feesAccount == null) {
            feesAccount = await new Account(baseBook)
                .setName(feesAccountName)
                .setType(AccountType.OUTGOING)
                .create();
        }
        return feesAccount;
    }

    private async getInterestAccount(instrument: string, baseBook: Book): Promise<Account> {
        const interestAccountName = `${instrument} Interest`;
        let interestAccount = await optionalLookup(() => baseBook.getAccount(interestAccountName));
        if (interestAccount == null) {
            interestAccount = await new Account(baseBook)
                .setName(interestAccountName)
                .setType(AccountType.ASSET)
                .create();
        }
        return interestAccount;
    }

    protected async postFees(
        baseBook: Book,
        exchangeAccount: bkper.Account,
        transactionPayload: bkper.Transaction
    ): Promise<string | null> {
        const fees = this.getFees(baseBook, transactionPayload);
        if (!fees.eq(0)) {
            const tradeDate = this.getTradeDate(transactionPayload)!;
            const feesAccountName = this.getFeesAccountName(exchangeAccount)!;
            const feesAccount = await this.getFeesAccount(baseBook, feesAccountName);
            const transaction = await new Transaction(baseBook)
                .setAmount(fees)
                .from(exchangeAccount)
                .to(feesAccount)
                .setDescription(transactionPayload.description!)
                .setDate(tradeDate)
                .addRemoteId(`${FEES_PROP}_${transactionPayload.id}`)
                .post();

            return `${transaction.getDate()} ${transaction.getAmount()} ${await transaction.getCreditAccountName()} ${await transaction.getDebitAccountName()} ${transaction.getDescription()}`;
        }
        return null;
    }

    protected async postInterestOnPurchase(
        baseBook: Book,
        exchangeAccount: bkper.Account,
        transactionPayload: bkper.Transaction
    ): Promise<string | null> {
        const instrument = this.getInstrument(transactionPayload)!;
        const interest = this.getInterest(baseBook, transactionPayload);
        if (!interest.eq(0)) {
            const tradeDate = this.getTradeDate(transactionPayload)!;
            const interestAccount = await this.getInterestAccount(instrument, baseBook);
            const transaction = await new Transaction(baseBook)
                .setAmount(interest)
                .from(exchangeAccount)
                .to(interestAccount)
                .setDescription(transactionPayload.description!)
                .setDate(tradeDate)
                .addRemoteId(`${INTEREST_PROP}_${transactionPayload.id}`)
                .post();
            return `${transaction.getDate()} ${transaction.getAmount()} ${await transaction.getCreditAccountName()} ${await transaction.getDebitAccountName()} ${transaction.getDescription()}`;
        }
        return null;
    }

    protected async postInterestOnSale(
        baseBook: Book,
        exchangeAccount: bkper.Account,
        transactionPayload: bkper.Transaction
    ): Promise<string | null> {
        const instrument = this.getInstrument(transactionPayload)!;
        const interest = this.getInterest(baseBook, transactionPayload);
        if (!interest.eq(0)) {
            const interestAccount = await this.getInterestAccount(instrument, baseBook);
            const tradeDate = this.getTradeDate(transactionPayload)!;
            const transaction = await new Transaction(baseBook)
                .setAmount(interest)
                .from(interestAccount)
                .to(exchangeAccount)
                .setDescription(transactionPayload.description!)
                .setDate(tradeDate)
                .addRemoteId(`${INTEREST_PROP}_${transactionPayload.id}`)
                .post();
            return `${transaction.getDate()} ${transaction.getAmount()} ${await transaction.getCreditAccountName()} ${await transaction.getDebitAccountName()} ${transaction.getDescription()}`;
        }
        return null;
    }

    protected async postInstrumentTradeOnPurchase(
        baseBook: Book,
        exchangeAccount: bkper.Account,
        transactionPayload: bkper.Transaction,
        model: CalculationModel
    ): Promise<string> {
        const instrumentAccount = await this.getInstrumentAccount(baseBook, transactionPayload);
        const quantity = this.getQuantity(baseBook, transactionPayload)!;
        const fees = this.getFees(baseBook, transactionPayload);
        const order = this.getOrder(baseBook, transactionPayload);
        const interest = this.getInterest(baseBook, transactionPayload);
        const tradeDate = this.getTradeDate(transactionPayload)!;
        const amount = new Amount(transactionPayload.amount!).minus(interest).minus(fees);
        const price = amount.div(quantity);
        let transaction = new Transaction(baseBook)
            .setAmount(amount)
            .from(exchangeAccount)
            .to(instrumentAccount)
            .setDescription(transactionPayload.description!)
            .setDate(tradeDate)
            .setProperty(QUANTITY_PROP, quantity.toString())
            .setProperty(PRICE_PROP, price.toString())
            .setProperty(ORDER_PROP, order)
            .setProperty(SETTLEMENT_DATE, transactionPayload.date)
            .setProperty(FEES_PROP, fees.toString())
            .setProperty(INTEREST_PROP, interest.toString())
            .addRemoteId(`${INSTRUMENT_PROP}_${transactionPayload.id}`);

        const tradeExcRate = this.getTradeExcRate(transactionPayload, amount);
        if (tradeExcRate) {
            transaction.setProperty(TRADE_EXC_RATE_PROP, tradeExcRate.toString());
        }
        if (model === CalculationModel.BOTH) {
            const priceHist = this.getPurchasePriceHist(
                transactionPayload,
                interest,
                fees,
                quantity
            );
            if (priceHist && !priceHist.eq(0)) {
                transaction.setProperty(PRICE_HIST_PROP, priceHist.toString());
            }
            const tradeExcRateHist = this.getTradeExcRateHist(transactionPayload);
            if (tradeExcRateHist) {
                transaction.setProperty(TRADE_EXC_RATE_HIST_PROP, tradeExcRateHist.toString());
            }
        }
        transaction = await transaction.post();
        return `${transaction.getDate()} ${transaction.getAmount()} ${await transaction.getCreditAccountName()} ${await transaction.getDebitAccountName()} ${transaction.getDescription()}`;
    }

    private getPurchasePriceHist(
        transactionPayload: bkper.Transaction,
        interest: Amount,
        fees: Amount,
        quantity: Amount
    ): Amount | null {
        const costHistProperty = transactionPayload.properties?.[COST_HIST_PROP];
        if (costHistProperty) {
            const costHist = new Amount(costHistProperty).abs();
            const purchaseAmountHist = costHist.minus(interest).minus(fees);
            return purchaseAmountHist.div(quantity);
        }
        return null;
    }

    private getTradeExcRate(transactionPayload: bkper.Transaction, cost: Amount): Amount | null {
        const costBaseProperty = transactionPayload.properties?.[COST_BASE_PROP];
        if (costBaseProperty) {
            const costBase = new Amount(costBaseProperty).abs();
            if (!cost.eq(0)) {
                return costBase.div(cost);
            }
        }
        return null;
    }

    private getTradeExcRateHist(transactionPayload: bkper.Transaction): Amount | null {
        const costHistProperty = transactionPayload.properties?.[COST_HIST_PROP];
        if (costHistProperty) {
            const costHist = new Amount(costHistProperty).abs();
            const costHistBaseProperty = transactionPayload.properties?.[COST_HIST_BASE_PROP];
            if (costHistBaseProperty) {
                const costHistBase = new Amount(costHistBaseProperty).abs();
                if (!costHist.eq(0)) {
                    return costHistBase.div(costHist);
                }
            }
        }
        return null;
    }

    protected async postInstrumentTradeOnSale(
        baseBook: Book,
        exchangeAccount: bkper.Account,
        transactionPayload: bkper.Transaction,
        model: CalculationModel
    ): Promise<string> {
        const instrumentAccount = await this.getInstrumentAccount(baseBook, transactionPayload);
        const quantity = this.getQuantity(baseBook, transactionPayload)!;
        const fees = this.getFees(baseBook, transactionPayload);
        const order = this.getOrder(baseBook, transactionPayload);
        const interest = this.getInterest(baseBook, transactionPayload);
        const tradeDate = this.getTradeDate(transactionPayload)!;
        const amount = new Amount(transactionPayload.amount!).minus(interest).plus(fees);
        const price = amount.div(quantity);
        let transaction = new Transaction(baseBook)
            .setAmount(amount)
            .from(instrumentAccount)
            .to(exchangeAccount)
            .setDescription(transactionPayload.description!)
            .setDate(tradeDate)
            .setProperty(QUANTITY_PROP, quantity.toString())
            .setProperty(PRICE_PROP, price.toString())
            .setProperty(ORDER_PROP, order)
            .setProperty(SETTLEMENT_DATE, transactionPayload.date)
            .setProperty(FEES_PROP, fees.toString())
            .setProperty(INTEREST_PROP, interest.toString())
            .addRemoteId(`${INSTRUMENT_PROP}_${transactionPayload.id}`);

        const tradeExcRate = this.getTradeExcRate(transactionPayload, amount);
        if (tradeExcRate) {
            transaction.setProperty(TRADE_EXC_RATE_PROP, tradeExcRate.toString());
        }
        if (model === CalculationModel.BOTH) {
            const priceHist = this.getSalePriceHist(transactionPayload, interest, fees, quantity);
            if (priceHist && !priceHist.eq(0)) {
                transaction.setProperty(PRICE_HIST_PROP, priceHist.toString());
            }
            const tradeExcRateHist = this.getTradeExcRateHist(transactionPayload);
            if (tradeExcRateHist) {
                transaction.setProperty(TRADE_EXC_RATE_HIST_PROP, tradeExcRateHist.toString());
            }
        }
        transaction = await transaction.post();
        return `${transaction.getDate()} ${transaction.getAmount()} ${await transaction.getCreditAccountName()} ${await transaction.getDebitAccountName()} ${transaction.getDescription()}`;
    }

    private getSalePriceHist(
        transactionPayload: bkper.Transaction,
        interest: Amount,
        fees: Amount,
        quantity: Amount
    ): Amount | null {
        const costHistProperty = transactionPayload.properties?.[COST_HIST_PROP];
        if (costHistProperty) {
            const costHist = new Amount(costHistProperty).abs();
            const saleAmountHist = costHist.minus(interest).plus(fees);
            return saleAmountHist.div(quantity);
        }
        return null;
    }
}
