import { afterEach, describe, expect, test } from 'bun:test';
import {
    Account,
    AccountType,
    BalancesReport,
    Book,
    Permission,
    Transaction,
    TransactionList,
} from 'bkper-js';
import { ForwardDateService } from '../../../../src/api/services/forward/forward-date-service.js';
import type { OperationContext } from '../../../../src/api/services/operation-service.js';
import { ResetRealizedResultsService } from '../../../../src/api/services/reset/reset-realized-results-service.js';
import { StockAccount } from '../../../../src/api/services/stock-account.js';
import { Summary, SummaryState } from '../../../../src/api/services/summary.js';

const originalCreate = Transaction.prototype.create;
const originalPost = Transaction.prototype.post;
const originalSequentialReset = ResetRealizedResultsService.prototype.executeSync;

afterEach(() => {
    Transaction.prototype.create = originalCreate;
    Transaction.prototype.post = originalPost;
    ResetRealizedResultsService.prototype.executeSync = originalSequentialReset;
});

function createBook(payload: Partial<bkper.Book>): Book {
    return new Book({
        id: 'book',
        fractionDigits: 2,
        decimalSeparator: 'DOT',
        datePattern: 'yyyy-MM-dd',
        timeZone: 'UTC',
        ...payload,
    });
}

function balances(book: Book, name: string, cumulativeBalance: string): BalancesReport {
    const normalizedName = name.toLowerCase().replaceAll(' ', '_');
    return new BalancesReport(book, {
        accountBalances: [{ name, normalizedName, cumulativeBalance }],
    });
}

async function embeddedAccounts(book: Book): Promise<Account[]> {
    const accounts = await book.getAccounts();
    book.getAccount = async idOrName =>
        accounts.find(account => account.getId() === idOrName || account.getName() === idOrName);
    return accounts;
}

async function movementAccounts(
    transaction: Transaction
): Promise<{ from: string | undefined; to: string | undefined }> {
    return {
        from: (await transaction.getCreditAccount())?.getName(),
        to: (await transaction.getDebitAccount())?.getName(),
    };
}

async function createContext(): Promise<{
    context: OperationContext;
    instrument: Account;
    portfolioBook: Book;
    financialBook: Book;
    baseBook: Book;
    purchase: Transaction;
    sale: Transaction;
}> {
    const portfolioBook = createBook({
        id: 'portfolio-book',
        fractionDigits: 0,
        permission: Permission.OWNER,
        collection: {
            books: [{ id: 'portfolio-book' }, { id: 'financial-book' }, { id: 'base-book' }],
        },
        groups: [{ id: 'eur-group', properties: { stock_exc_code: 'EUR' } }],
        accounts: [
            { id: 'buy', name: 'Buy', type: AccountType.INCOMING, permanent: false },
            { id: 'sell', name: 'Sell', type: AccountType.OUTGOING, permanent: false },
            {
                id: 'instrument',
                name: 'Instrument',
                type: AccountType.ASSET,
                permanent: true,
                groups: [{ id: 'eur-group' }],
                properties: { forwarded_date: '2025-01-01' },
            },
            {
                id: 'other',
                name: 'Other',
                type: AccountType.ASSET,
                permanent: true,
                groups: [{ id: 'eur-group' }],
                properties: { forwarded_date: '2026-09-01' },
            },
        ],
    });
    const portfolioAccounts = await embeddedAccounts(portfolioBook);
    const buy = portfolioAccounts.find(account => account.getId() === 'buy')!;
    const sell = portfolioAccounts.find(account => account.getId() === 'sell')!;
    const instrument = portfolioAccounts.find(account => account.getId() === 'instrument')!;

    const financialBook = createBook({
        id: 'financial-book',
        properties: { exc_code: 'EUR' },
        collection: {
            books: [
                { id: 'base-book', properties: { exc_base: 'true', exc_code: 'USD' } },
                { id: 'financial-book', properties: { exc_code: 'EUR' } },
            ],
        },
        accounts: [
            {
                id: 'unrealized',
                name: 'Instrument Unrealized',
                type: AccountType.ASSET,
            },
            {
                id: 'forwarded',
                name: 'Instrument Forwarded',
                type: AccountType.LIABILITY,
            },
        ],
    });
    await embeddedAccounts(financialBook);
    const baseBook = createBook({
        id: 'base-book',
        properties: { exc_code: 'USD' },
    });

    const purchase = new Transaction(portfolioBook, {
        id: 'purchase',
        amount: '4',
        date: '2026-01-10',
        dateValue: 20260110,
        description: 'Purchase',
        posted: true,
        creditAccount: { id: 'buy' },
        debitAccount: { id: 'instrument' },
        remoteIds: ['financial-purchase'],
        properties: {
            original_amount: '40',
            original_quantity: '4',
            order: '5',
            source: 'purchase-source',
        },
    });
    purchase.getCreditAccount = async () => buy;
    purchase.getDebitAccount = async () => instrument;

    const sale = new Transaction(portfolioBook, {
        id: 'sale',
        amount: '1',
        date: '2026-02-10',
        dateValue: 20260210,
        description: 'Sale',
        posted: true,
        creditAccount: { id: 'instrument' },
        debitAccount: { id: 'sell' },
        remoteIds: ['financial-sale'],
        properties: {
            original_amount: '10',
            original_quantity: '1',
            order: '6',
            source: 'sale-source',
        },
    });
    sale.getCreditAccount = async () => instrument;
    sale.getDebitAccount = async () => sell;

    return {
        context: { portfolioBook, portfolioAccount: instrument, financialBook, baseBook },
        instrument,
        portfolioBook,
        financialBook,
        baseBook,
        purchase,
        sale,
    };
}

describe('legacy regular Forward Date behavior', () => {
    test('preserves the ordered logs, liquidation, forwarded result, Account state, and closing date', async () => {
        const fixture = await createContext();
        const service = new ForwardDateService();
        const calls: string[] = [];
        const posted: Transaction[] = [];
        const created: Transaction[] = [];
        let checked: Transaction[] = [];
        let nextLog = 1;

        fixture.portfolioBook.getBalancesReport = async query => {
            calls.push(`balance:portfolio:${query}`);
            return balances(fixture.portfolioBook, 'Instrument', '3');
        };
        fixture.baseBook.getBalancesReport = async query => {
            calls.push(`balance:base:${query}`);
            return balances(
                fixture.baseBook,
                query.includes('Unrealized') ? 'Instrument Unrealized' : 'Instrument',
                query.includes('Unrealized') ? '6' : '36'
            );
        };
        fixture.financialBook.getBalancesReport = async query => {
            calls.push(`balance:financial:${query}`);
            return balances(
                fixture.financialBook,
                query.includes('Unrealized') ? 'Instrument Unrealized' : 'Instrument',
                query.includes('Unrealized') ? '5' : '30'
            );
        };
        fixture.portfolioBook.listTransactions = async query => {
            calls.push(`list:${query}`);
            const page = new TransactionList(fixture.portfolioBook, { items: [] });
            page.getItems = () => [fixture.sale, fixture.purchase];
            return page;
        };
        fixture.purchase.update = async () => {
            calls.push('update:purchase');
            return fixture.purchase;
        };
        fixture.sale.update = async () => {
            calls.push('update:sale');
            return fixture.sale;
        };
        Transaction.prototype.post = async function () {
            const id = this.getProperty('fwd_tx') ? `log-${nextLog++}` : 'liquidation';
            this.getId = () => id;
            calls.push(`post:${id}`);
            posted.push(this);
            return this;
        };
        fixture.portfolioBook.batchCheckTransactions = async transactions => {
            calls.push('check');
            checked = transactions;
        };
        Transaction.prototype.create = async function () {
            calls.push('create:forwarded-result');
            created.push(this);
            return this;
        };
        fixture.instrument.update = async () => {
            calls.push('update:account');
            return fixture.instrument;
        };
        service['delay'] = async milliseconds => {
            calls.push(`delay:${milliseconds}`);
        };
        fixture.portfolioBook.update = async () => {
            calls.push('update:book');
            return fixture.portfolioBook;
        };

        const summary = await service['forwardDateForAccount'](
            fixture.context,
            '2026-09-01',
            false
        );

        expect(calls).toEqual([
            "balance:portfolio:account:'Instrument' on:2026-08-31",
            "balance:base:account:'Instrument' on:2026-08-31",
            "balance:financial:account:'Instrument' on:2026-08-31",
            "list:account:'Instrument' before:2026-09-01",
            'post:log-1',
            'update:purchase',
            'post:log-2',
            'update:sale',
            'post:liquidation',
            'check',
            "balance:financial:account:'Instrument Unrealized' after:2025-01-01 before:2026-09-01",
            "balance:base:account:'Instrument Unrealized' after:2025-01-01 before:2026-09-01",
            'create:forwarded-result',
            'update:account',
            'delay:5000',
            'update:book',
        ]);
        expect(posted).toHaveLength(3);
        expect(checked).toEqual(posted);

        const [purchaseLog, saleLog, liquidation] = posted;
        expect(purchaseLog?.getProperty('fwd_tx')).toBe('purchase');
        expect(purchaseLog?.getProperty('fwd_tx_remote_ids')).toBe(
            JSON.stringify(['financial-purchase'])
        );
        expect(purchaseLog?.getProperty('source')).toBe('purchase-source');
        expect(await movementAccounts(purchaseLog!)).toEqual({ from: 'Buy', to: 'Instrument' });
        expect(saleLog?.getProperty('fwd_tx')).toBe('sale');
        expect(await movementAccounts(saleLog!)).toEqual({ from: 'Instrument', to: 'Sell' });

        expect(liquidation?.getAmount()?.toString()).toBe('3');
        expect(liquidation?.getDate()).toBe('2026-08-31');
        expect(liquidation?.getProperty('fwd_liquidation')).toBe(
            JSON.stringify(['log-1', 'log-2'])
        );
        expect(await movementAccounts(liquidation!)).toEqual({
            from: 'Buy',
            to: 'Instrument',
        });

        expect(fixture.purchase.getDate()).toBe('2026-09-01');
        expect(fixture.purchase.getProperty('date')).toBe('2026-01-10');
        expect(fixture.purchase.getProperty('hist_quantity')).toBe('4');
        expect(fixture.purchase.getProperty('hist_order')).toBe('5');
        expect(fixture.purchase.getProperty('original_amount')).toBeUndefined();
        expect(fixture.purchase.getProperty('original_quantity')).toBe('4');
        expect(fixture.purchase.getProperty('order')).toBe('-2');
        expect(fixture.purchase.getProperty('fwd_log')).toBe('log-1');
        expect(fixture.purchase.getProperty('fwd_purchase_price')).toBe('10');
        expect(fixture.purchase.getProperty('fwd_purchase_exc_rate')).toBe('1.2');
        expect(fixture.sale.getProperty('fwd_sale_price')).toBe('10');
        expect(fixture.sale.getProperty('fwd_sale_exc_rate')).toBe('1.2');
        expect(fixture.sale.getProperty('order')).toBe('-1');
        expect(fixture.sale.getProperty('fwd_log')).toBe('log-2');

        expect(created).toHaveLength(1);
        expect(created[0]?.getAmount()?.toString()).toBe('5');
        expect(created[0]?.getDate()).toBe('2026-08-31');
        expect(created[0]?.getDescription()).toBe('#stock_gain_fwd');
        expect(created[0]?.getRemoteIds()).toEqual(['fwd_liquidation']);
        expect(created[0]?.isChecked()).toBe(true);
        expect(created[0]?.getProperty('exc_amount')).toBe('6');
        expect(created[0]?.getProperty('exc_code')).toBe('USD');
        expect(await movementAccounts(created[0]!)).toEqual({
            from: 'Instrument Forwarded',
            to: 'Instrument Unrealized',
        });

        expect(fixture.instrument.getProperty('realized_date')).toBe('2026-09-01');
        expect(fixture.instrument.getProperty('forwarded_date')).toBe('2026-09-01');
        expect(fixture.instrument.getProperty('forwarded_price')).toBe('10');
        expect(fixture.instrument.getProperty('forwarded_exc_rate')).toBe('1.2');
        expect(fixture.portfolioBook.getClosingDate()).toBe('2026-08-31');
        expect(summary.getState()).toBe(SummaryState.DONE);
        expect(summary.getMessage()).toBe(
            'Done! 2 forwarded to 2026-09-01 and book closed on 2026-08-31'
        );
    });

    test('recovers a short open quantity from the previous liquidation while fixing Forward', async () => {
        const fixture = await createContext();
        const service = new ForwardDateService();
        const accounts = await fixture.portfolioBook.getAccounts();
        const instrument = accounts.find(account => account.getId() === 'instrument')!;
        const sell = accounts.find(account => account.getId() === 'sell')!;
        const previousLiquidation = new Transaction(fixture.portfolioBook, {
            id: 'previous-liquidation',
            amount: '2',
            date: '2026-08-31',
            posted: true,
            creditAccount: { id: 'instrument' },
            debitAccount: { id: 'sell' },
            properties: { fwd_liquidation: '[]' },
        });
        previousLiquidation.getCreditAccount = async () => instrument;
        previousLiquidation.getDebitAccount = async () => sell;
        const queries: string[] = [];
        let checked: Transaction[] | undefined;
        let accountUpdates = 0;

        fixture.portfolioBook.getBalancesReport = async () =>
            balances(fixture.portfolioBook, 'Instrument', '0');
        fixture.baseBook.getBalancesReport = async query =>
            balances(fixture.baseBook, 'Instrument', query.includes('Unrealized') ? '0' : '-20');
        fixture.financialBook.getBalancesReport = async query =>
            balances(
                fixture.financialBook,
                query.includes('Unrealized') ? 'Instrument Unrealized' : 'Instrument',
                query.includes('Unrealized') ? '0' : '-20'
            );
        fixture.portfolioBook.listTransactions = async query => {
            if (!query) {
                throw new Error('Expected a Forward Transaction query');
            }
            queries.push(query);
            const page = new TransactionList(fixture.portfolioBook, { items: [] });
            page.getItems = () => (query.includes(' on:') ? [previousLiquidation] : []);
            return page;
        };
        Transaction.prototype.post = async function () {
            throw new Error('A replacement liquidation must not be posted');
        };
        Transaction.prototype.create = async function () {
            throw new Error('A Forwarded Result must not be created without a new liquidation');
        };
        fixture.portfolioBook.batchCheckTransactions = async transactions => {
            checked = transactions;
        };
        fixture.instrument.update = async () => {
            accountUpdates++;
            return fixture.instrument;
        };
        service['delay'] = async () => {
            throw new Error('The Portfolio Book must remain open');
        };

        const other = accounts.find(account => account.getId() === 'other')!;
        other.setProperty('forwarded_date', '2025-01-01');
        const summary = await service['forwardDateForAccount'](fixture.context, '2026-09-01', true);

        expect(queries).toEqual([
            "account:'Instrument' on:2026-08-31",
            "account:'Instrument' before:2026-09-01",
        ]);
        expect(checked).toEqual([]);
        expect(accountUpdates).toBe(1);
        expect(fixture.instrument.getProperty('forwarded_price')).toBe('10');
        expect(fixture.instrument.getProperty('forwarded_exc_rate')).toBe('1');
        expect(fixture.portfolioBook.getClosingDate()).toBeUndefined();
        expect(summary.getMessage()).toBe('Done! 0 forwarded to 2026-09-01');
    });

    test('preserves legacy continuation when posted Forward Transactions have no id', async () => {
        const fixture = await createContext();
        const service = new ForwardDateService();
        const posted: Transaction[] = [];
        let checked: Transaction[] = [];
        const accounts = await fixture.portfolioBook.getAccounts();
        const other = accounts.find(account => account.getId() === 'other')!;
        other.setProperty('forwarded_date', '2025-01-01');

        fixture.portfolioBook.getBalancesReport = async () =>
            balances(fixture.portfolioBook, 'Instrument', '1');
        fixture.baseBook.getBalancesReport = async query =>
            balances(
                fixture.baseBook,
                query.includes('Unrealized') ? 'Instrument Unrealized' : 'Instrument',
                query.includes('Unrealized') ? '0' : '10'
            );
        fixture.financialBook.getBalancesReport = async query =>
            balances(
                fixture.financialBook,
                query.includes('Unrealized') ? 'Instrument Unrealized' : 'Instrument',
                query.includes('Unrealized') ? '0' : '10'
            );
        fixture.portfolioBook.listTransactions = async () => {
            const page = new TransactionList(fixture.portfolioBook, { items: [] });
            page.getItems = () => [fixture.purchase];
            return page;
        };
        fixture.purchase.update = async () => fixture.purchase;
        Transaction.prototype.post = async function () {
            posted.push(this);
            return this;
        };
        Transaction.prototype.create = async function () {
            throw new Error('A Forwarded Result must not be created without a liquidation id');
        };
        fixture.portfolioBook.batchCheckTransactions = async transactions => {
            checked = transactions;
        };
        fixture.instrument.update = async () => fixture.instrument;
        service['delay'] = async () => {
            throw new Error('The Portfolio Book must remain open');
        };

        const summary = await service['forwardDateForAccount'](
            fixture.context,
            '2026-09-01',
            false
        );

        expect(posted).toHaveLength(2);
        expect(checked).toEqual(posted);
        expect(posted[1]?.getProperty('fwd_liquidation')).toBe('[null]');
        expect(summary.getMessage()).toBe('Done! 1 forwarded to 2026-09-01');
    });

    test('preserves the legacy missing-amount failure before updating the source', async () => {
        const fixture = await createContext();
        fixture.purchase.setAmount(0);
        let updates = 0;
        fixture.purchase.update = async () => {
            updates++;
            return fixture.purchase;
        };

        const operation = new ForwardDateService()['forwardTransaction'](
            fixture.purchase,
            new Transaction(fixture.portfolioBook),
            'EUR',
            'EUR',
            undefined,
            undefined,
            '2026-09-01',
            -1
        );

        await expect(operation).rejects.toThrow();
        expect(updates).toBe(0);
    });

    test('keeps an incomplete source log non-balance-affecting', async () => {
        const fixture = await createContext();
        const incomplete = new Transaction(fixture.portfolioBook, {
            id: 'incomplete',
            creditAccount: { id: 'instrument' },
        });
        incomplete.getCreditAccount = async () => fixture.instrument;
        incomplete.getDebitAccount = async () => undefined;

        const log = await new ForwardDateService()['buildLogTransaction'](
            fixture.portfolioBook,
            incomplete
        );

        expect(log.getAmount()).toBeUndefined();
        expect(log.getDate()).toBeUndefined();
        expect((await log.getCreditAccount())?.getId()).toBe('instrument');
        expect(await log.getDebitAccount()).toBeUndefined();
    });

    test('returns before any read or write when the Account needs rebuild', async () => {
        const fixture = await createContext();
        fixture.instrument.setProperty('needs_rebuild', 'TRUE');
        fixture.portfolioBook.getBalancesReport = async () => {
            throw new Error('Balances must not be loaded');
        };

        const summary = await new ForwardDateService()['forwardDateForAccount'](
            fixture.context,
            '2026-09-01',
            false
        );

        expect(summary.getState()).toBe(SummaryState.FORWARD_ERROR);
        expect(summary.getMessage()).toBe('Cannot set forward date: account needs rebuild');
    });
});

describe('legacy lower Forward Date repair behavior', () => {
    test('resets, restores recursive Forward history, cleans it, resets the requested range, and re-forwards in order', async () => {
        const fixture = await createContext();
        const service = new ForwardDateService();
        const stockAccount = new StockAccount(fixture.instrument);
        const calls: string[] = [];

        const transaction = new Transaction(fixture.portfolioBook, {
            id: 'forwarded-transaction',
            date: '2026-09-01',
            dateValue: 20260901,
            posted: true,
            properties: {
                fwd_log: 'latest-log',
                fwd_tx: 'current-source',
                fwd_tx_remote_ids: '["current-remote"]',
                state: 'current',
            },
        });
        const latestLog = new Transaction(fixture.portfolioBook, {
            id: 'latest-log',
            date: '2026-05-01',
            dateValue: 20260501,
            posted: true,
            checked: true,
            properties: { fwd_log: 'previous-log', state: 'latest' },
        });
        const previousLog = new Transaction(fixture.portfolioBook, {
            id: 'previous-log',
            date: '2026-02-01',
            dateValue: 20260201,
            posted: true,
            properties: { state: 'previous' },
        });
        const resetTransaction = new Transaction(fixture.portfolioBook, {
            id: 'reset-transaction',
        });

        fixture.portfolioBook.listTransactions = async query => {
            calls.push(`list:${query}`);
            const page = new TransactionList(fixture.portfolioBook, { items: [] });
            page.getItems = () =>
                query === "account:'Instrument' after:2025-01-01"
                    ? [transaction]
                    : [resetTransaction];
            return page;
        };
        fixture.portfolioBook.getTransaction = async id => {
            calls.push(`get:${id}`);
            return id === 'latest-log' ? latestLog : previousLog;
        };
        transaction.update = async () => {
            calls.push('update:forwarded-transaction');
            return transaction;
        };
        latestLog.uncheck = async () => {
            calls.push('uncheck:latest-log');
            latestLog.setChecked(false);
            return latestLog;
        };
        latestLog.trash = async () => {
            calls.push('trash:latest-log');
            return latestLog;
        };
        previousLog.trash = async () => {
            calls.push('trash:previous-log');
            return previousLog;
        };

        ResetRealizedResultsService.prototype.executeSync = async (
            _context,
            _stockAccount,
            _full,
            resetIterator
        ) => {
            calls.push(
                resetIterator
                    ? `reset:${resetIterator.map(tx => tx.getId()).join(',')}`
                    : 'reset:current-forward'
            );
            return new Summary().done();
        };
        service['forwardDateForAccount'] = async (_context, forwardDate, fixingForward) => {
            calls.push(`forward:${forwardDate}:${fixingForward}`);
            return new Summary().done('Done! 2 forwarded to 2026-03-01');
        };

        const summary = await service['fixAndForwardDateForAccount'](
            fixture.context,
            stockAccount,
            '2026-03-01'
        );

        expect(calls).toEqual([
            'reset:current-forward',
            "list:account:'Instrument' after:2025-01-01",
            'get:latest-log',
            'get:previous-log',
            'update:forwarded-transaction',
            'uncheck:latest-log',
            'trash:latest-log',
            'trash:previous-log',
            "list:account:'Instrument' after:2026-03-01",
            'reset:reset-transaction',
            'forward:2026-03-01:true',
        ]);
        expect(transaction.getDate()).toBe('2026-02-01');
        expect(transaction.getProperty('state')).toBe('previous');
        expect(transaction.getProperty('fwd_tx')).toBeUndefined();
        expect(transaction.getProperty('fwd_tx_remote_ids')).toBeUndefined();
        expect(summary.getState()).toBe(SummaryState.DONE);
        expect(summary.getMessage()).toBe('Done! 1 fixed and 2 forwarded to 2026-03-01');
    });

    test('requires ownership and an open and unlocked Collection before the first mutation', async () => {
        for (const scenario of [
            {
                prepare: (book: Book) => {
                    book.getPermission = () => Permission.EDITOR;
                },
                message: 'Cannot lower forward date: user must be book owner',
            },
            {
                prepare: (book: Book) => {
                    book.getCollection()!.getBooks()[1]!.setClosingDate('2026-02-28');
                },
                message: 'Cannot lower forward date: collection has locked/closed book(s)',
            },
        ]) {
            const fixture = await createContext();
            scenario.prepare(fixture.portfolioBook);
            ResetRealizedResultsService.prototype.executeSync = async () => {
                throw new Error('Reset must not begin');
            };

            const summary = await new ForwardDateService()['fixAndForwardDateForAccount'](
                fixture.context,
                new StockAccount(fixture.instrument),
                '2026-03-01'
            );

            expect(summary.getState()).toBe(SummaryState.FORWARD_ERROR);
            expect(summary.getMessage()).toBe(scenario.message);
        }
    });
});
