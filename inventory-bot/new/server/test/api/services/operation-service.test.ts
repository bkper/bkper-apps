import { afterEach, expect, mock, test } from 'bun:test';
import { Account, AccountType, App, Bkper, BkperError, Book, Permission } from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import { CalculateService } from '../../../src/api/services/calculate-service.js';
import {
    type OperationContext,
    OperationService,
} from '../../../src/api/services/operation-service.js';
import { ResetService } from '../../../src/api/services/reset-service.js';

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

const originalCalculateRun = Reflect.get(CalculateService, 'run');
const originalResetRun = Reflect.get(ResetService, 'run');
const originalGetApps = Book.prototype.getApps;

afterEach(() => {
    Reflect.set(CalculateService, 'run', originalCalculateRun);
    Reflect.set(ResetService, 'run', originalResetRun);
    Book.prototype.getApps = originalGetApps;
});

test('Calculate and Reset invoke their non-mutating stubs only after complete authorization', async () => {
    const inventoryBook = createInventoryBook();
    Book.prototype.getApps = async () => [new App({ id: 'inventory-bot' })];
    const bkper = new Bkper();
    bkper.getBook = async () => inventoryBook;
    const context = createAppContext(bkper);
    const calculateRun = mock(async () => ({ message: 'Calculate stub' }));
    const resetRun = mock(async () => ({ message: 'Reset stub' }));
    Reflect.set(CalculateService, 'run', calculateRun);
    Reflect.set(ResetService, 'run', resetRun);

    await expect(
        CalculateService.execute(context, 'inventory-book', 'item-account', {
            date: '2026-09-02',
        })
    ).resolves.toEqual({ message: 'Calculate stub' });
    await expect(ResetService.execute(context, 'inventory-book', 'item-account')).resolves.toEqual({
        message: 'Reset stub',
    });
    expect(calculateRun).toHaveBeenCalledTimes(1);
    expect(resetRun).toHaveBeenCalledTimes(1);

    inventoryBook.payload.permission = Permission.VIEWER;
    await expect(
        CalculateService.execute(context, 'inventory-book', 'item-account', {
            date: '2026-09-02',
        })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
        ResetService.execute(context, 'inventory-book', 'item-account')
    ).rejects.toMatchObject({ status: 403 });
    expect(calculateRun).toHaveBeenCalledTimes(1);
    expect(resetRun).toHaveBeenCalledTimes(1);
});
