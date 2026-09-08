import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
    Account,
    AccountType,
    Book,
    Group,
    Transaction,
    TransactionList,
    type Amount,
} from 'bkper-js';
import { CalculateCostOfSalesService } from '../../../../src/api/services/calculate/calculate-cost-of-sales-service.js';
import type { OperationContext } from '../../../../src/api/services/operation-service.js';
import { ResetCostOfSalesService } from '../../../../src/api/services/reset/reset-cost-of-sales-service.js';
import { Summary, SummaryState } from '../../../../src/api/services/summary.js';

interface Fixture {
    context: OperationContext;
    inventoryBook: Book;
    financialBook: Book;
    item: Account;
    buy: Account;
    sell: Account;
    financialItem: Account;
    cogsAccount: Account;
    accountUpdates: string[];
    phases: Array<{ phase: string; transactions: Transaction[]; includeChecked?: boolean }>;
}

const originalResetExecute = ResetCostOfSalesService.prototype.execute;

afterEach(() => {
    ResetCostOfSalesService.prototype.execute = originalResetExecute;
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

function createFixture(): Fixture {
    const inventoryBook = new Book({
        id: 'inventory-book',
        name: 'Inventory',
        fractionDigits: 0,
        timeZone: 'Etc/UTC',
        collection: {
            books: [
                { id: 'inventory-book', fractionDigits: 0 },
                {
                    id: 'financial-book',
                    fractionDigits: 2,
                    properties: { exc_code: 'USD' },
                },
            ],
        },
    });
    const financialBook = new Book({
        id: 'financial-book',
        name: 'Financial',
        fractionDigits: 2,
        timeZone: 'Etc/UTC',
    });
    const item = new Account(inventoryBook, {
        id: 'item-account',
        name: 'Apple',
        type: AccountType.ASSET,
        permanent: true,
    });
    const usdGroup = new Group(inventoryBook, { properties: { exc_code: 'USD' } });
    item.getGroups = async () => [usdGroup];
    const buy = new Account(inventoryBook, {
        id: 'buy-account',
        name: 'Buy',
        type: AccountType.INCOMING,
    });
    const sell = new Account(inventoryBook, {
        id: 'sell-account',
        name: 'Sell',
        type: AccountType.OUTGOING,
    });
    const financialItem = new Account(financialBook, {
        id: 'financial-item',
        name: 'Apple',
        type: AccountType.ASSET,
    });
    const cogsAccount = new Account(financialBook, {
        id: 'cogs-account',
        name: 'Cost of goods sold',
        type: AccountType.OUTGOING,
    });
    inventoryBook.getAccount = async idOrName => {
        if (idOrName === 'item-account' || idOrName === 'Apple') return item;
        if (idOrName === 'buy-account' || idOrName === 'Buy') return buy;
        if (idOrName === 'sell-account' || idOrName === 'Sell') return sell;
        return undefined;
    };
    financialBook.getAccount = async idOrName => {
        if (idOrName === 'financial-item' || idOrName === 'Apple') return financialItem;
        if (idOrName === 'cogs-account' || idOrName === 'Cost of goods sold') {
            return cogsAccount;
        }
        return undefined;
    };
    financialBook.listTransactions = async () => transactionPage(financialBook, []);

    const accountUpdates: string[] = [];
    item.update = async () => {
        accountUpdates.push(item.getProperty('cogs_calc_date') ?? '');
        return item;
    };
    const phases: Fixture['phases'] = [];
    inventoryBook.batchCreateTransactions = async transactions => {
        phases.push({ phase: 'inventory-create', transactions });
        return transactions;
    };
    inventoryBook.batchUpdateTransactions = async (transactions, includeChecked) => {
        phases.push({ phase: 'inventory-update', transactions, includeChecked });
        return transactions;
    };
    financialBook.batchCreateTransactions = async transactions => {
        phases.push({ phase: 'financial-create', transactions });
        return transactions;
    };

    return {
        context: { inventoryBook, inventoryAccount: item, financialBook },
        inventoryBook,
        financialBook,
        item,
        buy,
        sell,
        financialItem,
        cogsAccount,
        accountUpdates,
        phases,
    };
}

function createMovement(
    fixture: Fixture,
    payload: bkper.Transaction,
    creditAccount: Account,
    debitAccount: Account
): Transaction {
    const transaction = new Transaction(fixture.inventoryBook, {
        posted: true,
        checked: false,
        agentId: 'inventory-bot',
        ...payload,
    });
    transaction.getCreditAccount = async () => creditAccount;
    transaction.getDebitAccount = async () => debitAccount;
    transaction.getCreditAccountName = async () => creditAccount.getName();
    transaction.getDebitAccountName = async () => debitAccount.getName();
    transaction.getDateValue = () => Number(transaction.getDate()?.replaceAll('-', ''));
    return transaction;
}

function amount(transaction: Transaction): string | undefined {
    return (transaction.getAmount() as Amount | undefined)?.toString();
}

describe('legacy Account-level Calculate Cost of Sales behavior', () => {
    test('returns the untouched summary when the defensive Financial Book lookup is empty', async () => {
        const fixture = createFixture();
        fixture.inventoryBook.payload.collection = {
            books: [{ id: 'inventory-book', fractionDigits: 0 }],
        };
        fixture.inventoryBook.listTransactions = async () => {
            throw new Error('Transaction loading must not start');
        };

        const result = await new CalculateCostOfSalesService().execute(fixture.context);

        expect(result.getState()).toBe(SummaryState.EMPTY);
        expect(result.getResult()).toBe('Nothing to calculate');
        expect(fixture.phases).toEqual([]);
    });

    test('loads all pages and preserves multiple-lot FIFO, partial splitting, logs, and movement order', async () => {
        const fixture = createFixture();
        const purchase1 = createMovement(
            fixture,
            {
                id: 'purchase-1',
                date: '2026-01-01',
                amount: '10',
                description: 'Purchase 1',
                properties: {
                    purchase_code: 'purchase-1',
                    original_quantity: '10',
                    total_cost: '100',
                },
            },
            fixture.buy,
            fixture.item
        );
        const purchase2 = createMovement(
            fixture,
            {
                id: 'purchase-2',
                date: '2026-01-02',
                amount: '5',
                description: 'Purchase 2',
                properties: {
                    purchase_code: 'purchase-2',
                    original_quantity: '5',
                    total_cost: '100',
                },
            },
            fixture.buy,
            fixture.item
        );
        const sale = createMovement(
            fixture,
            {
                id: 'sale-1',
                date: '2026-02-01',
                amount: '12',
                description: 'Sale 1',
                properties: { sale_invoice: 'sale-invoice-1' },
            },
            fixture.item,
            fixture.sell
        );
        const requests: Array<{ query?: string; cursor?: string }> = [];
        fixture.inventoryBook.listTransactions = async (query, _limit, cursor) => {
            requests.push({ query, cursor });
            return cursor
                ? transactionPage(fixture.inventoryBook, [purchase1])
                : transactionPage(fixture.inventoryBook, [purchase2, sale], 'page-2');
        };

        const result = await new CalculateCostOfSalesService().execute(
            fixture.context,
            '2026-02-28'
        );

        expect(result.getState()).toBe(SummaryState.CALCULATING);
        expect(result.getResult()).toBe('Calculating...');
        expect(requests).toEqual([
            { query: "account:'Apple' before:2026-03-01", cursor: undefined },
            { query: "account:'Apple' before:2026-03-01", cursor: 'page-2' },
        ]);
        expect(fixture.phases.map(call => call.phase)).toEqual([
            'inventory-create',
            'inventory-update',
            'financial-create',
        ]);
        expect(fixture.phases[1]?.includeChecked).toBe(true);

        const split = fixture.phases[0]?.transactions[0]!;
        expect(amount(split)).toBe('2');
        expect(split.getProperty('parent_id')).toBe('purchase-2');
        expect(split.getProperty('purchase_code')).toBe('purchase-2');
        expect(split.getProperty('total_cost')).toBe('40');
        expect(split.isChecked()).toBe(true);
        expect((await split.getCreditAccount())?.getId()).toBe('buy-account');
        expect((await split.getDebitAccount())?.getId()).toBe('item-account');

        expect(amount(purchase1)).toBe('10');
        expect(purchase1.getProperty('total_cost')).toBe('100');
        expect(purchase1.isChecked()).toBe(true);
        expect(amount(purchase2)).toBe('3');
        expect(purchase2.getProperty('total_cost')).toBe('60');
        expect(purchase2.isChecked()).toBe(false);
        expect(sale.getProperty('total_cost')).toBe('140');
        expect(JSON.parse(sale.getProperty('purchase_log')!)).toEqual([
            { id: 'purchase-1', qt: '10', uc: '10', rt: '' },
            { id: 'purchase-2', qt: '2', uc: '20', rt: '' },
        ]);
        expect(sale.isChecked()).toBe(true);

        const cogs = fixture.phases[2]?.transactions[0]!;
        expect(amount(cogs)).toBe('140');
        expect(cogs.getRemoteIds()).toEqual(['sale-1']);
        expect(cogs.getProperty('quantity_sold')).toBe('12');
        expect((await cogs.getCreditAccount())?.getId()).toBe('financial-item');
        expect((await cogs.getDebitAccount())?.getId()).toBe('cogs-account');
        expect(fixture.accountUpdates).toEqual(['2026-02-01']);
    });

    test('rejects total sales above available quantity without writing', async () => {
        const fixture = createFixture();
        const purchase = createMovement(
            fixture,
            {
                id: 'purchase',
                date: '2026-01-01',
                amount: '2',
                properties: {
                    purchase_code: 'purchase',
                    original_quantity: '2',
                    total_cost: '20',
                },
            },
            fixture.buy,
            fixture.item
        );
        const sale = createMovement(
            fixture,
            { id: 'sale', date: '2026-02-01', amount: '3' },
            fixture.item,
            fixture.sell
        );
        fixture.inventoryBook.listTransactions = async () =>
            transactionPage(fixture.inventoryBook, [purchase, sale]);

        const result = await new CalculateCostOfSalesService().execute(fixture.context);

        expect(result.getState()).toBe(SummaryState.SALE_QUANTITY_ERROR);
        expect(fixture.phases).toEqual([]);
        expect(fixture.accountUpdates).toEqual([]);
    });

    test('applies quantity credit notes, additional costs, and credit amounts before a partial sale', async () => {
        const fixture = createFixture();
        const purchase = createMovement(
            fixture,
            {
                id: 'purchase',
                date: '2026-01-01',
                amount: '10',
                properties: {
                    purchase_code: 'purchase-1',
                    original_quantity: '10',
                    total_cost: '100',
                },
            },
            fixture.buy,
            fixture.item
        );
        const creditQuantity = createMovement(
            fixture,
            {
                id: 'credit-quantity',
                date: '2026-01-02',
                amount: '2',
                properties: { purchase_code: 'purchase-1', credit_note: 'credit-1' },
            },
            fixture.item,
            fixture.buy
        );
        const sale = createMovement(
            fixture,
            {
                id: 'sale',
                date: '2026-02-01',
                amount: '2',
                properties: { sale_invoice: 'sale-1' },
            },
            fixture.item,
            fixture.sell
        );
        fixture.inventoryBook.listTransactions = async () =>
            transactionPage(fixture.inventoryBook, [sale, creditQuantity, purchase]);

        const payable = new Account(fixture.financialBook, {
            id: 'payable',
            type: AccountType.LIABILITY,
        });
        const freight = new Account(fixture.financialBook, {
            id: 'freight',
            type: AccountType.OUTGOING,
        });
        const additionalCost = new Transaction(fixture.financialBook, {
            id: 'additional-cost',
            amount: '8',
            checked: true,
            properties: {
                purchase_code: 'purchase-1',
                purchase_invoice: 'freight-1',
            },
        });
        additionalCost.getCreditAccount = async () => payable;
        additionalCost.getDebitAccount = async () => fixture.financialItem;
        const creditAmount = new Transaction(fixture.financialBook, {
            id: 'credit-amount',
            amount: '20',
            checked: true,
            properties: { purchase_code: 'purchase-1', credit_note: 'credit-1' },
        });
        creditAmount.getCreditAccount = async () => fixture.financialItem;
        creditAmount.getDebitAccount = async () => freight;
        fixture.financialBook.listTransactions = async () =>
            transactionPage(fixture.financialBook, [additionalCost, creditAmount]);

        const result = await new CalculateCostOfSalesService().execute(
            fixture.context,
            '2026-02-28'
        );

        expect(result.getState()).toBe(SummaryState.CALCULATING);
        expect(fixture.phases.map(call => call.phase)).toEqual([
            'inventory-create',
            'inventory-update',
            'financial-create',
        ]);
        const [creditSplit, saleSplit] = fixture.phases[0]!.transactions;
        expect(amount(creditSplit!)).toBe('2');
        expect(creditSplit!.getRemoteIds()).toEqual(['credit-1']);
        expect(creditSplit!.getProperty('credit_note')).toBe('credit-1');
        expect((await creditSplit!.getCreditAccount())?.getId()).toBe('buy-account');
        expect((await creditSplit!.getDebitAccount())?.getId()).toBe('item-account');
        expect(amount(saleSplit!)).toBe('2');
        expect(saleSplit!.getProperty('total_cost')).toBe('22');
        expect((await saleSplit!.getCreditAccount())?.getId()).toBe('buy-account');
        expect((await saleSplit!.getDebitAccount())?.getId()).toBe('item-account');

        expect(amount(purchase)).toBe('6');
        expect(purchase.getProperty('total_cost')).toBe('66');
        expect(purchase.getProperty('additional_costs')).toBe('8');
        expect(JSON.parse(purchase.getProperty('credit_note')!)).toEqual({
            quantity: 2,
            amount: 20,
        });
        expect(creditQuantity.isChecked()).toBe(true);
        expect(sale.getProperty('total_cost')).toBe('22');
        const cogs = fixture.phases[2]!.transactions[0]!;
        expect(amount(cogs)).toBe('22');
        expect((await cogs.getCreditAccount())?.getId()).toBe('financial-item');
        expect((await cogs.getDebitAccount())?.getId()).toBe('cogs-account');
    });

    test('processes credit notes before sales and rejects one that exhausts its purchase', async () => {
        const fixture = createFixture();
        const purchase1 = createMovement(
            fixture,
            {
                id: 'purchase-1',
                date: '2026-01-01',
                amount: '2',
                properties: {
                    purchase_code: 'purchase-1',
                    original_quantity: '2',
                    total_cost: '20',
                },
            },
            fixture.buy,
            fixture.item
        );
        const purchase2 = createMovement(
            fixture,
            {
                id: 'purchase-2',
                date: '2026-01-02',
                amount: '10',
                properties: {
                    purchase_code: 'purchase-2',
                    original_quantity: '10',
                    total_cost: '100',
                },
            },
            fixture.buy,
            fixture.item
        );
        const credit = createMovement(
            fixture,
            {
                id: 'credit',
                date: '2026-01-03',
                amount: '2',
                properties: { purchase_code: 'purchase-1', credit_note: 'credit-1' },
            },
            fixture.item,
            fixture.buy
        );
        const sale = createMovement(
            fixture,
            { id: 'sale', date: '2026-02-01', amount: '1' },
            fixture.item,
            fixture.sell
        );
        fixture.inventoryBook.listTransactions = async () =>
            transactionPage(fixture.inventoryBook, [purchase1, purchase2, credit, sale]);

        const result = await new CalculateCostOfSalesService().execute(fixture.context);

        expect(result.getState()).toBe(SummaryState.CREDIT_NOTE_QUANTITY_ERROR);
        expect(result.getResult()).toContain('credit-1');
        expect(fixture.phases).toEqual([]);
    });

    test('awaits Reset and returns immediately when the Account needs rebuild', async () => {
        const fixture = createFixture();
        fixture.item.setProperty('needs_rebuild', 'TRUE');
        const reset = mock(async () => new Summary('item-account').resetingAsync());
        ResetCostOfSalesService.prototype.execute = reset;
        fixture.inventoryBook.listTransactions = async () => {
            throw new Error('Calculate must stop after Reset');
        };

        const result = await new CalculateCostOfSalesService().execute(fixture.context);

        expect(reset).toHaveBeenCalledTimes(1);
        expect(reset).toHaveBeenCalledWith(fixture.context);
        expect(result.getState()).toBe(SummaryState.REBUILD);
        expect(fixture.phases).toEqual([]);
    });

    test('returns the locked outcome before Transaction batches or Account state writes', async () => {
        const fixture = createFixture();
        const purchase = createMovement(
            fixture,
            {
                id: 'purchase',
                date: '2026-01-01',
                amount: '2',
                properties: {
                    purchase_code: 'purchase',
                    original_quantity: '2',
                    total_cost: '20',
                },
            },
            fixture.buy,
            fixture.item
        );
        purchase.isLocked = () => true;
        const sale = createMovement(
            fixture,
            { id: 'sale', date: '2026-02-01', amount: '1' },
            fixture.item,
            fixture.sell
        );
        fixture.inventoryBook.listTransactions = async () =>
            transactionPage(fixture.inventoryBook, [purchase, sale]);

        const result = await new CalculateCostOfSalesService().execute(fixture.context);

        expect(result.getState()).toBe(SummaryState.LOCKED);
        expect(fixture.phases).toEqual([]);
        expect(fixture.accountUpdates).toEqual([]);
    });
});
