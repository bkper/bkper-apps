import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
import { AppContext } from '../src/shared/app-context.js';
import { BotService } from '../src/BotService.js';

const originalFetch = globalThis.fetch;
let urlSequence = 0;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createContext(bkper = new Bkper()): AppContext {
    return new AppContext(bkper, {
        OPEN_EXCHANGE_RATES_APP_ID: 'open-rates-test-id',
        ASSETS: { fetch },
    });
}

function createBook(
    id: string,
    properties: Record<string, string> = {},
    extra: Partial<bkper.Book> = {}
): Book {
    return new Book({
        id,
        name: id,
        datePattern: 'yyyy-MM-dd',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        properties,
        ...extra,
    });
}

function createTransaction(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'transaction-1',
        date: '2026-01-02',
        amount: '100',
        description: 'Payment',
        properties: {},
        creditAccount: { name: 'From', groups: [], properties: {} },
        debitAccount: { name: 'To', groups: [], properties: {} },
        ...overrides,
    };
}

function ratesUrl(): string {
    urlSequence += 1;
    return `https://rates.test/bot-service-${urlSequence}`;
}

function replaceRatesFetch(rates: Record<string, string>): void {
    globalThis.fetch = (async () =>
        new Response(JSON.stringify({ base: 'USD', rates, status: 200 }), {
            headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch;
}

function captureThrown(operation: () => unknown): unknown {
    try {
        operation();
    } catch (error: unknown) {
        return error;
    }
    throw new Error('Expected operation to throw');
}

describe('legacy event bot service', () => {
    test('discovers connected Books from legacy properties and collection in order', async () => {
        const bkper = new Bkper();
        const loadedIds: string[] = [];
        bkper.getBook = async id => {
            loadedIds.push(id);
            return createBook(id, { exc_code: 'LEGACY' });
        };
        const book = createBook(
            'event-book',
            {
                exc_usd_book: 'legacy-book-id',
                exc_books: 'legacy-list-one legacy-list-two',
                exc_code: 'USD',
            },
            {
                collection: {
                    books: [
                        { id: 'template', properties: { exc_code: 'TEMPLATE' } },
                        { id: 'collection-brl', properties: { exc_code: 'BRL' } },
                        { id: 'collection-empty', properties: {} },
                    ],
                },
            }
        );

        const books = await new BotService(createContext(bkper)).getConnectedBooks(book);

        expect(loadedIds).toEqual(['legacy-book-id', 'legacy-list-one', 'legacy-list-two']);
        expect(books.map(connectedBook => connectedBook.getId())).toEqual([
            'legacy-book-id',
            'legacy-list-one',
            'legacy-list-two',
            'collection-brl',
        ]);
    });

    test('preserves base-Book and currency-code rules', () => {
        const service = new BotService(createContext());
        const book = createBook(
            'base',
            { exc_base: 'false', exc_code: 'USD' },
            {
                collection: {
                    books: [
                        { id: 'base', properties: { exc_base: 'false', exc_code: 'USD' } },
                        { id: 'other', properties: { exc_code: 'EUR' } },
                    ],
                },
            }
        );

        expect(service.isBaseBook(book)).toBe(true);
        expect(service.hasBaseBookInCollection(book)).toBe(true);
        expect(service.getBaseCode(book)).toBe('USD');
    });

    test('matches Account currency by connected Book code and Group property order', async () => {
        const service = new BotService(createContext());
        const book = createBook(
            'book',
            { exc_code: 'USD' },
            {
                collection: {
                    books: [{ id: 'eur-book', properties: { exc_code: 'EUR' } }],
                },
            }
        );

        const connectedCode = await service.getAccountExcCode(book, {
            groups: [
                { name: 'EUR', properties: {} },
                { name: 'Other', properties: { exc_code: 'BRL' } },
            ],
        });
        const propertyCode = await service.getAccountExcCode(book, {
            groups: [{ name: 'Other', properties: { exc_code: 'BRL' } }],
        });

        expect(connectedCode).toBe('EUR');
        expect(propertyCode).toBe('BRL');
    });

    test('matches transaction currency through origin and destination Groups', () => {
        const service = new BotService(createContext());
        const book = createBook('book');

        expect(
            service.match(
                book,
                'EUR',
                createTransaction({
                    creditAccount: {
                        name: 'From',
                        groups: [{ name: 'EUR', properties: {} }],
                    },
                })
            )
        ).toBe(true);
        expect(
            service.match(
                book,
                'BRL',
                createTransaction({
                    debitAccount: {
                        name: 'To',
                        groups: [{ name: 'Other', properties: { exc_code: 'BRL' } }],
                    },
                })
            )
        ).toBe(true);
        expect(service.match(book, 'JPY', createTransaction())).toBe(false);
    });

    test('builds the default event rates endpoint', () => {
        const config = new BotService(createContext()).getRatesEndpointConfig(
            createBook('book'),
            createTransaction()
        );

        expect(config.url).toBe(
            'https://openexchangerates.org/api/historical/2026-01-02.json?show_alternative=true&app_id=open-rates-test-id'
        );
    });

    test('preserves custom endpoint substitutions and exc_date parsing', () => {
        const service = new BotService(createContext());
        const book = createBook(
            'book',
            { exc_rates_url: 'https://rates.test/${transaction.date}/${date}/${agent}' },
            { datePattern: 'dd/MM/yyyy' }
        );
        const transaction = createTransaction({ properties: { exc_date: '03/01/2026' } });

        expect(service.getRatesEndpointConfig(book, transaction).url).toBe(
            'https://rates.test/2026-01-03/2026-01-03/bot'
        );
    });

    test('rejects an invalid exc_date using the Book date pattern', () => {
        const service = new BotService(createContext());
        const book = createBook('book', {}, { datePattern: 'dd/MM/yyyy' });
        const transaction = createTransaction({ properties: { exc_date: 'invalid' } });

        expect(String(captureThrown(() => service.getRatesEndpointConfig(book, transaction)))).toBe(
            'Invalid range for exc_date property. Use appropriated date in dd/MM/yyyy format, instead of invalid.'
        );
    });

    test('uses today for future rates endpoints', () => {
        const today = new Date().toISOString().substring(0, 10);
        const config = new BotService(createContext()).getRatesEndpointConfig(
            createBook('book', { exc_rates_url: 'https://rates.test/${date}' }),
            createTransaction({ date: '2999-01-01' })
        );

        expect(config.url).toBe(`https://rates.test/${today}`);
    });

    test('preserves explicit amount, rate, and description overrides', async () => {
        replaceRatesFetch({ EUR: '0.5', BRL: '5' });
        const service = new BotService(createContext());
        const baseBook = createBook('base', { exc_code: 'USD' });
        const eurBook = createBook('eur', { exc_code: 'EUR' });

        const explicitAmount = await service.extractAmountDescription_(
            baseBook,
            eurBook,
            'USD',
            'EUR',
            createTransaction({
                properties: { exc_amount: '250', exc_code: 'EUR' },
            }),
            ratesUrl()
        );
        const explicitRate = await service.extractAmountDescription_(
            baseBook,
            eurBook,
            'USD',
            'EUR',
            createTransaction({ properties: { exc_rate: '2.5', exc_code: 'EUR' } }),
            ratesUrl()
        );
        const descriptionAmount = await service.extractAmountDescription_(
            baseBook,
            eurBook,
            'USD',
            'EUR',
            createTransaction({ description: 'Payment EUR200' }),
            ratesUrl()
        );

        expect(explicitAmount.amount.toString()).toBe('250');
        expect(explicitAmount.excBaseRate?.toString()).toBe('2.5');
        expect(explicitRate.amount.toString()).toBe('250');
        expect(descriptionAmount.amount.toString()).toBe('200');
        expect(descriptionAmount.description).toBe('Payment USD100');
    });

    test('converts and rounds calculated event amounts to eight places', async () => {
        replaceRatesFetch({ BRL: '3.333333333' });
        const service = new BotService(createContext());

        const result = await service.extractAmountDescription_(
            createBook('usd', { exc_code: 'USD' }),
            createBook('brl', { exc_code: 'BRL' }),
            'USD',
            'BRL',
            createTransaction({ amount: '3' }),
            ratesUrl()
        );

        expect(result.amount.toString()).toBe('10');
        expect(result.excBaseRate?.toString()).toBe('3.33333333333333333333');
    });
});
