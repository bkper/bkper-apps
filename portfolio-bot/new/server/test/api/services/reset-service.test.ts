import { describe, expect, test } from 'bun:test';
import { AccountType, App, Bkper, Book, Permission } from 'bkper-js';
import { ResetService } from '../../../src/api/services/reset-service.js';
import { AppContext } from '../../../src/shared/app-context.js';

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
        ).resolves.toEqual({ books: [] });
        await expect(
            ResetService.fullReset(context, 'portfolio-book', 'instrument-account')
        ).rejects.toMatchObject({ status: 403 });
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
    });

    test('treats missing and legacy sentinel dates as open and unlocked', async () => {
        const context = createOperationContext(Permission.OWNER, {
            lockDate: '1900-00-00',
            closingDate: '1900-00-00',
        });

        await expect(
            ResetService.fullReset(context, 'portfolio-book', 'instrument-account')
        ).resolves.toEqual({ books: [] });
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
