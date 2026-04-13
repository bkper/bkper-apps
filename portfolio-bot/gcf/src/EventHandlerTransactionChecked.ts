import { Account, AccountType, Amount, Book, Group, Transaction } from "bkper-js";
import { Result } from "./index.js";
import * as constants from "./constants.js";
import { EventHandlerTransaction } from "./EventHandlerTransaction.js";
import { InterceptorFlagRebuild } from "./InterceptorFlagRebuild.js";
import { AppContext } from "./AppContext.js";

export class EventHandlerTransactionChecked extends EventHandlerTransaction {
  constructor(context: AppContext) {
    super(context);
  }

  protected getTransactionQuery(transaction: bkper.Transaction): string {
    return `remoteId:${transaction.id}`;
  }

  async intercept(baseBook: Book, event: bkper.Event): Promise<Result> {
    let response = await new InterceptorFlagRebuild(this.context).intercept(baseBook, event);
    return response;
  }

  protected async connectedTransactionFound(financialBook: Book, stockBook: Book, financialTransaction: bkper.Transaction, connectedTransaction: Transaction, stockExcCode: string): Promise<string> {
    let bookAnchor = super.buildBookAnchor(stockBook);
    let record = `${connectedTransaction.getDate()} ${connectedTransaction.getAmount()} ${await connectedTransaction.getCreditAccountName()} ${await connectedTransaction.getDebitAccountName()} ${connectedTransaction.getDescription()}`;
    return `FOUND: ${bookAnchor}: ${record}`;
  }

  protected async connectedTransactionNotFound(financialBook: Book, stockBook: Book, financialTransaction: bkper.Transaction, stockExcCode: string): Promise<string> {

    let financialCreditAccount = financialTransaction.creditAccount;
    let financialDebitAccount = financialTransaction.debitAccount;
    let stockBookAnchor = super.buildBookAnchor(stockBook);

    let quantity = this.getQuantity(stockBook, financialTransaction);
    if (quantity == null || quantity.eq(0)) {
      return null;
    }

    const originalAmount = new Amount(financialTransaction.amount);
    const price = originalAmount.div(quantity);

    let priceHist: Amount | null = null;
    let tradeExcRate: Amount | null = null;
    let tradeExcRateHist: Amount | null = null;

    const priceHistProp = financialTransaction.properties[constants.PRICE_HIST_PROP];
    if (priceHistProp) {
      priceHist = new Amount(priceHistProp).abs();
    }
    const tradeExcRateProp = financialTransaction.properties[constants.TRADE_EXC_RATE_PROP];
    if (tradeExcRateProp) {
      tradeExcRate = new Amount(tradeExcRateProp);
    }
    const tradeExcRateHistProp = financialTransaction.properties[constants.TRADE_EXC_RATE_HIST_PROP];
    if (tradeExcRateHistProp) {
      tradeExcRateHist = new Amount(tradeExcRateHistProp);
    }

    let stockAccount = await this.getConnectedStockAccount(financialBook, stockBook, financialCreditAccount);

    if (stockAccount && !stockAccount.isArchived()) {
      // Selling
      let stockSellAccount = await stockBook.getAccount(constants.STOCK_SELL_ACCOUNT_NAME);
      if (stockSellAccount == null) {
        stockSellAccount = await new Account(stockBook).setName(constants.STOCK_SELL_ACCOUNT_NAME).setType(AccountType.OUTGOING).create();
      }

      let newTransaction = await new Transaction(stockBook)
        .setDate(financialTransaction.date)
        .setAmount(quantity)
        .setCreditAccount(stockAccount)
        .setDebitAccount(stockSellAccount)
        .setDescription(financialTransaction.description)
        .addRemoteId(financialTransaction.id)
        .setProperty(constants.SALE_PRICE_PROP, price.toString())
        .setProperty(constants.SALE_PRICE_HIST_PROP, priceHist?.toString())
        .setProperty(constants.TRADE_EXC_RATE_PROP, tradeExcRate?.toString())
        .setProperty(constants.TRADE_EXC_RATE_HIST_PROP, tradeExcRateHist?.toString())
        .setProperty(constants.ORDER_PROP, financialTransaction.properties[constants.ORDER_PROP])
        .setProperty(constants.ORIGINAL_QUANTITY_PROP, quantity.toString())
        .setProperty(constants.ORIGINAL_AMOUNT_PROP, originalAmount.toString())
        .setProperty(constants.STOCK_EXC_CODE_PROP, stockExcCode)
        .post()
      ;

      this.checkLastTxDate(stockAccount, financialTransaction);

      let record = `${newTransaction.getDate()} ${newTransaction.getAmount()} ${stockAccount.getName()} ${stockSellAccount.getName()} ${newTransaction.getDescription()}`;
      return `SELL: ${stockBookAnchor}: ${record}`;

    } else {

      stockAccount = await this.getConnectedStockAccount(financialBook, stockBook, financialDebitAccount);
      if (stockAccount) {
        // Buying
        let stockBuyAccount = await stockBook.getAccount(constants.STOCK_BUY_ACCOUNT_NAME);
        if (stockBuyAccount == null) {
          stockBuyAccount = await new Account(stockBook).setName(constants.STOCK_BUY_ACCOUNT_NAME).setType(AccountType.INCOMING).create();
        }

        let newTransaction = await new Transaction(stockBook)
          .setDate(financialTransaction.date)
          .setAmount(quantity)
          .setCreditAccount(stockBuyAccount)
          .setDebitAccount(stockAccount)
          .setDescription(financialTransaction.description)
          .addRemoteId(financialTransaction.id)
          .setProperty(constants.PURCHASE_PRICE_PROP, price.toString())
          .setProperty(constants.PURCHASE_PRICE_HIST_PROP, priceHist?.toString())
          .setProperty(constants.TRADE_EXC_RATE_PROP, tradeExcRate?.toString())
          .setProperty(constants.TRADE_EXC_RATE_HIST_PROP, tradeExcRateHist?.toString())
          .setProperty(constants.ORDER_PROP, financialTransaction.properties[constants.ORDER_PROP])
          .setProperty(constants.ORIGINAL_QUANTITY_PROP, quantity.toString())
          .setProperty(constants.ORIGINAL_AMOUNT_PROP, originalAmount.toString())
          .setProperty(constants.STOCK_EXC_CODE_PROP, stockExcCode)
          .post()
        ;

        this.checkLastTxDate(stockAccount, financialTransaction);

        let record = `${newTransaction.getDate()} ${newTransaction.getAmount()} ${stockBuyAccount.getName()} ${stockAccount.getName()} ${newTransaction.getDescription()}`;
        return `BUY: ${stockBookAnchor}: ${record}`;
      }
    }

    return null;
  }

  private checkLastTxDate(stockAccount: Account, transaction: bkper.Transaction) {
    let lastTxDate = this.botService.getRealizedDateValue(stockAccount);
    if (lastTxDate != null && transaction.dateValue <= +lastTxDate) {
      stockAccount.setProperty(constants.NEEDS_REBUILD_PROP, 'TRUE').update();
    }
  }

  private async getConnectedStockAccount(financialBook: Book, stockBook: Book, financialAccount: bkper.Account): Promise<Account> {
    let stockExchangeCode = this.botService.getStockExchangeCode(financialAccount);
    if (stockExchangeCode != null) {
      let stockAccount = await stockBook.getAccount(financialAccount.name);
      if (stockAccount == null) {
        stockAccount = new Account(stockBook)
          .setName(financialAccount.name)
          .setType(financialAccount.type as AccountType)
          .setVisibleProperties(financialAccount.properties)
          .setArchived(financialAccount.archived);
        if (financialAccount.groups) {
          for (const financialGroup of financialAccount.groups) {
            if (financialGroup) {
              let stockGroup = await stockBook.getGroup(financialGroup.name);
              let stockExcCode = financialGroup.properties[constants.STOCK_EXC_CODE_PROP];
              if (stockGroup == null && stockExcCode != null && stockExcCode.trim() != '') {
                stockGroup = await new Group(stockBook)
                  .setHidden(financialGroup.hidden)
                  .setName(financialGroup.name)
                  .setVisibleProperties(financialGroup.properties)
                  .create()
                ;
              }
              stockAccount.addGroup(stockGroup);
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
