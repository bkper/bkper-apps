import { afterEach, expect, mock, test } from 'bun:test';
import { AccountType, App, Bkper, Book, Permission } from 'bkper-js';
import { CalculateService } from '../../../src/api/services/calculate-service.js';
import { CalculateCostOfSalesService } from '../../../src/api/services/calculate/calculate-cost-of-sales-service.js';
import { Summary } from '../../../src/api/services/summary.js';
import { AppContext } from '../../../src/shared/app-context.js';

const originalCalculateExecute = CalculateCostOfSalesService.prototype.execute;
const originalGetApps = Book.prototype.getApps;

afterEach(() => {
    CalculateCostOfSalesService.prototype.execute = originalCalculateExecute;
    Book.prototype.getApps = originalGetApps;
});

function createInventoryBook(): Book {
    return new Book({
        id: 'inventory-book',
        name: 'Inventory',
        fractionDigits: 0,
        permission: Permission.EDITOR,
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
                    name: 'Financial metadata',
                    fractionDigits: 2,
                    permission: Permission.EDITOR,
                    properties: { exc_code: 'USD' },
                },
            ],
        },
    });
}

test('loads the complete Financial Book and delegates to Calculate after authorization', async () => {
    const inventoryBook = createInventoryBook();
    const financialBook = new Book({
        id: 'financial-book',
        name: 'Financial complete',
        permission: Permission.EDITOR,
        accounts: [{ id: 'financial-item', name: 'Apple', type: AccountType.ASSET }],
    });
    Book.prototype.getApps = async () => [new App({ id: 'inventory-bot' })];
    const bkper = new Bkper();
    const loads: Array<[string, boolean | undefined]> = [];
    bkper.getBook = async (bookId, includeAccounts) => {
        loads.push([bookId, includeAccounts]);
        return bookId === 'inventory-book' ? inventoryBook : financialBook;
    };
    const calculate = mock(async context => {
        expect(context.inventoryBook).toBe(inventoryBook);
        expect(context.financialBook).toBe(financialBook);
        return new Summary('item-account').calculatingAsync();
    });
    CalculateCostOfSalesService.prototype.execute = calculate;

    const response = await CalculateService.execute(
        new AppContext(bkper, { ASSETS: { fetch } }),
        'inventory-book',
        'item-account',
        { date: '2026-09-02' }
    );

    expect(response).toEqual({ message: 'Calculating...' });
    expect(calculate).toHaveBeenCalledWith(expect.anything(), '2026-09-02');
    expect(loads).toEqual([
        ['inventory-book', true],
        ['financial-book', true],
    ]);
});

test('translates every failed calculation outcome to a structured 400 error', async () => {
    const inventoryBook = createInventoryBook();
    const financialBook = new Book({
        id: 'financial-book',
        permission: Permission.EDITOR,
    });
    Book.prototype.getApps = async () => [new App({ id: 'inventory-bot' })];
    const bkper = new Bkper();
    bkper.getBook = async bookId => (bookId === 'inventory-book' ? inventoryBook : financialBook);
    const cases: Array<{ summary: Summary; message: string }> = [
        {
            summary: new Summary('item-account').salequantityError(),
            message: 'Cannot proceed: sales quantity is greater than quantity purchased',
        },
        {
            summary: new Summary('item-account').creditNoteQuantityError('credit-1'),
            message:
                'Cannot proceed: credit note quantity is greater than purchased quantity. Credit note: credit-1',
        },
        {
            summary: new Summary('item-account').lockError(),
            message: 'Cannot proceed: collection has locked/closed book(s)',
        },
    ];

    for (const testCase of cases) {
        CalculateCostOfSalesService.prototype.execute = async () => testCase.summary;

        await expect(
            CalculateService.execute(
                new AppContext(bkper, { ASSETS: { fetch } }),
                'inventory-book',
                'item-account',
                { date: '2026-09-02' }
            )
        ).rejects.toMatchObject({
            status: 400,
            message: testCase.message,
        });
    }
});
