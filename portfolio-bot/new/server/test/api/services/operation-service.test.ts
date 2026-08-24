import { expect, test } from 'bun:test';
import { AccountType, Bkper, Book } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import {
    type OperationContext,
    OperationService,
} from '../../../src/api/services/operation-service.js';

class TestOperationService extends OperationService {
    static resolveContextForTest(
        context: AppContext,
        portfolioBookId: string,
        portfolioAccountId: string
    ): Promise<OperationContext> {
        return this.resolveContext(context, portfolioBookId, portfolioAccountId);
    }
}

function createContext(bkper: Bkper): AppContext {
    return new AppContext(bkper, { ASSETS: { fetch } });
}

function createPortfolioBook(extra: Partial<bkper.Book> = {}): Book {
    return new Book({
        id: 'portfolio-book',
        name: 'Portfolio',
        fractionDigits: 0,
        groups: [{ id: 'eur-group', properties: { stock_exc_code: 'EUR' } }],
        accounts: [
            {
                id: 'round-trip',
                name: 'Round Trip',
                type: AccountType.ASSET,
                permanent: true,
                groups: [{ id: 'eur-group' }],
            },
        ],
        ...extra,
    });
}

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

    const context = await TestOperationService.resolveContextForTest(
        createContext(bkper),
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

    const context = await TestOperationService.resolveContextForTest(
        createContext(bkper),
        'portfolio-book',
        'instrument'
    );

    expect(context.financialBook.getId()).toBe('usd-book');
    expect(context.baseBook.getId()).toBe('usd-book');
});

test('fails immediately when the operation context cannot be fully resolved', async () => {
    const loadError = new Error('Portfolio Book unavailable');
    const failingBkper = new Bkper();
    failingBkper.getBook = async () => {
        throw loadError;
    };
    await expect(
        TestOperationService.resolveContextForTest(
            createContext(failingBkper),
            'portfolio-book',
            'instrument'
        )
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
            TestOperationService.resolveContextForTest(
                createContext(bkper),
                'portfolio-book',
                testCase.accountId
            )
        ).rejects.toThrow(testCase.message);
    }
});
