import { afterEach, describe, expect, test } from 'bun:test';
import {
    Account,
    AccountType,
    Amount,
    BkperError,
    Book,
    Transaction,
    TransactionList,
} from 'bkper-js';
import { CalculateCostOfSalesProcessor } from '../../../../src/api/services/calculate/calculate-cost-of-sales-processor.js';
import { CalculateCostOfSalesSupport } from '../../../../src/api/services/calculate/calculate-cost-of-sales-support.js';
import { GoodAccount } from '../../../../src/api/services/good-account.js';

const originalAccountCreate = Account.prototype.create;

afterEach(() => {
    Account.prototype.create = originalAccountCreate;
});

function transactionPage(
    book: Book,
    transactions: Transaction[],
    cursor?: string
): TransactionList {
    const page = new TransactionList(book, { items: [], cursor });
    page.getItems = () => transactions;
    return page;
}

function createTransaction(
    book: Book,
    payload: bkper.Transaction,
    creditAccount: Account,
    debitAccount: Account
): Transaction {
    const transaction = new Transaction(book, payload);
    transaction.getCreditAccount = async () => creditAccount;
    transaction.getDebitAccount = async () => debitAccount;
    transaction.getCreditAccountName = async () => creditAccount.getName();
    transaction.getDebitAccountName = async () => debitAccount.getName();
    return transaction;
}

describe('legacy Calculate Cost of Sales support', () => {
    test('loads every page and totals only matching additional costs and credit amounts', async () => {
        const inventoryBook = new Book({ id: 'inventory-book' });
        const financialBook = new Book({ id: 'financial-book', timeZone: 'Etc/UTC' });
        const inventoryItem = new Account(inventoryBook, { id: 'inventory-item', name: 'Apple' });
        const buy = new Account(inventoryBook, { id: 'buy', name: 'Buy' });
        const financialItem = new Account(financialBook, {
            id: 'financial-item',
            name: 'Apple',
        });
        const expense = new Account(financialBook, { id: 'expense', name: 'Freight' });
        const payable = new Account(financialBook, { id: 'payable', name: 'Supplier' });
        const purchase = createTransaction(
            inventoryBook,
            {
                id: 'purchase',
                date: '2026-03-15',
                properties: { purchase_code: 'purchase-1' },
            },
            buy,
            inventoryItem
        );
        const additionalCost = createTransaction(
            financialBook,
            {
                id: 'additional',
                amount: '3.25',
                posted: true,
                checked: true,
                properties: {
                    purchase_code: 'purchase-1',
                    purchase_invoice: 'freight-1',
                },
            },
            payable,
            financialItem
        );
        const creditNote = createTransaction(
            financialBook,
            {
                id: 'credit',
                amount: '1.10',
                posted: true,
                checked: true,
                properties: {
                    purchase_code: 'purchase-1',
                    credit_note: 'credit-1',
                },
            },
            financialItem,
            expense
        );
        const ignored = createTransaction(
            financialBook,
            {
                id: 'ignored',
                amount: '99',
                posted: true,
                checked: false,
                properties: {
                    purchase_code: 'purchase-1',
                    purchase_invoice: 'ignored',
                },
            },
            payable,
            financialItem
        );
        financialBook.getAccount = async () => financialItem;
        const requests: Array<{ query?: string; cursor?: string }> = [];
        financialBook.listTransactions = async (query, _limit, cursor) => {
            requests.push({ query, cursor });
            return cursor
                ? transactionPage(financialBook, [creditNote, ignored])
                : transactionPage(financialBook, [additionalCost], 'page-2');
        };

        const result = await new CalculateCostOfSalesSupport().getAdditionalCostsAndCreditNotes(
            financialBook,
            purchase
        );

        expect(result.additionalCosts.toString()).toBe('3.25');
        expect(result.creditNotesAmount.toString()).toBe('1.1');
        expect(requests).toEqual([
            {
                query: "account:'Apple' after:2026-01-14 before:2026-05-14",
                cursor: undefined,
            },
            {
                query: "account:'Apple' after:2026-01-14 before:2026-05-14",
                cursor: 'page-2',
            },
        ]);
    });

    test('creates the COGS Account when absent and queues a complete item-to-COGS movement', async () => {
        const inventoryBook = new Book({ id: 'inventory-book' });
        const financialBook = new Book({ id: 'financial-book' });
        const inventoryItem = new Account(inventoryBook, { id: 'inventory-item', name: 'Apple' });
        const sell = new Account(inventoryBook, { id: 'sell', name: 'Sell' });
        const financialItem = new Account(financialBook, {
            id: 'financial-item',
            name: 'Apple',
            type: AccountType.ASSET,
        });
        const sale = createTransaction(
            inventoryBook,
            {
                id: 'sale-1',
                date: '2026-04-02',
                amount: '4',
                description: 'Invoice 1',
                properties: { sale_invoice: 'invoice-1' },
            },
            inventoryItem,
            sell
        );
        let createdCogsAccount: Account | undefined;
        financialBook.getAccount = async accountName => {
            if (accountName === 'Cost of goods sold') {
                throw new BkperError(404, 'Resource not found', 'notFound');
            }
            if (accountName === 'cogs-account' && createdCogsAccount) {
                return createdCogsAccount;
            }
            return financialItem;
        };
        Account.prototype.create = async function () {
            this.payload.id = 'cogs-account';
            createdCogsAccount = this;
            return this;
        };
        const created: Transaction[] = [];
        financialBook.batchCreateTransactions = async transactions => {
            created.push(...transactions);
            return transactions;
        };
        const processor = new CalculateCostOfSalesProcessor(inventoryBook, financialBook);

        await new CalculateCostOfSalesSupport().addCostOfSales(
            financialBook,
            sale,
            new Amount('25.50'),
            processor
        );
        await processor.fireBatchOperations();

        expect(created).toHaveLength(1);
        const cogs = created[0]!;
        expect(cogs.getAmount()?.toString()).toBe('25.5');
        expect(cogs.getDate()).toBe('2026-04-02');
        expect(cogs.getDescription()).toBe('#COGS Invoice 1');
        expect(cogs.getRemoteIds()).toEqual(['sale-1']);
        expect(cogs.getProperty('quantity_sold')).toBe('4');
        expect(cogs.getProperty('sale_invoice')).toBe('invoice-1');
        expect(cogs.isChecked()).toBe(true);
        expect((await cogs.getCreditAccount())?.getId()).toBe('financial-item');
        expect((await cogs.getDebitAccount())?.getId()).toBe('cogs-account');
    });

    test('preserves logs and advances the Account date from the last sale only', async () => {
        const book = new Book({ id: 'inventory-book' });
        const account = new Account(book, {
            id: 'item',
            properties: { cogs_calc_date: '2026-03-01' },
        });
        let updates = 0;
        account.update = async () => {
            updates++;
            return account;
        };
        const first = new Transaction(book, {
            id: 'sale-1',
            date: '2026-03-02',
            amount: '2',
        });
        const last = new Transaction(book, {
            id: 'sale-2',
            date: '2026-03-05',
            amount: '3',
        });
        first.getDateValue = () => 20260302;
        last.getDateValue = () => 20260305;
        const support = new CalculateCostOfSalesSupport();

        expect(support.getLiquidationLog(last, new Amount('4.5'))).toEqual({
            id: 'sale-2',
            dt: '2026-03-05',
            qt: '3',
            uc: '4.5',
            rt: '',
        });
        expect(support.getPurchaseLog(new Amount('2'), new Amount('4.5'), first)).toEqual({
            id: 'sale-1',
            qt: '2',
            uc: '4.5',
            rt: '',
        });

        await support.storeLastCalcTxDate(new GoodAccount(account), [first, last]);

        expect(account.getProperty('cogs_calc_date')).toBe('2026-03-05');
        expect(updates).toBe(1);
    });
});
