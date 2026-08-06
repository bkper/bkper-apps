import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
import { AppContext } from '../src/shared/app-context.js';
import { ExchangeRatesService } from '../src/api/services/exchange-rates-service.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createContext(bkper: Bkper): AppContext {
    return new AppContext(bkper, {
        OPEN_EXCHANGE_RATES_APP_ID: 'open-rates-test-id',
        ASSETS: { fetch },
    });
}

function replaceFetch(
    handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
): void {
    globalThis.fetch = handler as typeof fetch;
}

describe('legacy menu exchange-rate loading', () => {
    test('loads the default endpoint and returns only connected currencies for the requested date', async () => {
        const bkper = new Bkper();
        bkper.getBook = async () =>
            new Book({
                id: 'usd-book',
                properties: { exc_code: 'USD' },
                collection: {
                    books: [
                        { id: 'usd-book', properties: { exc_code: 'USD' } },
                        { id: 'eur-book', properties: { exc_code: 'EUR' } },
                        { id: 'other-book', properties: {} },
                    ],
                },
            });
        let requestedUrl = '';
        replaceFetch(async input => {
            requestedUrl = input.toString();
            return Response.json({
                base: 'USD',
                date: '2026-08-04',
                rates: { USD: 1, EUR: '0.86', BRL: 5.42 },
            });
        });

        const rates = await ExchangeRatesService.load(
            createContext(bkper),
            'usd-book',
            '2026-08-05'
        );

        expect(requestedUrl).toBe(
            'https://openexchangerates.org/api/historical/2026-08-05.json?show_alternative=true&app_id=open-rates-test-id'
        );
        expect(rates).toEqual({
            base: 'USD',
            date: '2026-08-05',
            rates: { EUR: '0.86' },
        });
    });

    test('preserves custom endpoint substitutions and legacy connected-Book sources', async () => {
        const selectedBook = new Book({
            id: 'selected-book',
            properties: {
                exc_code: 'USD',
                exc_eur_book: 'legacy-eur-book',
                exc_books: 'legacy-brl-book-id',
                exc_rates_url: 'https://rates.test/${transaction.date}/${date}/${agent}',
            },
        });
        const books: Record<string, Book> = {
            'selected-book': selectedBook,
            'legacy-eur-book': new Book({
                id: 'legacy-eur-book',
                properties: { exc_code: 'EUR' },
            }),
            'legacy-brl-book-id': new Book({
                id: 'legacy-brl-book-id',
                properties: { exc_code: 'BRL' },
            }),
        };
        const bkper = new Bkper();
        bkper.getBook = async id => books[id];
        let requestedUrl = '';
        replaceFetch(async input => {
            requestedUrl = input.toString();
            return Response.json({
                base: 'GBP',
                date: '2026-01-01',
                rates: { USD: 1.2, EUR: 1.1, BRL: 6.2, JPY: 190 },
            });
        });

        const rates = await ExchangeRatesService.load(
            createContext(bkper),
            'selected-book',
            '2026-08-05'
        );

        expect(requestedUrl).toBe('https://rates.test/2026-08-05/2026-08-05/app');
        expect(rates.rates).toEqual({ USD: 1.2, EUR: 1.1, BRL: 6.2 });
        expect(rates.date).toBe('2026-08-05');
    });

    test('fails when the provider request fails', async () => {
        const bkper = new Bkper();
        bkper.getBook = async () => new Book({ id: 'book', properties: { exc_code: 'USD' } });
        replaceFetch(async () => new Response('Unavailable', { status: 503 }));

        expect(
            ExchangeRatesService.load(createContext(bkper), 'book', '2026-08-05')
        ).rejects.toThrow('Request failed with status code 503');
    });
});
