import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Book, Transaction, TransactionList, type Amount } from 'bkper-js';
import { ResetRealizedResultsService } from '../../../../src/api/services/reset/reset-realized-results-service.js';
import { StockAccount } from '../../../../src/api/services/stock-account.js';
import { Summary } from '../../../../src/api/services/summary.js';

interface BooksFixture {
    portfolioBook: Book;
    financialBook: Book;
    baseBook: Book;
    stockAccount: StockAccount;
    account: Account;
    instrument: Account;
    buy: Account;
    sell: Account;
}

interface BatchCall {
    phase: string;
    transactions: Transaction[];
    includeChecked: boolean | undefined;
}

function createBooks(): BooksFixture {
    const portfolioBook = new Book({ id: 'portfolio-book', name: 'Portfolio' });
    const financialBook = new Book({ id: 'financial-book', name: 'Financial' });
    const baseBook = new Book({ id: 'base-book', name: 'Base' });
    const account = new Account(portfolioBook, {
        id: 'instrument',
        name: 'Instrument',
        type: AccountType.ASSET,
        properties: {
            needs_rebuild: 'true',
            forwarded_date: '2025-03-31',
            realized_date: '2025-05-31',
        },
    });
    return {
        portfolioBook,
        financialBook,
        baseBook,
        stockAccount: new StockAccount(account),
        account,
        instrument: account,
        buy: new Account(portfolioBook, {
            id: 'buy',
            name: 'Buy',
            type: AccountType.INCOMING,
        }),
        sell: new Account(portfolioBook, {
            id: 'sell',
            name: 'Sell',
            type: AccountType.OUTGOING,
        }),
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
        agentId: 'stock-bot',
        amount: '1',
        posted: true,
        checked,
        properties,
    });
}

function setMovement(transaction: Transaction, from: Account, to: Account): void {
    transaction.getCreditAccount = async () => from;
    transaction.getDebitAccount = async () => to;
}

function transactionPage(
    book: Book,
    transactions: Transaction[],
    cursor?: string
): TransactionList {
    const list = new TransactionList(book, { items: [], cursor });
    list.getItems = () => transactions;
    return list;
}

function amount(transaction: Transaction): string | undefined {
    return (transaction.getAmount() as Amount | undefined)?.toString();
}

describe('legacy batched Reset behavior', () => {
    test('loads every page and restores parents while cleaning the complete linked result set', async () => {
        const fixture = createBooks();
        const sale = createTransaction(fixture.portfolioBook, 'sale', {
            original_amount: '120',
            original_quantity: '4',
            gain_amount: '20',
            gain_amount_hist: '10',
            purchase_amount: '80',
            purchase_log: 'purchase-log',
            purchase_price: '20',
            fwd_purchase_log: 'forward-purchase-log',
            fwd_sale_price: '-30',
            gain_log: 'gain-log',
            liquidation_log: 'liquidation-log',
        });
        setMovement(sale, fixture.instrument, fixture.sell);

        const purchase = createTransaction(fixture.portfolioBook, 'purchase', {
            original_amount: '50',
            original_quantity: '5',
            sale_date: '2025-01-31',
            sale_price: '12',
            fwd_sale_price: '-12',
            fwd_sale_exc_rate: '1.1',
            fwd_purchase_price: '-10',
            short_sale: 'true',
        });
        setMovement(purchase, fixture.buy, fixture.instrument);

        const split = createTransaction(fixture.portfolioBook, 'split');
        const forwardLog = createTransaction(fixture.portfolioBook, 'forward-log', {
            fwd_tx: 'true',
        });
        const forwardLiquidation = createTransaction(fixture.portfolioBook, 'forward-liquidation', {
            fwd_liquidation: 'true',
        });
        const unrelated = createTransaction(fixture.portfolioBook, 'unrelated');
        unrelated.getAgentId = () => 'other-agent';

        const sourceRequests: Array<{ query?: string; cursor?: string }> = [];
        fixture.portfolioBook.listTransactions = async (query, _limit, cursor) => {
            sourceRequests.push({ query, cursor });
            return cursor
                ? transactionPage(fixture.portfolioBook, [purchase, split, unrelated])
                : transactionPage(
                      fixture.portfolioBook,
                      [sale, forwardLog, forwardLiquidation],
                      'source-page-2'
                  );
        };

        const financialRequests: Array<{ query?: string; cursor?: string }> = [];
        const financialLinked = new Map<string, Transaction[]>();
        for (const remoteId of [
            'fwd_forward-liquidation',
            'sale',
            'mtm_sale',
            'interestmtm_sale',
            'hist_sale',
            'mtm_hist_sale',
        ]) {
            financialLinked.set(remoteId, [
                createTransaction(fixture.financialBook, `${remoteId}-linked`),
            ]);
        }
        financialLinked.set('sale-page-2', [
            createTransaction(fixture.financialBook, 'sale-linked-page-2'),
        ]);
        fixture.financialBook.listTransactions = async (query, _limit, cursor) => {
            financialRequests.push({ query, cursor });
            const remoteId = query?.replace('remoteId:', '') ?? '';
            if (remoteId === 'sale' && !cursor) {
                return transactionPage(
                    fixture.financialBook,
                    financialLinked.get(remoteId) ?? [],
                    'linked-page-2'
                );
            }
            if (remoteId === 'sale' && cursor) {
                return transactionPage(
                    fixture.financialBook,
                    financialLinked.get('sale-page-2') ?? []
                );
            }
            return transactionPage(fixture.financialBook, financialLinked.get(remoteId) ?? []);
        };

        const baseRequests: Array<{ query?: string; cursor?: string }> = [];
        fixture.baseBook.listTransactions = async (query, _limit, cursor) => {
            baseRequests.push({ query, cursor });
            const remoteId = query?.replace('remoteId:', '') ?? '';
            return transactionPage(fixture.baseBook, [
                createTransaction(fixture.baseBook, `${remoteId}-linked`),
            ]);
        };

        const calls: BatchCall[] = [];
        fixture.portfolioBook.batchUpdateTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'portfolio-update', transactions, includeChecked });
            return transactions;
        };
        fixture.portfolioBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'portfolio-trash', transactions, includeChecked });
        };
        fixture.financialBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'financial-trash', transactions, includeChecked });
        };
        fixture.baseBook.batchTrashTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'base-trash', transactions, includeChecked });
        };
        fixture.account.update = async () => {
            calls.push({ phase: 'account-update', transactions: [], includeChecked: undefined });
            return fixture.account;
        };

        const result = await new ResetRealizedResultsService().resetRealizedResultsForAccountAsync(
            fixture.portfolioBook,
            fixture.stockAccount,
            false,
            fixture.financialBook,
            fixture.baseBook
        );

        expect(result).toBeInstanceOf(Summary);
        expect(result.getMessage()).toBe('Reseting async...');
        expect(sourceRequests).toEqual([
            { query: "account:'Instrument' after:2025-03-31", cursor: undefined },
            { query: "account:'Instrument' after:2025-03-31", cursor: 'source-page-2' },
        ]);
        expect(financialRequests).toEqual([
            { query: 'remoteId:sale', cursor: undefined },
            { query: 'remoteId:sale', cursor: 'linked-page-2' },
            { query: 'remoteId:mtm_sale', cursor: undefined },
            { query: 'remoteId:interestmtm_sale', cursor: undefined },
            { query: 'remoteId:hist_sale', cursor: undefined },
            { query: 'remoteId:mtm_hist_sale', cursor: undefined },
            { query: 'remoteId:fwd_forward-liquidation', cursor: undefined },
        ]);
        expect(baseRequests).toEqual([
            { query: 'remoteId:fx_sale', cursor: undefined },
            { query: 'remoteId:fx_hist_sale', cursor: undefined },
        ]);
        expect(calls.map(call => call.phase)).toEqual([
            'portfolio-update',
            'portfolio-trash',
            'financial-trash',
            'base-trash',
            'account-update',
        ]);
        expect(calls.slice(0, 4).every(call => call.includeChecked === true)).toBe(true);
        expect(calls[0]?.transactions).toEqual([sale, purchase]);
        expect(calls[1]?.transactions).toEqual([forwardLog, forwardLiquidation, split]);
        expect(calls[2]?.transactions.map(transaction => transaction.getId())).toEqual([
            'sale-linked',
            'sale-linked-page-2',
            'mtm_sale-linked',
            'interestmtm_sale-linked',
            'hist_sale-linked',
            'mtm_hist_sale-linked',
            'fwd_forward-liquidation-linked',
        ]);
        expect(calls[3]?.transactions.map(transaction => transaction.getId())).toEqual([
            'fx_sale-linked',
            'fx_hist_sale-linked',
        ]);

        expect(amount(sale)).toBe('4');
        expect(sale.getProperty('sale_price')).toBe('30');
        expect(sale.getProperty('fwd_sale_price')).toBe('30');
        expect(sale.getProperty('gain_amount')).toBeUndefined();
        expect(sale.getProperty('gain_amount_hist')).toBeUndefined();
        expect(sale.getProperty('purchase_log')).toBeUndefined();
        expect(await sale.getCreditAccount()).toBe(fixture.instrument);
        expect(await sale.getDebitAccount()).toBe(fixture.sell);

        expect(amount(purchase)).toBe('5');
        expect(purchase.getProperty('purchase_price')).toBe('10');
        expect(purchase.getProperty('fwd_purchase_price')).toBe('10');
        expect(purchase.getProperty('sale_date')).toBeUndefined();
        expect(purchase.getProperty('fwd_sale_price')).toBeUndefined();
        expect(await purchase.getCreditAccount()).toBe(fixture.buy);
        expect(await purchase.getDebitAccount()).toBe(fixture.instrument);

        expect(sale.isChecked()).toBe(false);
        expect(purchase.isChecked()).toBe(false);
        expect(unrelated.isChecked()).toBe(false);
        expect(calls[1]?.transactions.every(transaction => transaction.isChecked() === false)).toBe(
            true
        );
        expect(calls[2]?.transactions.every(transaction => transaction.isChecked() === false)).toBe(
            true
        );
        expect(calls[3]?.transactions.every(transaction => transaction.isChecked() === false)).toBe(
            true
        );
        expect(fixture.account.getProperty('needs_rebuild')).toBeUndefined();
        expect(fixture.account.getProperty('realized_date')).toBe('2025-03-31');
        expect(fixture.account.getProperty('forwarded_date')).toBe('2025-03-31');
    });

    test('deletes the realized date when regular Reset has no forwarded date', async () => {
        const fixture = createBooks();
        fixture.account.deleteProperty('forwarded_date');
        fixture.portfolioBook.listTransactions = async () =>
            transactionPage(fixture.portfolioBook, []);
        let accountUpdates = 0;
        fixture.account.update = async () => {
            accountUpdates++;
            return fixture.account;
        };

        const result = await new ResetRealizedResultsService().resetRealizedResultsForAccountAsync(
            fixture.portfolioBook,
            fixture.stockAccount,
            false,
            fixture.financialBook,
            fixture.baseBook
        );

        expect(result).toBeInstanceOf(Summary);
        expect(result.getMessage()).toBe('Reseting async...');
        expect(accountUpdates).toBe(1);
        expect(fixture.account.getProperty('needs_rebuild')).toBeUndefined();
        expect(fixture.account.getProperty('realized_date')).toBeUndefined();
    });

    test('restores historical Transaction and Account state during Full Reset', async () => {
        const fixture = createBooks();
        fixture.account
            .setProperty('forwarded_exc_rate', '1.25')
            .setProperty('forwarded_price', '30');
        const historicalSale = createTransaction(fixture.portfolioBook, 'historical-sale', {
            original_amount: '70',
            order: 'current-order',
            hist_order: 'historical-order',
            hist_quantity: '7',
            date: '2024-03-15',
            fwd_purchase_price: '8',
            fwd_sale_price: '10',
            fwd_purchase_exc_rate: '1.1',
            fwd_sale_exc_rate: '1.2',
            fwd_log: 'forward-log-id',
        });
        historicalSale.setDate('2025-03-31');
        setMovement(historicalSale, fixture.instrument, fixture.sell);

        let sourceQuery: string | undefined;
        fixture.portfolioBook.listTransactions = async query => {
            sourceQuery = query;
            return transactionPage(fixture.portfolioBook, [historicalSale]);
        };
        fixture.financialBook.listTransactions = async () =>
            transactionPage(fixture.financialBook, []);
        fixture.baseBook.listTransactions = async () => transactionPage(fixture.baseBook, []);

        const calls: BatchCall[] = [];
        fixture.portfolioBook.batchUpdateTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'portfolio-update', transactions, includeChecked });
            return transactions;
        };
        fixture.account.update = async () => {
            calls.push({ phase: 'account-update', transactions: [], includeChecked: undefined });
            return fixture.account;
        };

        const result = await new ResetRealizedResultsService().resetRealizedResultsForAccountAsync(
            fixture.portfolioBook,
            fixture.stockAccount,
            true,
            fixture.financialBook,
            fixture.baseBook
        );

        expect(result).toBeInstanceOf(Summary);
        expect(result.getMessage()).toBe('Reseting async...');
        expect(sourceQuery).toBe("account:'Instrument'");
        expect(calls.map(call => call.phase)).toEqual(['portfolio-update', 'account-update']);
        expect(calls[0]).toEqual({
            phase: 'portfolio-update',
            transactions: [historicalSale],
            includeChecked: true,
        });

        expect(historicalSale.getDate()).toBe('2024-03-15');
        expect(amount(historicalSale)).toBe('7');
        expect(historicalSale.getProperty('order')).toBe('historical-order');
        expect(historicalSale.getProperty('original_quantity')).toBe('7');
        expect(historicalSale.getProperty('sale_price')).toBe('10');
        for (const property of [
            'date',
            'hist_order',
            'hist_quantity',
            'fwd_purchase_price',
            'fwd_sale_price',
            'fwd_purchase_exc_rate',
            'fwd_sale_exc_rate',
            'fwd_log',
        ]) {
            expect(historicalSale.getProperty(property)).toBeUndefined();
        }
        expect(await historicalSale.getCreditAccount()).toBe(fixture.instrument);
        expect(await historicalSale.getDebitAccount()).toBe(fixture.sell);

        expect(fixture.account.getProperty('needs_rebuild')).toBeUndefined();
        expect(fixture.account.getProperty('realized_date')).toBeUndefined();
        expect(fixture.account.getProperty('forwarded_date')).toBeUndefined();
        expect(fixture.account.getProperty('forwarded_exc_rate')).toBeUndefined();
        expect(fixture.account.getProperty('forwarded_price')).toBeUndefined();
    });

    test('performs no Book or Account write when any queued Transaction is locked', async () => {
        const fixture = createBooks();
        const lockedSale = createTransaction(fixture.portfolioBook, 'locked-sale', {
            original_quantity: '2',
        });
        lockedSale.isLocked = () => true;
        setMovement(lockedSale, fixture.instrument, fixture.sell);
        fixture.portfolioBook.listTransactions = async () =>
            transactionPage(fixture.portfolioBook, [lockedSale]);

        fixture.portfolioBook.batchUpdateTransactions = async () => {
            throw new Error('Unexpected Portfolio update');
        };
        fixture.portfolioBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Portfolio trash');
        };
        fixture.financialBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Financial trash');
        };
        fixture.baseBook.batchTrashTransactions = async () => {
            throw new Error('Unexpected Base trash');
        };
        fixture.account.update = async () => {
            throw new Error('Unexpected Account update');
        };

        const result = await new ResetRealizedResultsService().resetRealizedResultsForAccountAsync(
            fixture.portfolioBook,
            fixture.stockAccount,
            false,
            fixture.financialBook,
            fixture.baseBook
        );

        expect(result).toBeInstanceOf(Summary);
        expect(result.getMessage()).toBe('Cannot proceed: collection has locked/closed book(s)');
        expect(fixture.account.getProperty('needs_rebuild')).toBe('true');
        expect(fixture.account.getProperty('realized_date')).toBe('2025-05-31');
    });
});
