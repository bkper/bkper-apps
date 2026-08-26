import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AccountType, App, Bkper, Book, Permission } from 'bkper-js';
import { ResetService } from '../../../src/api/services/reset-service.js';
import { ResetRealizedResultsService } from '../../../src/api/services/reset/reset-realized-results-service.js';
import { Summary } from '../../../src/api/services/summary.js';
import { AppContext } from '../../../src/shared/app-context.js';

interface ResetCall {
    portfolioBookId: string | undefined;
    accountId: string | undefined;
    full: boolean;
    financialBookId: string | undefined;
    baseBookId: string | undefined;
}

const originalResetAccount = ResetRealizedResultsService.prototype.resetAccount;
let resetCalls: ResetCall[] = [];

beforeEach(() => {
    resetCalls = [];
    ResetRealizedResultsService.prototype.resetAccount = async (context, full) => {
        resetCalls.push({
            portfolioBookId: context.portfolioBook.getId(),
            accountId: context.portfolioAccount.getId(),
            full,
            financialBookId: context.financialBook.getId(),
            baseBookId: context.baseBook.getId(),
        });
        return new Summary().resetingAsync();
    };
});

afterEach(() => {
    ResetRealizedResultsService.prototype.resetAccount = originalResetAccount;
});

function createOperationContext(
    portfolioPermission: Permission,
    unrelatedBook: Partial<bkper.Book> = {}
): AppContext {
    const portfolioBook = new Book({
        id: 'portfolio-book',
        name: 'Portfolio',
        permission: portfolioPermission,
        fractionDigits: 0,
        groups: [{ id: 'eur-group', properties: { stock_exc_code: 'EUR' } }],
        accounts: [
            {
                id: 'instrument-account',
                name: 'Instrument',
                type: AccountType.ASSET,
                permanent: true,
                groups: [{ id: 'eur-group' }],
            },
        ],
        collection: {
            books: [
                {
                    id: 'eur-book',
                    permission: Permission.EDITOR,
                    fractionDigits: 2,
                    properties: { exc_code: 'EUR' },
                },
                {
                    id: 'usd-book',
                    permission: Permission.EDITOR,
                    fractionDigits: 2,
                    properties: { exc_code: 'USD' },
                },
                { id: 'unrelated-book', ...unrelatedBook },
            ],
        },
    });
    portfolioBook.getApps = async () => [new App({ id: 'stock-bot' })];
    const collection = portfolioBook.getCollection();
    if (!collection) {
        throw new Error('Expected Collection fixture');
    }
    const collectionBooks = collection.getBooks();
    collection.getBooks = () => collectionBooks;
    for (const book of collectionBooks) {
        book.getApps = async () => [new App({ id: 'stock-bot' })];
    }
    const bkper = new Bkper();
    bkper.getBook = async () => portfolioBook;
    return new AppContext(bkper, { ASSETS: { fetch } });
}

describe('Reset service operations', () => {
    test('requires Portfolio Book ownership only for Full Reset', async () => {
        const context = createOperationContext(Permission.EDITOR);

        await expect(
            ResetService.reset(context, 'portfolio-book', 'instrument-account')
        ).resolves.toEqual({ message: 'Reseting async...' });
        await expect(
            ResetService.fullReset(context, 'portfolio-book', 'instrument-account')
        ).rejects.toMatchObject({ status: 403 });
        expect(resetCalls.map(call => call.full)).toEqual([false]);
    });

    test('requires every Collection Book to be open and unlocked for Full Reset', async () => {
        for (const unavailableBook of [{ lockDate: '2026-08-05' }, { closingDate: '2026-08-05' }]) {
            const context = createOperationContext(Permission.OWNER, unavailableBook);

            await expect(
                ResetService.fullReset(context, 'portfolio-book', 'instrument-account')
            ).rejects.toMatchObject({
                status: 400,
                message:
                    'Full Reset requires every Book in the Collection to be open and unlocked.',
            });
        }
        expect(resetCalls).toEqual([]);
    });

    test('treats missing and legacy sentinel dates as open and unlocked', async () => {
        const context = createOperationContext(Permission.OWNER, {
            lockDate: '1900-00-00',
            closingDate: '1900-00-00',
        });

        await expect(
            ResetService.fullReset(context, 'portfolio-book', 'instrument-account')
        ).resolves.toEqual({ message: 'Reseting async...' });
    });

    test('does not load Financial or Base Book charts', async () => {
        const context = createOperationContext(Permission.EDITOR);
        const getBook = context.bkper.getBook.bind(context.bkper);
        const loads: Array<[string, boolean | undefined]> = [];
        context.bkper.getBook = async (bookId, includeAccounts) => {
            loads.push([bookId, includeAccounts]);
            return getBook(bookId, includeAccounts);
        };

        await ResetService.reset(context, 'portfolio-book', 'instrument-account');

        expect(loads).toEqual([['portfolio-book', true]]);
    });

    test('runs regular and Full Reset with the resolved operation context', async () => {
        const resetResponse = await ResetService.reset(
            createOperationContext(Permission.EDITOR),
            'portfolio-book',
            'instrument-account'
        );
        const fullResetResponse = await ResetService.fullReset(
            createOperationContext(Permission.OWNER),
            'portfolio-book',
            'instrument-account'
        );

        expect(resetResponse).toEqual({ message: 'Reseting async...' });
        expect(fullResetResponse).toEqual({ message: 'Reseting async...' });

        expect(resetCalls).toEqual([
            {
                portfolioBookId: 'portfolio-book',
                accountId: 'instrument-account',
                full: false,
                financialBookId: 'eur-book',
                baseBookId: 'usd-book',
            },
            {
                portfolioBookId: 'portfolio-book',
                accountId: 'instrument-account',
                full: true,
                financialBookId: 'eur-book',
                baseBookId: 'usd-book',
            },
        ]);
    });

    test('returns a structured invalid-request error for a locked no-write outcome', async () => {
        ResetRealizedResultsService.prototype.resetAccount = async () => {
            const summary = new Summary().lockError();
            summary.getMessage = () => 'Locked operation';
            return summary;
        };

        await expect(
            ResetService.reset(
                createOperationContext(Permission.EDITOR),
                'portfolio-book',
                'instrument-account'
            )
        ).rejects.toMatchObject({
            status: 400,
            message: 'Locked operation',
        });
    });

    test('resolves operation context before Reset and Full Reset', async () => {
        const loadError = new Error('Portfolio Book unavailable');
        const bkper = new Bkper();
        bkper.getBook = async () => {
            throw loadError;
        };
        const context = new AppContext(bkper, { ASSETS: { fetch } });

        await expect(
            ResetService.reset(context, 'portfolio-book', 'instrument-account')
        ).rejects.toBe(loadError);
        await expect(
            ResetService.fullReset(context, 'portfolio-book', 'instrument-account')
        ).rejects.toBe(loadError);
    });
});
