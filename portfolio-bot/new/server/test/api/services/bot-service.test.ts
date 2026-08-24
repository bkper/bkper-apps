import { describe, expect, test } from 'bun:test';
import { AccountType, Bkper, Book, Transaction, TransactionList } from 'bkper-js';
import { BotService } from '../../../src/api/services/bot-service.js';
import { AppContext } from '../../../src/shared/app-context.js';

function createService(bkper = new Bkper()): BotService {
    return new BotService(new AppContext(bkper, { ASSETS: { fetch } }));
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

    test('resolves the Portfolio Book, Portfolio Account, Financial Book, and Base Book', async () => {
        const portfolioBook = createPortfolioBook({
            collection: {
                books: [
                    { id: 'portfolio-book', fractionDigits: 0 },
                    { id: 'eur-book', fractionDigits: 2, properties: { exc_code: 'EUR' } },
                    { id: 'usd-book', fractionDigits: 2, properties: { exc_code: 'USD' } },
                ],
            },
        });
        const bkper = new Bkper();
        const loads: Array<[string, boolean | undefined]> = [];
        bkper.getBook = async (bookId, includeAccounts) => {
            loads.push([bookId, includeAccounts]);
            return portfolioBook;
        };

        const context = await createService(bkper).resolveMutationContext(
            'portfolio-book',
            'round-trip'
        );

        expect(context.portfolioBook).toBe(portfolioBook);
        expect(context.portfolioAccount.getId()).toBe('round-trip');
        expect(context.financialBook.getId()).toBe('eur-book');
        expect(context.baseBook.getId()).toBe('usd-book');
        expect(loads).toEqual([['portfolio-book', true]]);
    });

    test('resolves the same Book id for the Financial and Base roles', async () => {
        const portfolioBook = createPortfolioBook({
            groups: [{ id: 'usd-group', properties: { stock_exc_code: 'USD' } }],
            accounts: [
                {
                    id: 'instrument',
                    name: 'Instrument',
                    type: AccountType.ASSET,
                    permanent: true,
                    groups: [{ id: 'usd-group' }],
                },
            ],
            collection: {
                books: [
                    { id: 'portfolio-book', fractionDigits: 0 },
                    {
                        id: 'usd-book',
                        fractionDigits: 2,
                        properties: { exc_base: 'true', exc_code: 'USD' },
                    },
                ],
            },
        });
        const bkper = new Bkper();
        bkper.getBook = async () => portfolioBook;

        const context = await createService(bkper).resolveMutationContext(
            'portfolio-book',
            'instrument'
        );

        expect(context.financialBook.getId()).toBe('usd-book');
        expect(context.baseBook.getId()).toBe('usd-book');
    });

    test('fails immediately when the mutation context cannot be fully resolved', async () => {
        const loadError = new Error('Portfolio Book unavailable');
        const failingBkper = new Bkper();
        failingBkper.getBook = async () => {
            throw loadError;
        };
        await expect(
            createService(failingBkper).resolveMutationContext('portfolio-book', 'instrument')
        ).rejects.toBe(loadError);

        const missingAccountBook = createPortfolioBook({
            collection: {
                books: [
                    { id: 'eur-book', fractionDigits: 2, properties: { exc_code: 'EUR' } },
                    { id: 'usd-book', fractionDigits: 2, properties: { exc_code: 'USD' } },
                ],
            },
        });
        missingAccountBook.getAccount = async () => undefined;
        const missingExchangeBook = createPortfolioBook({
            groups: [],
            accounts: [
                {
                    id: 'instrument',
                    name: 'Instrument',
                    type: AccountType.ASSET,
                    permanent: true,
                },
            ],
            collection: { books: [] },
        });
        const missingFinancialBook = createPortfolioBook({
            collection: {
                books: [{ id: 'usd-book', fractionDigits: 2, properties: { exc_code: 'USD' } }],
            },
        });
        const missingBaseBook = createPortfolioBook({
            collection: {
                books: [{ id: 'eur-book', fractionDigits: 2, properties: { exc_code: 'EUR' } }],
            },
        });
        const nonPermanentAccountBook = createPortfolioBook({
            accounts: [
                {
                    id: 'category',
                    name: 'Category',
                    type: AccountType.INCOMING,
                    permanent: false,
                    groups: [{ id: 'eur-group' }],
                },
            ],
        });
        const archivedAccountBook = createPortfolioBook({
            accounts: [
                {
                    id: 'archived',
                    name: 'Archived',
                    type: AccountType.ASSET,
                    permanent: true,
                    archived: true,
                    groups: [{ id: 'eur-group' }],
                },
            ],
        });

        const cases = [
            {
                book: missingAccountBook,
                accountId: 'missing-account',
                message: 'Account missing-account was not found in Book Portfolio.',
            },
            {
                book: missingExchangeBook,
                accountId: 'instrument',
                message: 'Account Instrument has no configured exchange code in Book Portfolio.',
            },
            {
                book: missingFinancialBook,
                accountId: 'round-trip',
                message:
                    'Financial Book for exchange code EUR was not found in the Collection of Portfolio.',
            },
            {
                book: missingBaseBook,
                accountId: 'round-trip',
                message: 'Base Book was not found in the Collection of Portfolio.',
            },
            {
                book: nonPermanentAccountBook,
                accountId: 'category',
                message: 'Account Category is non-permanent in Book Portfolio.',
            },
            {
                book: archivedAccountBook,
                accountId: 'archived',
                message: 'Account Archived is archived in Book Portfolio.',
            },
        ];

        for (const testCase of cases) {
            const bkper = new Bkper();
            bkper.getBook = async () => testCase.book;
            await expect(
                createService(bkper).resolveMutationContext('portfolio-book', testCase.accountId)
            ).rejects.toThrow(testCase.message);
        }
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
});
