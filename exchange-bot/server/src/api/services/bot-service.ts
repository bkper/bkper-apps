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
     * deduplicating by Book ID and reusing eligible Collection Books.
     *
     * @param book - The Book whose connections should be resolved.
     * @returns Connected Books in first-discovery order, with each Book ID included once.
     */
    async getConnectedBooks(book: Book): Promise<Set<Book>> {
        if (book.getVisibleProperties() == null) {
            return new Set<Book>();
        }

        // Connected books in the Collection
        const collectionBooks = book.getCollection()?.getBooks() ?? [];
        const collectionBooksById = new Map<string, Book>();

        for (const collectionBook of collectionBooks) {
            if (
                collectionBook.getId() != book.getId() &&
                this.getExcCode(collectionBook) != null &&
                !collectionBooksById.has(collectionBook.getId())
            ) {
                collectionBooksById.set(collectionBook.getId(), collectionBook);
            }
        }

        // Connected books by deprecated methods
        const legacyBookIds = this.getLegacyConnectedBookIds(book);
        const loadedBooksById = new Map<string, Book>();
        for (const id of legacyBookIds) {
            if (!collectionBooksById.has(id)) {
                const loadedBook = await this.context.bkper.getBook(id);
                loadedBooksById.set(loadedBook.getId(), loadedBook);
            }
        }

        const connectedBooks = new Set<Book>();

        // Add legacy first to preserve behavior
        for (const legacyBookId of legacyBookIds) {
            const legacyBook =
                collectionBooksById.get(legacyBookId) ?? loadedBooksById.get(legacyBookId);
            if (legacyBook) {
                connectedBooks.add(legacyBook);
            }
        }

        // Add Collection books after
        for (const collectionBook of collectionBooksById.values()) {
            connectedBooks.add(collectionBook);
        }

        return connectedBooks;
    }

    private getLegacyConnectedBookIds(book: Book): Set<string> {
        const legacyBookIds = new Set<string>();
        // deprecated
        for (const key in book.getVisibleProperties()) {
            if (key.startsWith('exc') && key.endsWith('_book')) {
                const bookId = book.getVisibleProperties()[key];
                if (bookId && bookId.trim() != '') {
                    legacyBookIds.add(bookId);
                }
            }
        }
        // deprecated
        const excBooks = book.getProperty('exc_books');
        if (excBooks != null && excBooks.trim() != '') {
            const bookIds = excBooks.split(/[ ,]+/);
            for (const bookId of bookIds) {
                if (bookId != null && bookId.trim().length > 10) {
                    legacyBookIds.add(bookId);
                }
            }
        }
        return legacyBookIds;
    }

    getExcCode(book: Book): string | undefined {
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
