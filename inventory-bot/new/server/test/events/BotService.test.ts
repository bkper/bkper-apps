import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Amount, Bkper, BkperError, Book, Transaction } from 'bkper-js';
import { BotService } from '../../src/events/services/BotService.js';
import { AppContext } from '../../src/shared/app-context.js';

function createBook(
    id: string,
    properties: Record<string, string> = {},
    extra: Partial<bkper.Book> = {}
): Book {
    return new Book({ id, name: id, properties, ...extra });
}

function createService(bkper = new Bkper()): BotService {
    return new BotService(new AppContext(bkper, { ASSETS: { fetch } }));
}

describe('legacy event bot service', () => {
    test('identifies and selects the first Inventory Book by truthy property', () => {
        const service = createService();
        const eventBook = createBook(
            'event',
            {},
            {
                collection: {
                    books: [
                        { id: 'financial', properties: {} },
                        { id: 'inventory-first', properties: { inventory_book: 'false' } },
                        { id: 'inventory-second', properties: { inventory_book: 'true' } },
                    ],
                },
            }
        );

        expect(service.isInventoryBook(createBook('inventory', { inventory_book: 'false' }))).toBe(
            true
        );
        expect(service.isInventoryBook(createBook('financial'))).toBe(false);
        expect(service.getInventoryBook(eventBook)?.getId()).toBe('inventory-first');
        expect(service.getInventoryBook(createBook('standalone'))).toBeUndefined();
    });

    test('parses quantity without changing sign and preserves missing behavior', () => {
        const service = createService();

        expect(
            service.getQuantity({ properties: { quantity: '-2.50' } })?.eq(new Amount('-2.5'))
        ).toBe(true);
        expect(service.getQuantity({ properties: { quantity: '  ' } })).toBeUndefined();
        expect(service.getQuantity({})).toBeUndefined();
    });

    test('selects and reloads the first Financial Book matching the exchange code', async () => {
        const bkper = new Bkper();
        const loadedIds: string[] = [];
        bkper.getBook = async id => {
            loadedIds.push(id);
            return createBook(id);
        };
        const service = createService(bkper);
        const inventoryBook = createBook(
            'inventory',
            { inventory_book: 'true' },
            {
                collection: {
                    books: [
                        { id: 'eur', properties: { exc_code: 'EUR' } },
                        { id: 'usd', properties: { exchange_code: 'USD' } },
                        { id: 'usd-later', properties: { exc_code: 'USD' } },
                    ],
                },
            }
        );

        expect((await service.getFinancialBook(inventoryBook, 'USD'))?.getId()).toBe('usd');
        expect(loadedIds).toEqual(['usd']);
        expect(await service.getFinancialBook(createBook('standalone'), 'USD')).toBeUndefined();
        expect(await service.getFinancialBook(inventoryBook, 'BRL')).toBeUndefined();

        const requiredLookupError = new BkperError(403, 'Financial Book denied', 'forbidden');
        bkper.getBook = async () => {
            throw requiredLookupError;
        };
        await expect(service.getFinancialBook(inventoryBook, 'USD')).rejects.toBe(
            requiredLookupError
        );
    });

    test('resolves exchange codes from SDK and payload Accounts in Group order', async () => {
        const book = createBook(
            'book',
            {},
            {
                groups: [
                    { id: 'empty', properties: { exc_code: '  ' } },
                    { id: 'usd', properties: { exc_code: 'USD' } },
                ],
                accounts: [
                    {
                        id: 'asset',
                        type: AccountType.ASSET,
                        groups: [{ id: 'empty' }, { id: 'usd' }],
                    },
                    {
                        id: 'income',
                        type: AccountType.INCOMING,
                        groups: [{ id: 'usd' }],
                    },
                ],
            }
        );
        const accounts = await book.getAccounts();
        const asset = accounts.find(account => account.getId() === 'asset');
        const income = accounts.find(account => account.getId() === 'income');
        if (!asset || !income) {
            throw new Error('Expected Account fixtures');
        }
        const service = createService();

        expect(await service.getExchangeCodeFromAccount(asset)).toBe('USD');
        expect(await service.getExchangeCodeFromAccount(income)).toBeUndefined();
        expect(
            await service.getExchangeCodeFromAccount({
                type: AccountType.ASSET,
                groups: [{ properties: { exc_code: '' } }, { properties: { exc_code: 'BRL' } }],
            })
        ).toBe('BRL');
    });

    test('preserves purchase, sale, and Inventory Account selection', async () => {
        const book = createBook('book');
        const incoming = new Account(book, { id: 'incoming', type: AccountType.INCOMING });
        const outgoing = new Account(book, { id: 'outgoing', type: AccountType.OUTGOING });
        const good = new Account(book, { id: 'good', type: AccountType.ASSET });
        const purchase = new Transaction(book, { id: 'purchase', posted: true });
        purchase.getCreditAccount = async () => incoming;
        purchase.getDebitAccount = async () => good;
        const sale = new Transaction(book, { id: 'sale', posted: true });
        sale.getCreditAccount = async () => good;
        sale.getDebitAccount = async () => outgoing;
        const draft = new Transaction(book, { id: 'draft', posted: false });
        draft.getCreditAccount = async () => incoming;
        draft.getDebitAccount = async () => good;
        const service = createService();

        expect(await service.isPurchase(purchase)).toBe(true);
        expect(await service.getGoodAccount(purchase)).toBe(good);
        expect(await service.isSale(sale)).toBe(true);
        expect(await service.getGoodAccount(sale)).toBe(good);
        expect(await service.getGoodAccount(draft)).toBeUndefined();
    });

    test('preserves Book aliases, anchors, dates, and Account query construction', () => {
        const service = createService();
        const account = new Account(createBook('book'), {
            properties: { cogs_calc_date: '2025-03-04' },
        });

        expect(service.getBookExcCode(createBook('alias', { exchange_code: 'EUR' }))).toBe('EUR');
        expect(service.buildBookAnchor(createBook('book id'))).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=book id'>book id</a>"
        );
        expect(service.getCOGSCalculationDateValue(account)).toBe(20250304);
        expect(service.getCOGSCalculationDateValue(new Account(createBook('book')))).toBeNull();
        expect(service.getAccountQuery("Good's", '2025-02-01', '2025-01-01')).toBe(
            "account:'Good's' after:2025-01-01 before:2025-02-01"
        );
    });
});
