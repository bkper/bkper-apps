import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Amount, BalancesReport, Book, Transaction } from 'bkper-js';
import { CalculateRealizedResultsProcessor } from '../../../../src/api/services/calculate/calculate-realized-results-processor.js';
import { CalculateRealizedResultsSupport } from '../../../../src/api/services/calculate/calculate-realized-results-support.js';
import { StockAccount } from '../../../../src/api/services/stock-account.js';
import { Summary } from '../../../../src/api/services/summary.js';

const originalAccountCreate = Account.prototype.create;

afterEach(() => {
    Account.prototype.create = originalAccountCreate;
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

function createProcessor(
    portfolioBook: Book,
    financialBook: Book,
    baseBook: Book
): CalculateRealizedResultsProcessor {
    return new CalculateRealizedResultsProcessor(portfolioBook, financialBook, baseBook);
}

function createTransaction(
    book: Book,
    id: string,
    date: string,
    properties: Record<string, string> = {}
): Transaction {
    return new Transaction(book, {
        id,
        date,
        dateValue: +date.replaceAll('-', ''),
        amount: '1',
        posted: true,
        properties,
    });
}

async function useEmbeddedAccounts(book: Book): Promise<Account[]> {
    const accounts = await book.getAccounts();
    book.getAccount = async idOrName =>
        accounts.find(account => account.getId() === idOrName || account.getName() === idOrName);
    return accounts;
}

function balances(book: Book, name: string, cumulativeBalance: string): BalancesReport {
    return new BalancesReport(book, {
        accountBalances: [{ name, cumulativeBalance }],
    });
}

async function movementAccounts(
    transaction: Transaction
): Promise<{ from: string | undefined; to: string | undefined }> {
    return {
        from: (await transaction.getCreditAccount())?.getName(),
        to: (await transaction.getDebitAccount())?.getName(),
    };
}

describe('legacy Calculate support behavior', () => {
    test('records logs, missing exchange rates, FIFO identity, and the latest Account date', async () => {
        const service = new CalculateRealizedResultsSupport();
        const portfolioBook = createBook({ id: 'portfolio', fractionDigits: 0 });
        const financialBook = createBook({
            id: 'financial',
            properties: { exc_code: 'EUR' },
            collection: {
                books: [
                    { id: 'base', properties: { exc_base: 'true', exc_code: 'USD' } },
                    { id: 'financial', properties: { exc_code: 'EUR' } },
                ],
            },
        });
        const baseBook = createBook({ id: 'base', properties: { exc_code: 'USD' } });
        const transaction = createTransaction(portfolioBook, 'sale', '2025-02-01', {
            date: '2025-01-31',
            trade_exc_rate_hist: '1.2',
            trade_exc_rate: '1.3',
        });
        transaction.setAmount('4');
        const processor = createProcessor(portfolioBook, financialBook, baseBook);
        let updated: Transaction[] = [];
        portfolioBook.batchUpdateTransactions = async transactions => {
            updated = transactions;
            return transactions;
        };

        await service.checkAndRecordExchangeRates(
            baseBook,
            financialBook,
            [transaction],
            [],
            processor
        );
        await processor.fireBatchOperations();

        expect(updated).toEqual([transaction]);
        expect(transaction.getProperty('sale_exc_rate')).toBe('1.2');
        expect(transaction.getProperty('fwd_sale_exc_rate')).toBe('1.3');
        expect(service.logLiquidation(transaction, new Amount(10), new Amount('1.2'))).toEqual({
            id: 'sale',
            dt: '2025-02-01',
            qt: '4',
            pr: '10',
            rt: '1.2',
        });
        expect(
            service.logPurchase(
                portfolioBook,
                new Amount(2),
                new Amount(9),
                transaction,
                new Amount('1.1')
            )
        ).toEqual({ qt: '2', pr: '9', dt: '2025-01-31', rt: '1.1' });
        const account = new Account(portfolioBook, {
            id: 'instrument',
            name: 'Instrument',
            properties: { realized_date: '2025-01-01' },
        });
        let accountUpdates = 0;
        account.update = async () => {
            accountUpdates++;
            return account;
        };
        const stockAccount = new StockAccount(account);
        const purchase = createTransaction(portfolioBook, 'purchase', '2025-03-01');

        await service.checkLastTxDate(stockAccount, [transaction], [purchase]);

        expect(accountUpdates).toBe(1);
        expect(account.getProperty('realized_date')).toBe('2025-03-01');
        expect(service.getLastTransactionId([transaction], [purchase])).toBe('purchase');
        expect(service.isShortSale(purchase, transaction)).toBe(true);
    });

    test('queues complete realized gain, loss, and historical movements', async () => {
        const service = new CalculateRealizedResultsSupport();
        const portfolioBook = createBook({ id: 'portfolio' });
        const baseBook = createBook({ id: 'base', properties: { exc_code: 'USD' } });
        const financialBook = createBook({
            id: 'financial',
            properties: { exc_code: 'EUR' },
            collection: {
                books: [
                    { id: 'base', properties: { exc_base: 'true', exc_code: 'USD' } },
                    { id: 'financial', properties: { exc_code: 'EUR' } },
                ],
            },
            accounts: [
                { id: 'gain', name: 'Instrument Realized Gain', type: AccountType.INCOMING },
                { id: 'loss', name: 'Instrument Realized Loss', type: AccountType.INCOMING },
                { id: 'hist', name: 'Instrument Realized Hist', type: AccountType.INCOMING },
                { id: 'unrealized', name: 'Instrument Unrealized', type: AccountType.ASSET },
            ],
        });
        const stockAccount = new StockAccount(
            new Account(portfolioBook, { id: 'instrument', name: 'Instrument' })
        );
        await useEmbeddedAccounts(financialBook);
        const unrealizedAccount = (await financialBook.getAccount('Instrument Unrealized'))!;
        const processor = createProcessor(portfolioBook, financialBook, baseBook);
        const created: Transaction[] = [];
        financialBook.batchCreateTransactions = async transactions => {
            created.push(...transactions);
            return transactions;
        };

        await service.addRealizedResult(
            baseBook,
            stockAccount,
            financialBook,
            unrealizedAccount,
            createTransaction(portfolioBook, 'gain-source', '2025-01-01'),
            new Amount(5),
            new Amount(6),
            false,
            processor
        );
        await service.addRealizedResult(
            baseBook,
            stockAccount,
            financialBook,
            unrealizedAccount,
            createTransaction(portfolioBook, 'loss-source', '2025-01-02'),
            new Amount(-3),
            new Amount(-4),
            false,
            processor
        );
        await service.addRealizedResult(
            baseBook,
            stockAccount,
            financialBook,
            unrealizedAccount,
            createTransaction(portfolioBook, 'hist-source', '2025-01-03'),
            new Amount(2),
            new Amount(2),
            true,
            processor
        );
        await service.addRealizedResult(
            baseBook,
            stockAccount,
            financialBook,
            unrealizedAccount,
            createTransaction(portfolioBook, 'zero-source', '2025-01-04'),
            new Amount(0),
            new Amount(0),
            false,
            processor
        );
        await processor.fireBatchOperations();

        expect(created.map(transaction => transaction.getRemoteIds()[0])).toEqual([
            'gain-source',
            'loss-source',
            'hist_hist-source',
        ]);
        expect(created.map(transaction => transaction.getAmount()?.toString())).toEqual([
            '5',
            '3',
            '2',
        ]);
        expect(await movementAccounts(created[0]!)).toEqual({
            from: 'Instrument Realized Gain',
            to: 'Instrument Unrealized',
        });
        expect(await movementAccounts(created[1]!)).toEqual({
            from: 'Instrument Unrealized',
            to: 'Instrument Realized Loss',
        });
        expect(await movementAccounts(created[2]!)).toEqual({
            from: 'Instrument Realized Hist',
            to: 'Instrument Unrealized',
        });
        expect(created.map(transaction => transaction.getDescription())).toEqual([
            '#stock_gain',
            '#stock_loss',
            '#stock_gain_hist',
        ]);
        expect(created[0]?.getProperty('exc_amount')).toBe('6');
        expect(created[0]?.getProperty('exc_code')).toBe('USD');
        expect(created.every(transaction => transaction.isChecked())).toBe(true);
    });

    test('infers and creates the established realized FX Account', async () => {
        const service = new CalculateRealizedResultsSupport();
        const baseBook = createBook({
            id: 'base',
            groups: [{ id: 'exchange-results', name: 'Exchange Results' }],
            accounts: [
                {
                    id: 'usd',
                    name: 'Exchange_USD',
                    type: AccountType.INCOMING,
                    groups: [{ id: 'exchange-results' }],
                },
                {
                    id: 'gbp',
                    name: 'Exchange_GBP',
                    type: AccountType.INCOMING,
                    groups: [{ id: 'exchange-results' }],
                },
            ],
        });
        const accounts = await useEmbeddedAccounts(baseBook);
        const groups = await baseBook.getGroups();
        groups[0]!.getAccounts = async () => accounts;
        for (const account of accounts) {
            account.isInGroup = async group =>
                typeof group !== 'string' && group.getId() === 'exchange-results';
        }
        let createdAccount: Account | undefined;
        Account.prototype.create = async function (): Promise<Account> {
            createdAccount = this;
            return this;
        };

        const account = await service.getRealizedFxAccount(baseBook, 'Exchange_EUR');

        expect(createdAccount).toBe(account);
        expect(account.getName()).toBe('Exchange_EUR');
        expect(account.getType()).toBe(AccountType.INCOMING);
        expect(account.json().groups?.map(group => group.id)).toEqual(['exchange-results']);
    });

    test('queues complete regular and historical FX gain and loss movements', async () => {
        const service = new CalculateRealizedResultsSupport();
        const portfolioBook = createBook({ id: 'portfolio' });
        const baseBook = createBook({
            id: 'base',
            properties: { exc_aggregate: 'true' },
            accounts: [
                { id: 'realized', name: 'Exchange_EUR', type: AccountType.INCOMING },
                { id: 'unrealized', name: 'Instrument Unrealized', type: AccountType.ASSET },
                {
                    id: 'realized-hist',
                    name: 'Exchange_EUR Hist',
                    type: AccountType.INCOMING,
                },
                {
                    id: 'unrealized-hist',
                    name: 'Instrument Unrealized Hist',
                    type: AccountType.ASSET,
                },
            ],
        });
        const financialBook = createBook({ id: 'financial' });
        const stockAccount = new StockAccount(
            new Account(portfolioBook, { id: 'instrument', name: 'Instrument' })
        );
        await useEmbeddedAccounts(baseBook);
        const unrealized = (await baseBook.getAccount('Instrument Unrealized'))!;
        const unrealizedHist = (await baseBook.getAccount('Instrument Unrealized Hist'))!;
        unrealized.getGroups = async () => [];
        unrealizedHist.getGroups = async () => [];
        const processor = createProcessor(portfolioBook, financialBook, baseBook);
        const created: Transaction[] = [];
        baseBook.batchCreateTransactions = async transactions => {
            created.push(...transactions);
            return transactions;
        };

        await service.addFxResult(
            stockAccount,
            'EUR',
            baseBook,
            unrealized,
            createTransaction(portfolioBook, 'gain-source', '2025-01-01'),
            new Amount(15),
            new Amount(10),
            new Summary(),
            false,
            processor
        );
        await service.addFxResult(
            stockAccount,
            'EUR',
            baseBook,
            unrealizedHist,
            createTransaction(portfolioBook, 'loss-source', '2025-01-02'),
            new Amount(5),
            new Amount(10),
            new Summary(),
            true,
            processor
        );
        await service.addFxResult(
            stockAccount,
            'EUR',
            baseBook,
            unrealized,
            createTransaction(portfolioBook, 'zero-source', '2025-01-03'),
            new Amount(10),
            new Amount(10),
            new Summary(),
            false,
            processor
        );
        await processor.fireBatchOperations();

        expect(created.map(transaction => transaction.getRemoteIds()[0])).toEqual([
            'fx_gain-source',
            'fx_hist_loss-source',
        ]);
        expect(created.map(transaction => transaction.getAmount()?.toString())).toEqual(['5', '5']);
        expect(await movementAccounts(created[0]!)).toEqual({
            from: 'Exchange_EUR',
            to: 'Instrument Unrealized',
        });
        expect(await movementAccounts(created[1]!)).toEqual({
            from: 'Instrument Unrealized Hist',
            to: 'Exchange_EUR Hist',
        });
        expect(created.map(transaction => transaction.getDescription())).toEqual([
            '#exchange_gain',
            '#exchange_loss_hist',
        ]);
        expect(created.every(transaction => transaction.getProperty('exc_amount') === '0')).toBe(
            true
        );
    });

    test('uses balances to queue complete MTM and interest-MTM movements', async () => {
        const service = new CalculateRealizedResultsSupport();
        const portfolioBook = createBook({ id: 'portfolio', fractionDigits: 0 });
        const financialBook = createBook({
            id: 'financial',
            accounts: [
                { id: 'instrument', name: 'Instrument', type: AccountType.ASSET },
                {
                    id: 'unrealized',
                    name: 'Instrument Unrealized',
                    type: AccountType.LIABILITY,
                },
                {
                    id: 'interest',
                    name: 'instrument interest',
                    type: AccountType.INCOMING,
                },
                {
                    id: 'interest-unrealized',
                    name: 'instrument interest Unrealized',
                    type: AccountType.LIABILITY,
                },
            ],
        });
        const baseBook = createBook({ id: 'base' });
        const portfolioAccount = new Account(portfolioBook, {
            id: 'portfolio-instrument',
            name: 'Instrument',
        });
        const stockAccount = new StockAccount(portfolioAccount);
        await useEmbeddedAccounts(financialBook);
        const unrealized = (await financialBook.getAccount('Instrument Unrealized'))!;
        const interest = (await financialBook.getAccount('instrument interest'))!;
        portfolioBook.getBalancesReport = async () => balances(portfolioBook, 'Instrument', '10');
        financialBook.getBalancesReport = async query =>
            query.includes('instrument interest')
                ? balances(financialBook, 'instrument interest', '-7')
                : balances(financialBook, 'Instrument', '80');
        const processor = createProcessor(portfolioBook, financialBook, baseBook);
        const created: Transaction[] = [];
        financialBook.batchCreateTransactions = async transactions => {
            created.push(...transactions);
            return transactions;
        };
        const mtmSource = createTransaction(portfolioBook, 'mtm-source', '2025-01-31');

        await service.addMarkToMarket(
            portfolioBook,
            mtmSource,
            stockAccount,
            financialBook,
            unrealized,
            new Amount(10),
            false,
            processor
        );
        portfolioBook.getBalancesReport = async () => balances(portfolioBook, 'Instrument', '0');
        await service.checkAndRecordInterestMtm(
            stockAccount,
            portfolioBook,
            interest,
            financialBook,
            '2025-01-31',
            'interest-source',
            new Summary(),
            processor
        );
        await processor.fireBatchOperations();

        expect(created.map(transaction => transaction.getRemoteIds()[0])).toEqual([
            'mtm_mtm-source',
            'interestmtm_interest-source',
        ]);
        expect(created.map(transaction => transaction.getAmount()?.toString())).toEqual([
            '20',
            '7',
        ]);
        expect(await movementAccounts(created[0]!)).toEqual({
            from: 'Instrument Unrealized',
            to: 'Instrument',
        });
        expect(await movementAccounts(created[1]!)).toEqual({
            from: 'instrument interest Unrealized',
            to: 'instrument interest',
        });
        expect(created[0]?.getProperty('price')).toBe('10.00');
        expect(created[0]?.getProperty('open_quantity')).toBe('10');
        expect(created.every(transaction => transaction.isChecked())).toBe(true);
    });

    test('selects aggregate and exchange-specific regular and historical support Accounts', async () => {
        const service = new CalculateRealizedResultsSupport();
        const portfolioBook = createBook({ id: 'portfolio' });
        const financialBook = createBook({
            id: 'financial',
            accounts: [
                { id: 'unrealized', name: 'Instrument Unrealized', type: AccountType.ASSET },
                {
                    id: 'unrealized-hist',
                    name: 'Instrument Unrealized Hist',
                    type: AccountType.ASSET,
                },
            ],
        });
        const baseBook = createBook({
            id: 'base',
            accounts: [
                {
                    id: 'aggregate-unrealized',
                    name: 'Instrument Unrealized',
                    type: AccountType.ASSET,
                },
                {
                    id: 'exchange-unrealized',
                    name: 'Instrument Unrealized EXC',
                    type: AccountType.ASSET,
                },
                {
                    id: 'aggregate-unrealized-hist',
                    name: 'Instrument Unrealized Hist',
                    type: AccountType.ASSET,
                },
                {
                    id: 'exchange-unrealized-hist',
                    name: 'Instrument Unrealized Hist EXC',
                    type: AccountType.ASSET,
                },
            ],
        });
        await useEmbeddedAccounts(financialBook);
        await useEmbeddedAccounts(baseBook);
        const stockAccount = new StockAccount(
            new Account(portfolioBook, { id: 'instrument', name: 'Instrument' })
        );

        const accounts = await Promise.all([
            service.getUnrealizedAccount(financialBook, stockAccount),
            service.getUnrealizedHistAccount(financialBook, stockAccount),
            service.getUnrealizedFxBaseAccount(baseBook, stockAccount, 'true'),
            service.getUnrealizedFxBaseAccount(baseBook, stockAccount, undefined),
            service.getUnrealizedFxHistBaseAccount(baseBook, stockAccount, 'true'),
            service.getUnrealizedFxHistBaseAccount(baseBook, stockAccount, undefined),
        ]);

        expect(accounts.map(account => account.getName())).toEqual([
            'Instrument Unrealized',
            'Instrument Unrealized Hist',
            'Instrument Unrealized',
            'Instrument Unrealized EXC',
            'Instrument Unrealized Hist',
            'Instrument Unrealized Hist EXC',
        ]);
    });
});
