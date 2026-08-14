import type { Book } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { EXC_CODE_PROP, EXC_HISTORICAL_PROP, EXC_RATES_URL_PROP } from '../../shared/constants.js';

interface RatesEndpointConfig {
    url: string;
}

export class BotService {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    getRatesEndpointConfig(book: Book, date: string, agent: string): RatesEndpointConfig {
        let ratesUrl = book.getProperty(EXC_RATES_URL_PROP, 'exchange_rates_url');

        if (ratesUrl == null || ratesUrl.trim() == '') {
            ratesUrl =
                'https://openexchangerates.org/api/historical/${date}.json?show_alternative=true&app_id=' +
                this.context.env.OPEN_EXCHANGE_RATES_APP_ID;
        }

        ratesUrl = ratesUrl.replace('${transaction.date}', date);
        ratesUrl = ratesUrl.replace('${date}', date);
        ratesUrl = ratesUrl.replace('${agent}', agent);

        return {
            url: ratesUrl,
        };
    }

    async getConnectedBooks(book: Book): Promise<Set<Book>> {
        if (book.getVisibleProperties() == null) {
            return new Set<Book>();
        }
        const books = new Set<Book>();

        // deprecated
        for (const key in book.getVisibleProperties()) {
            if (key.startsWith('exc') && key.endsWith('_book')) {
                books.add(await this.context.bkper.getBook(book.getVisibleProperties()[key]));
            }
        }

        // deprecated
        const excBooks = book.getProperty('exc_books');
        if (excBooks != null && excBooks.trim() != '') {
            const bookIds = excBooks.split(/[ ,]+/);
            for (const connectedBookId of bookIds) {
                if (connectedBookId != null && connectedBookId.trim().length > 10) {
                    books.add(await this.context.bkper.getBook(connectedBookId));
                }
            }
        }

        const collectionBooks = book.getCollection()?.getBooks();
        if (collectionBooks) {
            for (const collectionBook of collectionBooks) {
                if (
                    collectionBook.getId() != book.getId() &&
                    this.getBaseCode(collectionBook) != null
                ) {
                    books.add(collectionBook);
                }
            }
        }

        return books;
    }

    getBaseCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }

    isHistorical(book: Book): boolean {
        const historical = book.getProperty(EXC_HISTORICAL_PROP);
        return historical != null && historical.trim().toLowerCase() === 'true';
    }

    parseDateParam(dateParam: string): Date {
        const dateSplit = dateParam.split('-');
        const year = Number(dateSplit[0]);
        const month = Number(dateSplit[1]) - 1;
        const day = Number(dateSplit[2]);
        return new Date(year, month, day, 13, 0, 0, 0);
    }
}
