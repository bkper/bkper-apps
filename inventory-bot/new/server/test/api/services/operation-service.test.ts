import { afterEach, expect, mock, test } from 'bun:test';
import { Account, AccountType, App, Bkper, BkperError, Book, Permission } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { CalculateService } from '../../../src/api/services/calculate-service.js';
import { CalculateCostOfSalesService } from '../../../src/api/services/calculate/calculate-cost-of-sales-service.js';
import {
    type OperationContext,
    OperationService,
} from '../../../src/api/services/operation-service.js';
import { ResetService } from '../../../src/api/services/reset-service.js';
import { ResetCostOfSalesService } from '../../../src/api/services/reset/reset-cost-of-sales-service.js';
import { Summary } from '../../../src/api/services/summary.js';

class TestOperationService extends OperationService {
    static validateContextForTest(context: OperationContext): Promise<void> {
        return this.validateContext(context);
    }

    static resolveContextForTest(
        context: AppContext,
        inventoryBookId: string,
        inventoryAccountId: string
    ): Promise<OperationContext> {
        return this.resolveContext(context, inventoryBookId, inventoryAccountId);
    }
}

function createAppContext(bkper: Bkper): AppContext {
    return new AppContext(bkper, { ASSETS: { fetch } });
}

function createBook(id: string, permission = Permission.EDITOR, installed = true): Book {
    const book = new Book({ id, permission });
    book.getApps = async () => (installed ? [new App({ id: 'inventory-bot' })] : []);
    return book;
}

function createOperationContext(inventoryBook: Book, financialBook: Book): OperationContext {
    return {
        inventoryBook,
        inventoryAccount: new Account(inventoryBook, { id: 'inventory-account' }),
        financialBook,
    };
}

function createInventoryBook(extra: Partial<bkper.Book> = {}): Book {
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
                { id: 'zero-usd', fractionDigits: 0, properties: { exc_code: 'USD' } },
                {
                    id: 'usd-book',
                    fractionDigits: 2,
                    permission: Permission.EDITOR,
                    properties: { exchange_code: 'USD' },
                },
            ],
        },
        ...extra,
    });
}

test('resolves the Inventory Book, requested Account, exchange code, and legacy Financial Book', async () => {
    const inventoryBook = createInventoryBook();
    const bkper = new Bkper();
    const loads: Array<[string, boolean | undefined]> = [];
    bkper.getBook = async (bookId, includeAccounts) => {
        loads.push([bookId, includeAccounts]);
        return inventoryBook;
    };

    const context = await TestOperationService.resolveContextForTest(
        createAppContext(bkper),
        'inventory-book',
        'item-account'
    );

    expect(context.inventoryBook).toBe(inventoryBook);
    expect(context.inventoryAccount.getId()).toBe('item-account');
    expect(context.financialBook.getId()).toBe('usd-book');
    expect(loads).toEqual([['inventory-book', true]]);
});

test('returns 400 when the Account-level operation context is incomplete', async () => {
    const missingAccountBook = createInventoryBook();
    missingAccountBook.getAccount = async () => {
        throw new BkperError(404, 'Resource not found', 'notFound');
    };
    const missingExchangeBook = createInventoryBook({
        groups: [],
        accounts: [
            {
                id: 'item-account',
                name: 'Apple',
                type: AccountType.ASSET,
                permanent: true,
            },
        ],
    });
    const missingFinancialBook = createInventoryBook({
        collection: {
            books: [
                { id: 'zero-usd', fractionDigits: 0, properties: { exc_code: 'USD' } },
                { id: 'eur-book', fractionDigits: 2, properties: { exc_code: 'EUR' } },
            ],
        },
    });
    const incomingAccountBook = createInventoryBook({
        accounts: [
            {
                id: 'item-account',
                name: 'Sales',
                type: AccountType.INCOMING,
                permanent: false,
                groups: [{ id: 'usd-group' }],
            },
        ],
    });

    const cases = [
        {
            book: missingAccountBook,
            accountId: 'missing-account',
            message: 'Account missing-account was not found in Book Inventory.',
        },
        {
            book: missingExchangeBook,
            accountId: 'item-account',
            message: 'Account Apple has no configured exchange code in Book Inventory.',
        },
        {
            book: missingFinancialBook,
            accountId: 'item-account',
            message:
                'Financial Book for exchange code USD was not found in the Collection of Inventory.',
        },
        {
            book: incomingAccountBook,
            accountId: 'item-account',
            message: 'Account Sales is non-permanent in Book Inventory.',
        },
    ];

    for (const testCase of cases) {
        const bkper = new Bkper();
        bkper.getBook = async () => testCase.book;

        await expect(
            TestOperationService.resolveContextForTest(
                createAppContext(bkper),
                'inventory-book',
                testCase.accountId
            )
        ).rejects.toMatchObject({ status: 400, message: testCase.message });
    }
});

test('preserves direct non-Asset and archived Account context when exchange metadata is complete', async () => {
    const inventoryBook = createInventoryBook({
        accounts: [
            {
                id: 'item-account',
                name: 'Archived liability',
                type: AccountType.LIABILITY,
                permanent: true,
                archived: true,
                groups: [{ id: 'usd-group' }],
            },
        ],
    });
    const bkper = new Bkper();
    bkper.getBook = async () => inventoryBook;

    const context = await TestOperationService.resolveContextForTest(
        createAppContext(bkper),
        'inventory-book',
        'item-account'
    );

    expect(context.inventoryAccount.getType()).toBe(AccountType.LIABILITY);
    expect(context.inventoryAccount.isArchived()).toBe(true);
    expect(context.financialBook.getId()).toBe('usd-book');
});

test('requires edit permission and Inventory Bot installation on both operation Books', async () => {
    await expect(
        TestOperationService.validateContextForTest(
            createOperationContext(
                createBook('inventory-book'),
                createBook('financial-book', Permission.OWNER)
            )
        )
    ).resolves.toBeUndefined();

    for (const role of ['inventory', 'financial'] as const) {
        const inventoryBook = createBook(
            'inventory-book',
            role === 'inventory' ? Permission.VIEWER : Permission.EDITOR
        );
        const financialBook = createBook(
            'financial-book',
            role === 'financial' ? Permission.POSTER : Permission.EDITOR
        );
        await expect(
            TestOperationService.validateContextForTest(
                createOperationContext(inventoryBook, financialBook)
            )
        ).rejects.toMatchObject({ status: 403 });
    }

    for (const role of ['inventory', 'financial'] as const) {
        const inventoryBook = createBook('inventory-book', Permission.EDITOR, role !== 'inventory');
        const financialBook = createBook('financial-book', Permission.EDITOR, role !== 'financial');
        await expect(
            TestOperationService.validateContextForTest(
                createOperationContext(inventoryBook, financialBook)
            )
        ).rejects.toMatchObject({
            status: 403,
            message: 'Inventory Bot is not installed in this Book.',
        });
    }
});

const originalCalculateExecute = CalculateCostOfSalesService.prototype.execute;
const originalResetExecute = ResetCostOfSalesService.prototype.execute;
const originalGetApps = Book.prototype.getApps;

afterEach(() => {
    CalculateCostOfSalesService.prototype.execute = originalCalculateExecute;
    ResetCostOfSalesService.prototype.execute = originalResetExecute;
    Book.prototype.getApps = originalGetApps;
});

test('Calculate and Reset begin their operations only after complete authorization', async () => {
    const inventoryBook = createInventoryBook();
    Book.prototype.getApps = async () => [new App({ id: 'inventory-bot' })];
    const bkper = new Bkper();
    bkper.getBook = async () => inventoryBook;
    const context = createAppContext(bkper);
    const calculateExecute = mock(async () => new Summary('item-account').done('Calculate stub'));
    const resetExecute = mock(async () => new Summary('item-account').done('Reset stub'));
    CalculateCostOfSalesService.prototype.execute = calculateExecute;
    ResetCostOfSalesService.prototype.execute = resetExecute;

    await expect(
        CalculateService.execute(context, 'inventory-book', 'item-account', {
            date: '2026-09-02',
        })
    ).resolves.toEqual({ message: 'Calculate stub' });
    await expect(ResetService.execute(context, 'inventory-book', 'item-account')).resolves.toEqual({
        message: 'Reset stub',
    });
    expect(calculateExecute).toHaveBeenCalledTimes(1);
    expect(resetExecute).toHaveBeenCalledTimes(1);

    inventoryBook.payload.permission = Permission.VIEWER;
    await expect(
        CalculateService.execute(context, 'inventory-book', 'item-account', {
            date: '2026-09-02',
        })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
        ResetService.execute(context, 'inventory-book', 'item-account')
    ).rejects.toMatchObject({ status: 403 });
    expect(calculateExecute).toHaveBeenCalledTimes(1);
    expect(resetExecute).toHaveBeenCalledTimes(1);
});
