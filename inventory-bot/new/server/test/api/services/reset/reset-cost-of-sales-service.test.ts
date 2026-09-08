import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Book, Transaction, TransactionList, type Amount } from 'bkper-js';
import type { OperationContext } from '../../../../src/api/services/operation-service.js';
import { ResetCostOfSalesService } from '../../../../src/api/services/reset/reset-cost-of-sales-service.js';
import { Summary } from '../../../../src/api/services/summary.js';

interface Fixture {
    context: OperationContext;
    inventoryBook: Book;
    financialBook: Book;
    account: Account;
}

interface BatchCall {
    phase: string;
    transactions: Transaction[];
    includeChecked: boolean | undefined;
}

function createFixture(): Fixture {
    const inventoryBook = new Book({ id: 'inventory-book', name: 'Inventory' });
    const financialBook = new Book({ id: 'financial-book', name: 'Financial' });
    const account = new Account(inventoryBook, {
        id: 'item-account',
        name: 'Apple',
        type: AccountType.ASSET,
        permanent: true,
        properties: {
            needs_rebuild: 'TRUE',
            cogs_calc_date: '2026-03-05',
        },
    });
    return {
        context: { inventoryBook, inventoryAccount: account, financialBook },
        inventoryBook,
        financialBook,
        account,
    };
}

function createTransaction(
    book: Book,
    id: string,
    properties: Record<string, string> = {},
    checked = true
): Transaction {
    return new Transaction(book, {
        id,
        agentId: 'inventory-bot',
        amount: '1',
        posted: true,
        checked,
        properties,
    });
}

function transactionPage(
    book: Book,
    transactions: Transaction[],
    cursor?: string
): TransactionList {
    const page = new TransactionList(book, { items: [], cursor });
    page.getItems = () => transactions;
    return page;
}

function amount(transaction: Transaction): string | undefined {
    return (transaction.getAmount() as Amount | undefined)?.toString();
}

describe('legacy Account-level Reset Cost of Sales behavior', () => {
    test('loads every source page and preserves linked cleanup and restoration order', async () => {
        const fixture = createFixture();
        const item = fixture.account;
        const buy = new Account(fixture.inventoryBook, {
            id: 'buy',
            name: 'Buy',
            type: AccountType.INCOMING,
        });
        const sell = new Account(fixture.inventoryBook, {
            id: 'sell',
            name: 'Sell',
            type: AccountType.OUTGOING,
        });
        const sale = createTransaction(fixture.inventoryBook, 'sale', {
            purchase_log: 'purchase-log',
            total_cost: '25',
        });
        sale.getCreditAccount = async () => item;
        sale.getDebitAccount = async () => sell;
        const parentPurchase = createTransaction(fixture.inventoryBook, 'parent-purchase', {
            original_quantity: '10',
            good_purchase_cost: '7',
            total_cost: '99',
            liquidation_log: 'liquidation-log',
            additional_costs: '5',
            credit_note: 'credit-note-on-parent',
        });
        parentPurchase.getCreditAccount = async () => buy;
        parentPurchase.getDebitAccount = async () => item;
        const splitPurchase = createTransaction(fixture.inventoryBook, 'split-purchase', {
            parent_id: 'parent-purchase',
            credit_note: 'credit-split',
        });
        const creditNote = createTransaction(fixture.inventoryBook, 'credit-note', {
            credit_note: 'credit-1',
        });
        const unrelated = createTransaction(fixture.inventoryBook, 'unrelated');
        unrelated.getAgentId = () => 'another-agent';

        const sourceRequests: Array<{ query?: string; cursor?: string }> = [];
        fixture.inventoryBook.listTransactions = async (query, _limit, cursor) => {
            sourceRequests.push({ query, cursor });
            return cursor
                ? transactionPage(fixture.inventoryBook, [splitPurchase, creditNote, unrelated])
                : transactionPage(fixture.inventoryBook, [sale, parentPurchase], 'source-page-2');
        };

        const firstLinkedCOGS = createTransaction(fixture.financialBook, 'cogs-first');
        const laterLinkedCOGS = createTransaction(fixture.financialBook, 'cogs-later');
        const financialRequests: Array<{ query?: string; limit?: number; cursor?: string }> = [];
        fixture.financialBook.listTransactions = async (query, limit, cursor) => {
            financialRequests.push({ query, limit, cursor });
            return transactionPage(fixture.financialBook, [firstLinkedCOGS, laterLinkedCOGS]);
        };

        const calls: BatchCall[] = [];
        fixture.financialBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'financial-trash', transactions, includeChecked });
        };
        fixture.inventoryBook.batchUpdateTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'inventory-update', transactions, includeChecked });
            return transactions;
        };
        fixture.inventoryBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'inventory-trash', transactions, includeChecked });
        };
        fixture.account.update = async () => {
            calls.push({ phase: 'account-update', transactions: [], includeChecked: undefined });
            return fixture.account;
        };

        const result = await new ResetCostOfSalesService().execute(fixture.context);

        expect(result).toBeInstanceOf(Summary);
        expect(result.getAccountId()).toBe('item-account');
        expect(result.getResult()).toBe('Reseted');
        expect(result.hasError()).toBe(false);
        expect(sourceRequests).toEqual([
            { query: "account:'Apple'", cursor: undefined },
            { query: "account:'Apple'", cursor: 'source-page-2' },
        ]);
        expect(financialRequests).toEqual([
            { query: 'remoteId:sale', limit: undefined, cursor: undefined },
        ]);
        expect(calls.map(call => call.phase)).toEqual([
            'financial-trash',
            'inventory-update',
            'inventory-trash',
            'account-update',
        ]);
        expect(calls.slice(0, 3).every(call => call.includeChecked === true)).toBe(true);
        expect(calls[0]?.transactions).toEqual([firstLinkedCOGS]);
        expect(calls[1]?.transactions).toEqual([sale, parentPurchase, splitPurchase, creditNote]);
        expect(calls[2]?.transactions).toEqual([splitPurchase]);
        expect(calls.flatMap(call => call.transactions)).not.toContain(laterLinkedCOGS);

        expect(sale.getProperty('purchase_log')).toBeUndefined();
        expect(sale.getProperty('total_cost')).toBeUndefined();
        expect(amount(parentPurchase)).toBe('10');
        expect(parentPurchase.getProperty('total_cost')).toBe('7');
        expect(parentPurchase.getProperty('liquidation_log')).toBeUndefined();
        expect(parentPurchase.getProperty('additional_costs')).toBeUndefined();
        expect(parentPurchase.getProperty('credit_note')).toBeUndefined();
        expect(creditNote.getProperty('credit_note')).toBe('credit-1');
        expect(await sale.getCreditAccount()).toBe(item);
        expect(await sale.getDebitAccount()).toBe(sell);
        expect(await parentPurchase.getCreditAccount()).toBe(buy);
        expect(await parentPurchase.getDebitAccount()).toBe(item);

        expect(sale.isChecked()).toBe(false);
        expect(parentPurchase.isChecked()).toBe(false);
        expect(splitPurchase.isChecked()).toBe(false);
        expect(creditNote.isChecked()).toBe(false);
        expect(unrelated.isChecked()).toBe(false);
        expect(firstLinkedCOGS.isChecked()).toBe(false);
        expect(fixture.account.getProperty('needs_rebuild')).toBeUndefined();
        expect(fixture.account.getProperty('cogs_calc_date')).toBeUndefined();
    });

    test('performs no Book or Account write when any queued Transaction is locked', async () => {
        const fixture = createFixture();
        const lockedParent = createTransaction(fixture.inventoryBook, 'locked-parent', {
            original_quantity: '2',
            good_purchase_cost: '4',
        });
        lockedParent.isLocked = () => true;
        fixture.inventoryBook.listTransactions = async () =>
            transactionPage(fixture.inventoryBook, [lockedParent]);
        fixture.inventoryBook.batchUpdateTransactions = async () => {
            throw new Error('Unexpected Inventory update');
        };
        fixture.inventoryBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Inventory trash');
        };
        fixture.financialBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Financial trash');
        };
        fixture.account.update = async () => {
            throw new Error('Unexpected Account update');
        };

        const result = await new ResetCostOfSalesService().execute(fixture.context);

        expect(result.hasError()).toBe(true);
        expect(result.getResult()).toBe('Cannot proceed: collection has locked/closed book(s)');
        expect(fixture.account.getProperty('needs_rebuild')).toBe('TRUE');
        expect(fixture.account.getProperty('cogs_calc_date')).toBe('2026-03-05');
    });

    test('updates Account state only after every Transaction phase succeeds', async () => {
        const fixture = createFixture();
        const sale = createTransaction(fixture.inventoryBook, 'sale', {
            purchase_log: 'purchase-log',
        });
        const linkedCOGS = createTransaction(fixture.financialBook, 'linked-cogs');
        fixture.inventoryBook.listTransactions = async () =>
            transactionPage(fixture.inventoryBook, [sale]);
        fixture.financialBook.listTransactions = async () =>
            transactionPage(fixture.financialBook, [linkedCOGS]);
        const error = new Error('Financial trash failed');
        fixture.financialBook.batchTrashTransactions = async () => {
            throw error;
        };
        fixture.account.update = async () => {
            throw new Error('Account update must not start');
        };

        await expect(new ResetCostOfSalesService().execute(fixture.context)).rejects.toBe(error);
        expect(fixture.account.getProperty('needs_rebuild')).toBe('TRUE');
        expect(fixture.account.getProperty('cogs_calc_date')).toBe('2026-03-05');
    });
});
