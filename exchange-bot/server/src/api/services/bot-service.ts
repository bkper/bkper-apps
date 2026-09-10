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

    /**
     * Gets connected Books from legacy properties followed by Collection membership,
     * deduplicating by Book ID and retaining the first discovered instance.
     *
     * @param book - The Book whose connections should be resolved.
     * @returns Connected Books in first-discovery order, with each Book ID included once.
     */
    async getConnectedBooks(book: Book): Promise<Set<Book>> {
        const properties = book.getVisibleProperties();
        if (properties == null) {
            return new Set<Book>();
        }

        const books = new Map<string, Book>();
        const legacyBookIds = new Set<string>();

        // deprecated
        for (const key in properties) {
            if (key.startsWith('exc') && key.endsWith('_book')) {
                const connectedBookId = properties[key];
                legacyBookIds.add(connectedBookId);
            }
        }

        // deprecated
        const excBooks = book.getProperty('exc_books');
        if (excBooks != null && excBooks.trim() != '') {
            const bookIds = excBooks.split(/[ ,]+/);
            for (const connectedBookId of bookIds) {
                if (connectedBookId != null && connectedBookId.trim().length > 10) {
                    legacyBookIds.add(connectedBookId);
                }
            }
        }

        for (const legacyBookId of legacyBookIds) {
            const connectedBook = await this.context.bkper.getBook(legacyBookId);
            if (!books.has(connectedBook.getId())) {
                books.set(connectedBook.getId(), connectedBook);
            }
        }

        const collectionBooks = book.getCollection()?.getBooks();
        if (collectionBooks) {
            for (const collectionBook of collectionBooks) {
                if (
                    collectionBook.getId() != book.getId() &&
                    this.getBaseCode(collectionBook) != null &&
                    !books.has(collectionBook.getId())
                ) {
                    books.set(collectionBook.getId(), collectionBook);
                }
            }
        }

        return new Set(books.values());
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
