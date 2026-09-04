import { describe, expect, test } from 'bun:test';
import { Bkper, Book } from 'bkper-js';
import { EventHandlerBookUpdated } from '../../../src/events/handlers/EventHandlerBookUpdated.js';
import { AppContext } from '../../../src/shared/app-context.js';

class TestEventHandlerBookUpdated extends EventHandlerBookUpdated {
    processConnectedBook(
        book: Book,
        portfolioBook: Book,
        event: bkper.Event
    ): Promise<string | null> {
        return this.processObject(book, portfolioBook, event);
    }
}

function createHandler(): TestEventHandlerBookUpdated {
    return new TestEventHandlerBookUpdated(new AppContext(new Bkper(), { ASSETS: { fetch } }));
}

function createBooks(payloads: bkper.Book[]): Book[] {
    const collection: bkper.Collection = { books: payloads };
    const books = payloads.map(payload => new Book({ ...payload, collection }));
    for (const book of books) {
        book.getCollection()!.getBooks = () => books;
    }
    return books;
}

function createEvent(book: Book): bkper.Event {
    return { data: { object: book.json() } };
}

describe('legacy Book synchronization behavior', () => {
    test('copies the historical property and awaits clearing other Portfolio Book flags', async () => {
        const [baseBook, portfolioBook, otherBook] = createBooks([
            {
                id: 'base',
                name: 'Base',
                fractionDigits: 2,
                properties: { exc_base: 'true', exc_code: 'USD', exc_historical: 'false' },
            },
            {
                id: 'portfolio',
                name: 'Portfolio',
                fractionDigits: 0,
                properties: { stock_book: 'true', stock_historical: 'true' },
            },
            {
                id: 'other-portfolio',
                name: 'Other Portfolio',
                fractionDigits: 0,
                properties: { stock_book: 'true' },
            },
        ]);
        const updatedBookIds: string[] = [];
        let otherUpdateStarted = false;
        let releaseOtherUpdate = (): void => undefined;
        const otherUpdateReleased = new Promise<void>(resolve => {
            releaseOtherUpdate = resolve;
        });
        baseBook.update = async (): Promise<Book> => {
            updatedBookIds.push(baseBook.getId());
            return baseBook;
        };
        otherBook.update = async (): Promise<Book> => {
            otherUpdateStarted = true;
            updatedBookIds.push(`${otherBook.getId()}:started`);
            await otherUpdateReleased;
            updatedBookIds.push(`${otherBook.getId()}:completed`);
            return otherBook;
        };

        let handlingSettled = false;
        const handling = createHandler()
            .processConnectedBook(portfolioBook, portfolioBook, createEvent(portfolioBook))
            .then(result => {
                handlingSettled = true;
                return result;
            });
        for (let attempt = 0; attempt < 20 && !otherUpdateStarted && !handlingSettled; attempt++) {
            await Promise.resolve();
        }
        const startedBeforeRelease = otherUpdateStarted;
        const settledBeforeRelease = handlingSettled;
        releaseOtherUpdate();
        const result = await handling;

        expect(startedBeforeRelease).toBe(true);
        expect(settledBeforeRelease).toBe(false);
        expect(otherBook.getProperty('stock_book')).toBeUndefined();
        expect(baseBook.getProperty('exc_historical')).toBe('true');
        expect(updatedBookIds).toEqual([
            'other-portfolio:started',
            'base',
            'other-portfolio:completed',
        ]);
        expect(result).toBe(
            "<a href='https://app.bkper.com/b/#transactions:bookId=base'>Base</a>:  exc_historical: true"
        );
    });

    test('waits for every launched Book update before propagating a failure', async () => {
        const [baseBook, portfolioBook, failingBook, pendingBook] = createBooks([
            {
                id: 'base',
                name: 'Base',
                fractionDigits: 2,
                properties: { exc_base: 'true', exc_code: 'USD' },
            },
            {
                id: 'portfolio',
                name: 'Portfolio',
                fractionDigits: 0,
                properties: { stock_book: 'true' },
            },
            {
                id: 'failing-portfolio',
                name: 'Failing Portfolio',
                fractionDigits: 0,
                properties: { stock_book: 'true' },
            },
            {
                id: 'pending-portfolio',
                name: 'Pending Portfolio',
                fractionDigits: 0,
                properties: { stock_book: 'true' },
            },
        ]);
        const failure = new Error('Book update failed');
        failingBook.update = async (): Promise<Book> => {
            throw failure;
        };
        let pendingUpdateStarted = false;
        let releasePendingUpdate = (): void => undefined;
        const pendingUpdateReleased = new Promise<void>(resolve => {
            releasePendingUpdate = resolve;
        });
        pendingBook.update = async (): Promise<Book> => {
            pendingUpdateStarted = true;
            await pendingUpdateReleased;
            return pendingBook;
        };

        let handlingSettled = false;
        let rejection: unknown;
        const handling = createHandler()
            .processConnectedBook(portfolioBook, portfolioBook, createEvent(portfolioBook))
            .catch(error => {
                rejection = error;
            })
            .finally(() => {
                handlingSettled = true;
            });
        for (let attempt = 0; attempt < 20 && !pendingUpdateStarted; attempt++) {
            await Promise.resolve();
        }
        for (let attempt = 0; attempt < 20 && !handlingSettled; attempt++) {
            await Promise.resolve();
        }
        const settledBeforeRelease = handlingSettled;
        releasePendingUpdate();
        await handling;

        expect(pendingUpdateStarted).toBe(true);
        expect(settledBeforeRelease).toBe(false);
        expect(rejection).toBe(failure);
    });
});
