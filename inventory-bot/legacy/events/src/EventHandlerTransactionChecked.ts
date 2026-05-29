import { Account, AccountType, Amount, Book, Group, Transaction } from "bkper-js";
import { EventHandlerTransaction } from "./EventHandlerTransaction.js";
import { CREDIT_NOTE_PROP, EXC_CODE_PROP, GOOD_BUY_ACCOUNT_NAME, GOOD_PROP, GOOD_PURCHASE_COST_PROP, GOOD_SELL_ACCOUNT_NAME, NEEDS_REBUILD_PROP, ORDER_PROP, ORIGINAL_QUANTITY_PROP, PURCHASE_CODE_PROP, PURCHASE_INVOICE_PROP, SALE_AMOUNT_PROP, SALE_INVOICE_PROP, TOTAL_COST_PROP } from "./constants.js";
import { Result } from "./index.js";
import { InterceptorFlagRebuild } from "./InterceptorFlagRebuild.js";
import { AppContext } from "./AppContext.js";

export class EventHandlerTransactionChecked extends EventHandlerTransaction {

    constructor(context: AppContext) {
        super(context);
    }

    async intercept(eventBook: Book, event: bkper.Event): Promise<Result> {
        let response = await new InterceptorFlagRebuild(this.context).intercept(eventBook, event);
        return response;
    }

    // financial transaction had been already replicated in the inventory book
    protected async connectedTransactionFound(inventoryBook: Book, goodTransaction: Transaction): Promise<string | undefined> {
        const bookAnchor = this.botService.buildBookAnchor(inventoryBook);
        const record = `${goodTransaction.getDate()} ${goodTransaction.getAmount()} ${await goodTransaction.getCreditAccountName()} ${await goodTransaction.getDebitAccountName()} ${goodTransaction.getDescription()}`;
        return `FOUND: ${bookAnchor} ${record}`;
    }

    // create purchase (Buy) or sale (Sell) transactions in the inventory book in response to the financial transactions
    protected async connectedTransactionNotFound(inventoryBook: Book, financialTransaction: bkper.Transaction, goodExcCode: string): Promise<string | undefined> {
        if (financialTransaction.debitAccount && financialTransaction.creditAccount && financialTransaction.date && financialTransaction.id && financialTransaction.properties) {

            const quantity = this.botService.getQuantity(financialTransaction);
            const purchaseInvoice = financialTransaction.properties[PURCHASE_INVOICE_PROP];
            const saleInvoice = financialTransaction.properties[SALE_INVOICE_PROP];
            const creditNote = financialTransaction.properties[CREDIT_NOTE_PROP];

            // prevent bot response when transaction is missing quantity or is not a purchase or sale transaction
            if (quantity == undefined || quantity.eq(0)) {
                return undefined;
            }

            if (saleInvoice) {
                // Selling
                const goodProperty = financialTransaction.properties?.[GOOD_PROP];

                let inventoryAccount = await inventoryBook.getAccount(goodProperty);
                if (!inventoryAccount) {
                    inventoryAccount = await this.createConnectedInventoryAccountOnSale(inventoryBook, goodProperty);
                }

                let inventorySellAccount = await inventoryBook.getAccount(GOOD_SELL_ACCOUNT_NAME);
                if (!inventorySellAccount) {
                    inventorySellAccount = await new Account(inventoryBook).setName(GOOD_SELL_ACCOUNT_NAME).setType(AccountType.OUTGOING).create();
                }

                const newTransaction = await new Transaction(inventoryBook)
                    .setDate(financialTransaction.date)
                    .setAmount(quantity)
                    .setCreditAccount(inventoryAccount)
                    .setDebitAccount(inventorySellAccount)
                    .setDescription(financialTransaction.description ?? '')
                    .addRemoteId(financialTransaction.id)
                    .setProperty(SALE_INVOICE_PROP, financialTransaction.properties[SALE_INVOICE_PROP])
                    .setProperty(ORDER_PROP, financialTransaction.properties[ORDER_PROP])
                    .setProperty(SALE_AMOUNT_PROP, new Amount(financialTransaction.amount ?? 0).toString())
                    .setProperty(EXC_CODE_PROP, goodExcCode)
                    .post();

                const inventoryBookAnchor = this.botService.buildBookAnchor(inventoryBook);
                const record = `${newTransaction.getDate()} ${newTransaction.getAmount()} ${inventoryAccount.getName()} ${inventoryAccount.getName()} ${newTransaction.getDescription()}`;
                const needsRebuild = await this.checkLastTxDate(inventoryAccount, financialTransaction);

                if (needsRebuild) {
                    return `SELL: ${inventoryBookAnchor}: ${record} / WARNING: Transaction date is before the last COGS calculation date. Flagging account ${inventoryAccount.getName()} for rebuild`;
                } else {
                    return `SELL: ${inventoryBookAnchor}: ${record}`;
                }

            } else if (purchaseInvoice) {
                // Buying
                const financialDebitAccount = financialTransaction.debitAccount;
                let inventoryAccount = await inventoryBook.getAccount(financialDebitAccount.name);
                // if account is not found, create it
                if (!inventoryAccount) {
                    inventoryAccount = await this.createConnectedInventoryAccountOnPurchase(inventoryBook, financialDebitAccount);
                } else {
                    // if account was created on sale, check if groups and properties are correctly set
                    await this.checkInventoryAccount(inventoryBook, financialDebitAccount);
                }

                let inventoryBuyAccount = await inventoryBook.getAccount(GOOD_BUY_ACCOUNT_NAME);
                if (inventoryBuyAccount == null) {
                    inventoryBuyAccount = await new Account(inventoryBook).setName(GOOD_BUY_ACCOUNT_NAME).setType(AccountType.INCOMING).create();
                }

                const newTransaction = await new Transaction(inventoryBook)
                    .setDate(financialTransaction.date)
                    .setAmount(quantity)
                    .setCreditAccount(inventoryBuyAccount)
                    .setDebitAccount(inventoryAccount)
                    .setDescription(financialTransaction.description ?? '')
                    .addRemoteId(financialTransaction.id)
                    .setProperty(PURCHASE_CODE_PROP, financialTransaction.properties[PURCHASE_CODE_PROP])
                    .setProperty(ORIGINAL_QUANTITY_PROP, quantity.toString())
                    .setProperty(GOOD_PURCHASE_COST_PROP, new Amount(financialTransaction.amount ?? 0).toString())
                    .setProperty(ORDER_PROP, financialTransaction.properties[ORDER_PROP])
                    .setProperty(EXC_CODE_PROP, goodExcCode)
                    .setProperty(TOTAL_COST_PROP, new Amount(financialTransaction.amount ?? 0).toString())
                    .post();

                const inventoryBookAnchor = this.botService.buildBookAnchor(inventoryBook);
                const record = `${newTransaction.getDate()} ${newTransaction.getAmount()} ${inventoryBuyAccount.getName()} ${inventoryAccount.getName()} ${newTransaction.getDescription()}`;
                const needsRebuild = await this.checkLastTxDate(inventoryAccount, financialTransaction);

                if (needsRebuild) {
                    return `BUY: ${inventoryBookAnchor}: ${record} / WARNING: Transaction date is before the last COGS calculation date. Flagging account ${inventoryAccount.getName()} for rebuild`;
                } else {
                    return `BUY: ${inventoryBookAnchor}: ${record}`;
                }

            } else if (creditNote) {
                // Credit Note
                const financialCreditAccount = financialTransaction.creditAccount;
                let inventoryAccount = await inventoryBook.getAccount(financialCreditAccount.name);
                if (!inventoryAccount) {
                    inventoryAccount = await this.createConnectedInventoryAccountOnPurchase(inventoryBook, financialCreditAccount);
                }

                let inventoryBuyAccount = await inventoryBook.getAccount(GOOD_BUY_ACCOUNT_NAME);
                if (inventoryBuyAccount == null) {
                    inventoryBuyAccount = await new Account(inventoryBook).setName(GOOD_BUY_ACCOUNT_NAME).setType(AccountType.INCOMING).create();
                }

                const newTransaction = await new Transaction(inventoryBook)
                    .setDate(financialTransaction.date)
                    .setAmount(quantity)
                    .setCreditAccount(inventoryAccount)
                    .setDebitAccount(inventoryBuyAccount)
                    .setDescription(financialTransaction.description ?? '')
                    .addRemoteId(financialTransaction.id)
                    .setProperty(CREDIT_NOTE_PROP, financialTransaction.properties[CREDIT_NOTE_PROP])
                    .setProperty(PURCHASE_CODE_PROP, financialTransaction.properties[PURCHASE_CODE_PROP])
                    .setProperty(ORDER_PROP, financialTransaction.properties[ORDER_PROP])
                    .setProperty(EXC_CODE_PROP, goodExcCode)
                    .post();

                const inventoryBookAnchor = this.botService.buildBookAnchor(inventoryBook);
                const record = `${newTransaction.getDate()} ${newTransaction.getAmount()} ${inventoryAccount.getName()} ${inventoryAccount.getName()} ${newTransaction.getDescription()}`;
                const needsRebuild = await this.checkLastTxDate(inventoryAccount, financialTransaction);

                if (needsRebuild) {
                    return `CREDIT: ${inventoryBookAnchor}: ${record} / WARNING: Transaction date is before the last COGS calculation date. Flagging account ${inventoryAccount.getName()} for rebuild`;
                } else {
                    return `CREDIT: ${inventoryBookAnchor}: ${record}`;
                }
            }
        }

        return undefined;
    }

    private async checkLastTxDate(goodAccount: Account, transaction: bkper.Transaction): Promise<boolean> {
        let lastTxDate = this.botService.getCOGSCalculationDateValue(goodAccount);
        if (lastTxDate != null && (transaction.dateValue != undefined && transaction.dateValue <= +lastTxDate)) {
            await goodAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
            return true;
        }
        return false;
    }

    // creates the good account in the inventory book corresponding to the good account in the financial book on purchase
    private async createConnectedInventoryAccountOnPurchase(inventoryBook: Book, financialAccount: bkper.Account): Promise<Account> {

        const inventoryAccountName = financialAccount.name!;
        const inventoryAccountProperties = financialAccount.properties ?? {};
        const inventoryAccountArchived = financialAccount.archived ?? false;
        const inventoryAccountGroups = financialAccount.groups ?? [];

        let inventoryAccount = new Account(inventoryBook)
            .setName(inventoryAccountName)
            .setType(AccountType.ASSET)
            .setProperties(inventoryAccountProperties)
            .setArchived(inventoryAccountArchived);

        if (inventoryAccountGroups.length > 0) {
            for (const group of inventoryAccountGroups) {
                let inventoryGroup = await inventoryBook.getGroup(group.name);
                if (!inventoryGroup) {
                    inventoryGroup = await new Group(inventoryBook)
                        .setName(group.name ?? '')
                        .setParent(group.parent?.name ? await inventoryBook.getGroup(group.parent.name) : null)
                        .setProperties(group.properties ?? {})
                        .setHidden(group.hidden ?? false)
                        .create();
                }
                inventoryAccount.addGroup(inventoryGroup);
            }
        }

        inventoryAccount = await inventoryAccount.create();

        return inventoryAccount;
    }

    // creates the good account in the inventory book corresponding to the good account in the financial book on sale
    private async createConnectedInventoryAccountOnSale(inventoryBook: Book, goodAccountName: string): Promise<Account> {
        return await new Account(inventoryBook)
            .setName(goodAccountName)
            .setType(AccountType.ASSET)
            .create();
    }

    // check if inventory account groups and properties match the financial account groups and properties
    private async checkInventoryAccount(inventoryBook: Book, financialAccount: bkper.Account): Promise<boolean> {

        const inventoryAccount = await inventoryBook.getAccount(financialAccount.name);

        if (!inventoryAccount) {
            return false;
        }

        const inventoryAccountProperties = financialAccount.properties ?? {};
        const inventoryAccountArchived = financialAccount.archived ?? false;
        const inventoryAccountGroups = financialAccount.groups ?? [];

        let needsUpdate = false;

        // update properties and archived if needed
        if (inventoryAccount.getProperties() != inventoryAccountProperties) {
            inventoryAccount.setProperties(inventoryAccountProperties);
            needsUpdate = true;
        }

        if (inventoryAccount.isArchived() != inventoryAccountArchived) {
            inventoryAccount.setArchived(inventoryAccountArchived);
            needsUpdate = true;
        }

        // update groups if needed
        if (inventoryAccountGroups.length > 0) {
            for (const group of inventoryAccountGroups) {
                let inventoryGroup = await inventoryBook.getGroup(group.name);
                if (!inventoryGroup) {
                    inventoryGroup = await new Group(inventoryBook)
                        .setName(group.name ?? '')
                        .setParent(group.parent?.name ? await inventoryBook.getGroup(group.parent.name) : null)
                        .setProperties(group.properties ?? {})
                        .setHidden(group.hidden ?? false)
                        .create();
                    needsUpdate = true;
                }
                inventoryAccount.addGroup(inventoryGroup);
            }
        }

        if (needsUpdate) {
            await inventoryAccount.update();
        }

        return true;
    }

}