import type { Book } from 'bkper-js';
import type { AppContext } from '../shared/app-context.js';
import type { ExchangeRates } from '../api/schemas.js';
import { EXC_CODE_PROP, EXC_RATES_URL_PROP } from '../shared/constants.js';

export class ExchangeRatesService {
    static async load(context: AppContext, bookId: string, date: string): Promise<ExchangeRates> {
        const book = await context.bkper.getBook(bookId);
        let ratesUrl = book.getProperty(EXC_RATES_URL_PROP, 'exchange_rates_url');

        if (ratesUrl == null || ratesUrl.trim() == '') {
            ratesUrl =
                'https://openexchangerates.org/api/historical/${date}.json?show_alternative=true&app_id=' +
                context.env.OPEN_EXCHANGE_RATES_APP_ID;
        }

        ratesUrl = ratesUrl.replace('${transaction.date}', date);
        ratesUrl = ratesUrl.replace('${date}', date);
        ratesUrl = ratesUrl.replace('${agent}', 'app');

        const response = await fetch(ratesUrl);
        if (!response.ok) {
            throw new Error(`Request failed with status code ${response.status}`);
        }

        const exchangeRates = (await response.json()) as ExchangeRates;

        const connectedBooks = new Set<Book>();
        const visibleProperties = book.getVisibleProperties();
        if (visibleProperties != null) {
            for (const key in visibleProperties) {
                if (key.startsWith('exc') && key.endsWith('_book')) {
                    connectedBooks.add(await context.bkper.getBook(visibleProperties[key]));
                }
            }

            const excBooks = book.getProperty('exc_books');
            if (excBooks != null && excBooks.trim() != '') {
                for (const connectedBookId of excBooks.split(/[ ,]+/)) {
                    if (connectedBookId != null && connectedBookId.trim().length > 10) {
                        connectedBooks.add(await context.bkper.getBook(connectedBookId));
                    }
                }
            }

            const collectionBooks = book.getCollection()?.getBooks();
            if (collectionBooks) {
                for (const collectionBook of collectionBooks) {
                    if (
                        collectionBook.getId() != book.getId() &&
                        collectionBook.getProperty(EXC_CODE_PROP, 'exchange_code') != null
                    ) {
                        connectedBooks.add(collectionBook);
                    }
                }
            }
        }

        connectedBooks.add(book);
        const codes = Array.from(connectedBooks, connectedBook =>
            connectedBook.getProperty(EXC_CODE_PROP, 'exchange_code')
        );

        for (const rate in exchangeRates.rates) {
            if (!codes.includes(rate)) {
                delete exchangeRates.rates[rate];
            }
        }

        if (exchangeRates.rates[exchangeRates.base]) {
            delete exchangeRates.rates[exchangeRates.base];
        }

        exchangeRates.date = date;

        return exchangeRates;
    }
}
