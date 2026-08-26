import { afterEach, describe, expect, test } from 'bun:test';
import { Account, AccountType, Amount, Book, Transaction, TransactionList } from 'bkper-js';
import { BotService } from '../../../src/api/services/bot-service.js';
import { CalculationModel } from '../../../src/api/services/calculate/types.js';
import { StockAccount } from '../../../src/api/services/stock-account.js';

const originalAccountCreate = Account.prototype.create;

afterEach(() => {
    Account.prototype.create = originalAccountCreate;
});

function createService(): BotService {
    return new BotService();
}

function createPortfolioBook(extra: Partial<bkper.Book> = {}): Book {
    return new Book({
        id: 'portfolio-book',
        name: 'Portfolio',
        fractionDigits: 0,
        timeZone: 'UTC',
        datePattern: 'yyyy-MM-dd',
        groups: [{ id: 'eur-group', properties: { stock_exc_code: 'EUR' } }],
        accounts: [
            {
                id: 'buy',
                name: 'Buy',
                type: AccountType.INCOMING,
                permanent: false,
            },
            {
                id: 'sell',
                name: 'Sell',
                type: AccountType.OUTGOING,
                permanent: false,
            },
            {
                id: 'rebuild',
                name: 'Rebuild',
                type: AccountType.ASSET,
                permanent: true,
                properties: { needs_rebuild: 'FALSE' },
                groups: [{ id: 'eur-group' }],
            },
            {
                id: 'round-trip',
                name: 'Round Trip',
                type: AccountType.ASSET,
                permanent: true,
                groups: [{ id: 'eur-group' }],
            },
            {
                id: 'missing-rate',
                name: 'Missing Rate',
                type: AccountType.ASSET,
                permanent: true,
                groups: [{ id: 'eur-group' }],
            },
            {
                id: 'purchase-only',
                name: 'Purchase Only',
                type: AccountType.ASSET,
                permanent: true,
                groups: [{ id: 'eur-group' }],
            },
        ],
        ...extra,
    });
}

function movement(
    id: string,
    fromId: string,
    toId: string,
    properties: Record<string, string> = {}
): bkper.Transaction {
    return {
        id,
        posted: true,
        creditAccount: { id: fromId },
        debitAccount: { id: toId },
        properties,
    };
}

describe('legacy menu bot service', () => {
    test('identifies an individual Book as open and unlocked', () => {
        const service = createService();

        expect(service.isBookOpenAndUnlocked(new Book({ id: 'open-book' }))).toBe(true);
        expect(
            service.isBookOpenAndUnlocked(
                new Book({
                    id: 'legacy-open-book',
                    lockDate: '1900-00-00',
                    closingDate: '1900-00-00',
                })
            )
        ).toBe(true);
        expect(
            service.isBookOpenAndUnlocked(new Book({ id: 'locked-book', lockDate: '2026-08-05' }))
        ).toBe(false);
        expect(
            service.isBookOpenAndUnlocked(
                new Book({ id: 'closed-book', closingDate: '2026-08-05' })
            )
        ).toBe(false);
    });

    test('selects the Base Book by explicit property and then USD fallback', () => {
        const service = createService();
        const explicitBase = createPortfolioBook({
            collection: {
                books: [
                    { id: 'usd', properties: { exc_code: 'USD' } },
                    { id: 'base', properties: { exc_base: 'true', exc_code: 'BRL' } },
                ],
            },
        });
        const usdFallback = createPortfolioBook({
            collection: {
                books: [
                    { id: 'eur', properties: { exc_code: 'EUR' } },
                    { id: 'usd', properties: { exc_code: 'USD' } },
                ],
            },
        });
        const aliasOnly = createPortfolioBook({
            collection: {
                books: [{ id: 'usd-alias', properties: { exchange_code: 'USD' } }],
            },
        });

        expect(service.getBaseBook(explicitBase)?.getId()).toBe('base');
        expect(service.getBaseBook(usdFallback)?.getId()).toBe('usd');
        expect(service.getBaseBook(aliasOnly)).toBeNull();
        expect(service.getBaseBook(createPortfolioBook())).toBeNull();
    });

    test('builds the Reset Account query in legacy clause order', () => {
        const service = createService();
        const book = createPortfolioBook();
        const account = new StockAccount(
            new Account(book, {
                id: 'instrument',
                name: "Owner's Instrument",
                properties: { forwarded_date: '2025-02-03' },
            })
        );

        expect(service.getAccountQuery(account, false)).toBe(
            "account:'Owner's Instrument' after:2025-02-03"
        );
        expect(service.getAccountQuery(account, false, '2025-04-06')).toBe(
            "account:'Owner's Instrument' after:2025-02-03 before:2025-04-06"
        );
        expect(service.getAccountQuery(account, true, '2025-04-06')).toBe(
            "account:'Owner's Instrument' before:2025-04-06"
        );
    });

    test('recognizes posted purchases and sales from the legacy contra Account types', async () => {
        const service = createService();
        const book = createPortfolioBook();
        const incoming = new Account(book, { id: 'incoming', type: AccountType.INCOMING });
        const outgoing = new Account(book, { id: 'outgoing', type: AccountType.OUTGOING });
        const instrument = new Account(book, { id: 'instrument', type: AccountType.ASSET });
        const purchase = new Transaction(book, { id: 'purchase', posted: true });
        purchase.getCreditAccount = async () => incoming;
        purchase.getDebitAccount = async () => instrument;
        const sale = new Transaction(book, { id: 'sale', posted: true });
        sale.getCreditAccount = async () => instrument;
        sale.getDebitAccount = async () => outgoing;
        const draft = new Transaction(book, { id: 'draft', posted: false });
        draft.getCreditAccount = async () => {
            throw new Error('Draft Account must not be loaded');
        };
        draft.getDebitAccount = async () => {
            throw new Error('Draft Account must not be loaded');
        };

        await expect(service.isPurchase(purchase)).resolves.toBe(true);
        await expect(service.isSale(purchase)).resolves.toBe(false);
        await expect(service.isSale(sale)).resolves.toBe(true);
        await expect(service.isPurchase(sale)).resolves.toBe(false);
        await expect(service.isPurchase(draft)).resolves.toBe(false);
        await expect(service.isSale(draft)).resolves.toBe(false);
    });

    test('builds the unchecked Transaction query from the Portfolio Book closing date', () => {
        const service = createService();

        expect(service.getUncalculatedAccountsQuery(createPortfolioBook())).toBe('is:unchecked');
        expect(
            service.getUncalculatedAccountsQuery(createPortfolioBook({ closingDate: '2026-02-28' }))
        ).toBe('after:2026-03-01 is:unchecked');
        expect(
            service.getUncalculatedAccountsQuery(createPortfolioBook({ closingDate: '1900-00-00' }))
        ).toBe('is:unchecked');
        expect(
            service.getUncalculatedAccountsQuery(
                createPortfolioBook({
                    closingDate: '2026-11-01',
                    timeZone: 'America/New_York',
                })
            )
        ).toBe('after:2026-11-02 is:unchecked');
    });

    test('fails clearly when an unchecked Transaction Account cannot be resolved', async () => {
        const portfolioBook = createPortfolioBook();
        const accounts = await portfolioBook.getAccounts();
        const instrumentAccount = accounts.find(account => account.getId() === 'round-trip');
        if (!instrumentAccount) {
            throw new Error('Expected Account fixture');
        }
        const transaction = new Transaction(portfolioBook, { id: 'incomplete-transaction' });
        transaction.getCreditAccount = async () => undefined;
        transaction.getDebitAccount = async () => instrumentAccount;
        const transactionList = new TransactionList(portfolioBook, { items: [] });
        transactionList.getItems = () => [transaction];
        portfolioBook.listTransactions = async () => transactionList;

        await expect(createService().getUncalculatedAccounts(portfolioBook)).rejects.toThrow(
            'Could not resolve both Accounts for Transaction incomplete-transaction while listing pending-calculation Accounts.'
        );
    });

    test('returns pending-calculation Accounts in Portfolio chart order across all pages', async () => {
        const portfolioBook = createPortfolioBook();
        const baseBook = new Book({ id: 'base-book', properties: { exc_code: 'USD' } });
        const firstPage = [
            movement('round-trip-buy', 'buy', 'round-trip'),
            movement('missing-rate-buy', 'buy', 'missing-rate'),
            movement('rated-buy', 'buy', 'purchase-only', { purchase_exc_rate: '1.20' }),
        ];
        const secondPage = [movement('round-trip-sell', 'round-trip', 'sell')];
        const requests: Array<{ query?: string; cursor?: string }> = [];
        portfolioBook.listTransactions = async (query, _limit, cursor) => {
            requests.push({ query, cursor });
            return cursor
                ? new TransactionList(portfolioBook, { items: secondPage })
                : new TransactionList(portfolioBook, { items: firstPage, cursor: 'next-page' });
        };

        const accounts = await createService().getUncalculatedAccounts(portfolioBook, baseBook);

        expect(accounts.map(account => account.getId())).toEqual([
            'rebuild',
            'round-trip',
            'missing-rate',
        ]);
        expect(requests).toEqual([
            { query: 'is:unchecked', cursor: undefined },
            { query: 'is:unchecked', cursor: 'next-page' },
        ]);
    });

    test('preserves calculation model, before-date, and FIFO precedence', () => {
        const service = createService();
        const book = createPortfolioBook();
        const first = new Transaction(book, {
            dateValue: 20250101,
            createdAt: '1735689600100',
            properties: { order: '1' },
        });
        const laterOrder = new Transaction(book, {
            dateValue: 20250101,
            createdAt: '1735689600100',
            properties: { order: '2' },
        });
        const laterCreation = new Transaction(book, {
            dateValue: 20250101,
            createdAt: '1735689600900',
            properties: { order: '1' },
        });
        const laterDate = new Transaction(book, { dateValue: 20250102 });

        expect(
            service.getCalculationModel(
                createPortfolioBook({ properties: { stock_historical: ' TRUE ' } })
            )
        ).toBe(CalculationModel.HISTORICAL_ONLY);
        expect(
            service.getCalculationModel(createPortfolioBook({ properties: { stock_fair: 'true' } }))
        ).toBe(CalculationModel.FAIR_ONLY);
        expect(service.getCalculationModel(book)).toBe(CalculationModel.BOTH);
        expect(service.getBeforeDateIsoString(book, '2024-02-29')).toBe('2024-03-01');
        expect(service.compareToFIFO(laterDate, first)).toBeGreaterThan(0);
        expect(service.compareToFIFO(laterOrder, first)).toBe(1);
        expect(service.compareToFIFO(laterCreation, first)).toBe(800);
    });

    test('preserves price, rate, and gain precedence', () => {
        const service = createService();
        const book = createPortfolioBook();
        const transaction = new Transaction(book, {
            properties: {
                price: '30',
                sale_price: '20',
                sale_price_hist: '10',
                fwd_sale_price: '40',
                purchase_price: '21',
                purchase_price_hist: '11',
                fwd_purchase_price: '41',
                trade_exc_rate: '1.2',
                trade_exc_rate_hist: '1.1',
                fwd_sale_exc_rate: '1.3',
            },
        });

        expect(service.getHistSalePrice(transaction).toString()).toBe('10');
        expect(service.getSalePrice(transaction).toString()).toBe('40');
        expect(service.getHistPurchasePrice(transaction).toString()).toBe('11');
        expect(service.getPurchasePrice(transaction).toString()).toBe('41');
        expect(service.getTradeExcRate(transaction)?.toString()).toBe('1.1');
        expect(service.getFwdExcRate(transaction, 'fwd_sale_exc_rate', undefined)?.toString()).toBe(
            '1.3'
        );
        expect(
            service
                .calculateGainBaseNoFX(new Amount(10), new Amount(2), new Amount(3), false)
                .toString()
        ).toBe('30');
        expect(
            service
                .calculateGainBaseNoFX(new Amount(10), new Amount(2), new Amount(3), true)
                .toString()
        ).toBe('20');
        expect(
            service
                .calculateGainBaseWithFX(new Amount(5), new Amount(2), new Amount(8), new Amount(3))
                .toString()
        ).toBe('14');
        expect(
            service
                .calculateGainBaseWithFX(new Amount(5), undefined, new Amount(8), new Amount(3))
                .toString()
        ).toBe('0');
    });

    test('resolves the first replicated exchange rate across remote ids and pages', async () => {
        const service = createService();
        const financialBook = new Book({
            id: 'financial-book',
            properties: { exc_code: 'EUR' },
            collection: {
                books: [
                    {
                        id: 'base-book',
                        properties: { exc_base: 'true', exc_code: 'USD' },
                    },
                    { id: 'financial-book', properties: { exc_code: 'EUR' } },
                ],
            },
        });
        const baseBook = new Book({ id: 'base-book', properties: { exc_code: 'USD' } });
        const portfolioBook = createPortfolioBook();
        const stockTransaction = new Transaction(portfolioBook, {
            remoteIds: ['first-financial', 'second-financial'],
        });
        const providedRateTransaction = new Transaction(portfolioBook, {
            remoteIds: ['first-financial'],
            properties: { trade_exc_rate_hist: '1.25', sale_exc_rate: '9' },
        });
        const storedRateTransaction = new Transaction(portfolioBook, {
            remoteIds: ['first-financial'],
            properties: { sale_exc_rate: '1.5' },
        });
        financialBook.getTransaction = async id => new Transaction(financialBook, { id });
        const requests: Array<{ query?: string; cursor?: string }> = [];
        baseBook.listTransactions = async (query, _limit, cursor) => {
            requests.push({ query, cursor });
            if (query === 'remoteId:first-financial') {
                return new TransactionList(baseBook, { items: [] });
            }
            if (!cursor) {
                return new TransactionList(baseBook, { items: [], cursor: 'next-page' });
            }
            return new TransactionList(baseBook, {
                items: [{ id: 'base-transaction', properties: { exc_base_rate: '1.75' } }],
            });
        };

        expect(
            (
                await service.getExcRate(
                    baseBook,
                    financialBook,
                    providedRateTransaction,
                    'sale_exc_rate'
                )
            )?.toString()
        ).toBe('1.25');
        expect(
            (
                await service.getExcRate(
                    baseBook,
                    financialBook,
                    storedRateTransaction,
                    'sale_exc_rate'
                )
            )?.toString()
        ).toBe('1.5');
        expect(requests).toEqual([]);

        const rate = await service.getExcRate(
            baseBook,
            financialBook,
            stockTransaction,
            'sale_exc_rate'
        );

        expect(rate?.toString()).toBe('1.75');
        expect(requests).toEqual([
            { query: 'remoteId:first-financial', cursor: undefined },
            { query: 'remoteId:second-financial', cursor: undefined },
            { query: 'remoteId:second-financial', cursor: 'next-page' },
        ]);
    });

    test('infers and creates support Accounts from the established chart', async () => {
        const service = createService();
        const book = new Book({
            id: 'financial-book',
            groups: [
                { id: 'common', name: 'Common' },
                { id: 'partial', name: 'Partial' },
            ],
            accounts: [
                {
                    id: 'alpha',
                    name: 'Alpha Unrealized',
                    type: AccountType.ASSET,
                    groups: [{ id: 'common' }, { id: 'partial' }],
                },
                {
                    id: 'beta',
                    name: 'Beta Unrealized',
                    type: AccountType.ASSET,
                    groups: [{ id: 'common' }],
                },
                {
                    id: 'interest',
                    name: 'instrument interest',
                    type: AccountType.INCOMING,
                },
                {
                    id: 'holder',
                    name: 'Holder',
                    type: AccountType.ASSET,
                    properties: { exc_account: 'FX Liability' },
                },
                { id: 'fx-liability', name: 'FX Liability', type: AccountType.LIABILITY },
                { id: 'exchange-asset', name: 'Exchange_Asset', type: AccountType.ASSET },
                { id: 'other-exc', name: 'Other EXC', type: AccountType.ASSET },
            ],
        });
        const accounts = await book.getAccounts();
        for (const group of await book.getGroups()) {
            group.getAccounts = async () =>
                group.getId() === 'common'
                    ? accounts.filter(account => ['alpha', 'beta'].includes(account.getId() ?? ''))
                    : accounts.filter(account => account.getId() === 'alpha');
        }
        book.getAccount = async idOrName =>
            accounts.find(
                account => account.getId() === idOrName || account.getName() === idOrName
            );
        let createdAccount: Account | undefined;
        Account.prototype.create = async function (): Promise<Account> {
            createdAccount = this;
            return this;
        };

        const groups = await service.getGroupsByAccountSuffix(book, 'Unrealized');
        const supportAccount = await service.getSupportAccount(
            book,
            new StockAccount(new Account(createPortfolioBook(), { name: 'Instrument' })),
            'Unrealized',
            await service.getTypeByAccountSuffix(book, 'Unrealized')
        );

        expect([...groups].map(group => group.getId())).toEqual(['common']);
        expect(createdAccount).toBe(supportAccount);
        expect(supportAccount.getName()).toBe('Instrument Unrealized');
        expect(supportAccount.getType()).toBe(AccountType.ASSET);
        expect(supportAccount.json().groups?.map(group => group.id)).toEqual(['common']);
        expect((await service.getInterestAccount(book, ' Instrument '))?.getId()).toBe('interest');
        expect(await service.getRealizedExcAccountType(book)).toBe(AccountType.ASSET);
        expect(await service.getTypeByAccountSuffix(book, 'Missing')).toBe(AccountType.LIABILITY);
    });
});
