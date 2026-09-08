import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AccountType, App, Bkper, Book, Permission } from 'bkper-js';
import { ResetService } from '../../../src/api/services/reset-service.js';
import { ResetCostOfSalesService } from '../../../src/api/services/reset/reset-cost-of-sales-service.js';
import { Summary } from '../../../src/api/services/summary.js';
import { AppContext } from '../../../src/shared/app-context.js';

interface ResetCall {
    inventoryBookId: string;
    accountId: string | undefined;
    financialBookId: string;
}

const originalExecute = ResetCostOfSalesService.prototype.execute;
let resetCalls: ResetCall[] = [];
let resetResult = new Summary('item-account').resetingAsync();

beforeEach(() => {
    resetCalls = [];
    resetResult = new Summary('item-account').resetingAsync();
    ResetCostOfSalesService.prototype.execute = async context => {
        resetCalls.push({
            inventoryBookId: context.inventoryBook.getId(),
            accountId: context.inventoryAccount.getId(),
            financialBookId: context.financialBook.getId(),
        });
        return resetResult;
    };
});

afterEach(() => {
    ResetCostOfSalesService.prototype.execute = originalExecute;
});

function createAppContext(permission = Permission.EDITOR): AppContext {
    const inventoryBook = new Book({
        id: 'inventory-book',
        name: 'Inventory',
        permission,
        fractionDigits: 0,
        groups: [{ id: 'usd-group', properties: { exc_code: 'USD' } }],
        accounts: [
            {
                id: 'item-account',
                name: 'Apple',
                type: AccountType.ASSET,
                permanent: true,
                groups: [{ id: 'usd-group' }],
            },
        ],
        collection: {
            books: [
                {
                    id: 'financial-book',
                    permission: Permission.EDITOR,
                    fractionDigits: 2,
                    properties: { exc_code: 'USD' },
                },
            ],
        },
    });
    inventoryBook.getApps = async () => [new App({ id: 'inventory-bot' })];
    const collection = inventoryBook.getCollection()!;
    const collectionBooks = collection.getBooks();
    collection.getBooks = () => collectionBooks;
    inventoryBook.getCollection = () => collection;
    for (const book of collectionBooks) {
        book.getApps = async () => [new App({ id: 'inventory-bot' })];
    }
    const bkper = new Bkper();
    bkper.getBook = async () => inventoryBook;
    return new AppContext(bkper, { ASSETS: { fetch } });
}

describe('Reset API service', () => {
    test('runs Reset with the resolved and authorized operation context', async () => {
        const response = await ResetService.execute(
            createAppContext(),
            'inventory-book',
            'item-account'
        );

        expect(response).toEqual({ message: 'Reseted' });
        expect(resetCalls).toEqual([
            {
                inventoryBookId: 'inventory-book',
                accountId: 'item-account',
                financialBookId: 'financial-book',
            },
        ]);
    });

    test('does not invoke Reset when authorization fails', async () => {
        await expect(
            ResetService.execute(
                createAppContext(Permission.VIEWER),
                'inventory-book',
                'item-account'
            )
        ).rejects.toMatchObject({ status: 403 });
        expect(resetCalls).toEqual([]);
    });

    test('translates the legacy locked no-write result to a structured request error', async () => {
        resetResult = new Summary('item-account').lockError();

        await expect(
            ResetService.execute(createAppContext(), 'inventory-book', 'item-account')
        ).rejects.toMatchObject({
            status: 400,
            message: 'Cannot proceed: collection has locked/closed book(s)',
        });
    });
});
