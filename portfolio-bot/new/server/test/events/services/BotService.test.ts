import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Bkper, BkperError, Book, Transaction } from 'bkper-js';
import { CalculationModel } from '../../../src/events/CalculationModel.js';
import { BotService } from '../../../src/events/services/BotService.js';
import { AppContext } from '../../../src/shared/app-context.js';

function createContext(bkper = new Bkper()): AppContext {
    return new AppContext(bkper, { ASSETS: { fetch } });
}

function createBook(
    id: string,
    properties: Record<string, string> = {},
    extra: Partial<bkper.Book> = {}
): Book {
    return new Book({
        id,
        name: id,
        fractionDigits: 2,
        properties,
        ...extra,
    });
}

function createService(bkper = new Bkper()): BotService {
    return new BotService(createContext(bkper));
}

describe('legacy event bot service', () => {
    test('identifies Portfolio Books by property before the zero-fraction fallback', () => {
        const service = createService();

        expect(service.isStockBook(createBook('property', { stock_book: 'false' }))).toBe(true);
        expect(service.isStockBook(createBook('fraction', {}, { fractionDigits: 0 }))).toBe(true);
        expect(service.isStockBook(createBook('financial'))).toBe(false);
    });

    test('selects the Base Book by explicit property and then USD fallback', () => {
        const service = createService();
        const explicitBase = createBook(
            'event',
            {},
            {
                collection: {
                    books: [
                        { id: 'usd', fractionDigits: 2, properties: { exc_code: 'USD' } },
                        { id: 'base', fractionDigits: 2, properties: { exc_base: 'true' } },
                    ],
                },
            }
        );
        const usdFallback = createBook(
            'event',
            {},
            {
                collection: {
                    books: [
                        { id: 'eur', fractionDigits: 2, properties: { exc_code: 'EUR' } },
                        { id: 'usd', fractionDigits: 2, properties: { exchange_code: 'USD' } },
                    ],
                },
            }
        );

        expect(service.getBaseBook(explicitBase)?.getId()).toBe('base');
        expect(service.getBaseBook(usdFallback)?.getId()).toBe('usd');
        expect(service.getBaseBook(createBook('standalone'))).toBeNull();
    });

    test('selects the first Portfolio Book using legacy collection order', () => {
        const service = createService();
        const eventBook = createBook(
            'event',
            {},
            {
                collection: {
                    books: [
                        { id: 'zero-first', fractionDigits: 0, properties: {} },
                        {
                            id: 'explicit-later',
                            fractionDigits: 2,
                            properties: { stock_book: 'true' },
                        },
                    ],
                },
            }
        );

        expect(service.getStockBook(eventBook)?.getId()).toBe('zero-first');
        expect(service.getStockBook(createBook('standalone'))).toBeNull();
    });

    test('reloads the first matching Financial Book with a nonzero fraction count', async () => {
        const bkper = new Bkper();
        const loadedIds: string[] = [];
        bkper.getBook = async id => {
            loadedIds.push(id);
            return createBook(id, { exc_code: 'USD' });
        };
        const service = createService(bkper);
        const portfolioBook = createBook(
            'portfolio',
            { stock_book: 'true' },
            {
                fractionDigits: 0,
                collection: {
                    books: [
                        { id: 'portfolio', fractionDigits: 0, properties: { exc_code: 'USD' } },
                        { id: 'eur', fractionDigits: 2, properties: { exc_code: 'EUR' } },
                        { id: 'usd', fractionDigits: 2, properties: { exc_code: 'USD' } },
                    ],
                },
            }
        );

        const result = await service.getFinancialBook(portfolioBook, 'USD');

        expect(result?.getId()).toBe('usd');
        expect(loadedIds).toEqual(['usd']);
        expect(await service.getFinancialBook(createBook('standalone'), 'USD')).toBeNull();

        const requiredLookupError = new BkperError(404, 'Financial Book not found', 'notFound');
        bkper.getBook = async () => {
            throw requiredLookupError;
        };
        await expect(service.getFinancialBook(portfolioBook, 'USD')).rejects.toBe(
            requiredLookupError
        );
    });

    test('resolves exchange codes from eligible Account Groups in order', async () => {
        const book = createBook(
            'book',
            {},
            {
                groups: [
                    { id: 'empty', properties: { stock_exc_code: '  ' } },
                    { id: 'usd', properties: { stock_exc_code: 'USD' } },
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

        expect(await service.getExchangeCode(asset)).toBe('USD');
        expect(await service.getExchangeCode(income)).toBeNull();
        expect(
            service.getStockExchangeCode({
                type: AccountType.ASSET,
                groups: [
                    { properties: { stock_exc_code: '' } },
                    { properties: { stock_exc_code: 'BRL' } },
                ],
            })
        ).toBe('BRL');
    });

    test('resolves the first exchange Group only for Asset Accounts', async () => {
        const book = createBook(
            'book',
            {},
            {
                groups: [
                    { id: 'other', properties: {} },
                    { id: 'exchange', properties: { stock_exc_code: 'USD' } },
                ],
                accounts: [
                    {
                        id: 'asset',
                        type: AccountType.ASSET,
                        groups: [{ id: 'other' }, { id: 'exchange' }],
                    },
                    {
                        id: 'liability',
                        type: AccountType.LIABILITY,
                        groups: [{ id: 'exchange' }],
                    },
                ],
            }
        );
        const accounts = await book.getAccounts();
        const asset = accounts.find(account => account.getId() === 'asset');
        const liability = accounts.find(account => account.getId() === 'liability');
        if (!asset || !liability) {
            throw new Error('Expected Account fixtures');
        }
        const service = createService();

        expect((await service.getStockExchangeGroup(asset))?.getId()).toBe('exchange');
        expect(await service.getStockExchangeGroup(liability)).toBeNull();
        expect(await service.getStockExchangeGroup(null)).toBeNull();
    });

    test('preserves purchase, sale, and instrument Account selection', async () => {
        const book = createBook('book');
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
        draft.getCreditAccount = async () => incoming;
        draft.getDebitAccount = async () => instrument;
        const service = createService();

        expect(await service.isPurchase(purchase)).toBe(true);
        expect(await service.getStockAccount(purchase)).toBe(instrument);
        expect(await service.isSale(sale)).toBe(true);
        expect(await service.getStockAccount(sale)).toBe(instrument);
        expect(await service.getStockAccount(draft)).toBeNull();
    });

    test('preserves realized-date precedence and calculation-model flags', () => {
        const service = createService();
        const legacyDate = new Account(createBook('book'), {
            properties: { stock_realized_date: '20240102', realized_date: '2025-03-04' },
        });
        const currentDate = new Account(createBook('book'), {
            properties: { realized_date: '2025-03-04' },
        });

        expect(service.getRealizedDateValue(legacyDate)).toBe(20240102);
        expect(service.getRealizedDateValue(currentDate)).toBe(20250304);
        expect(service.getRealizedDateValue(new Account(createBook('book')))).toBeNull();
        expect(
            service.getCalculationModel(
                createBook('historical', { stock_historical: ' TRUE ', stock_fair: 'false' })
            )
        ).toBe(CalculationModel.HISTORICAL_ONLY);
        expect(
            service.getCalculationModel(
                createBook('fair', { stock_historical: 'false', stock_fair: 'true' })
            )
        ).toBe(CalculationModel.FAIR_ONLY);
        expect(
            service.getCalculationModel(
                createBook('both', { stock_historical: 'true', stock_fair: 'true' })
            )
        ).toBe(CalculationModel.BOTH);
        expect(service.getExcCode(createBook('alias', { exchange_code: 'EUR' }))).toBe('EUR');
    });
});
