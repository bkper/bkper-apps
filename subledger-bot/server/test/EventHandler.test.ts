import { describe, expect, test } from 'bun:test';
import { Bkper, Book, Group } from 'bkper-js';
import { AppContext } from '../src/app-context';
import { EventHandler } from '../src/events/handlers/EventHandler';

class RecordingEventHandler extends EventHandler {
    parentResult: string | null = 'parent-result';
    childResult: string | null = 'child-result';
    readonly parentCalls: Book[] = [];
    readonly childCalls: { childBook: Book; parentBook: Book }[] = [];

    protected async processParentBookEvent(
        parentBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        this.parentCalls.push(parentBook);
        return this.parentResult;
    }

    protected async processChildBookEvent(
        childBook: Book,
        parentBook: Book,
        _event: bkper.Event
    ): Promise<string | null> {
        this.childCalls.push({ childBook, parentBook });
        return this.childResult;
    }

    getBookAnchor(book: Book): string {
        return this.buildBookAnchor(book);
    }

    findLinkedParentGroup(
        childBook: Book,
        parentBook: Book,
        childGroup: Group | null | undefined
    ): Promise<Group | null> {
        return this.getLinkedParentGroup(childBook, parentBook, childGroup);
    }
}

function createBook(id: string, name: string, properties: Record<string, string> = {}): Book {
    return new Book({ id, name, properties });
}

function createEvent(book: Book, agentId = 'tester'): bkper.Event {
    return {
        type: 'ACCOUNT_CREATED',
        book: book.json(),
        agent: { id: agentId },
        user: { username: 'tester' },
        data: { object: {} },
    };
}

describe('legacy shared event behavior', () => {
    test('processes a Book without a parent property as the parent Book', async () => {
        const handler = new RecordingEventHandler(new AppContext(new Bkper()));
        const parentBook = createBook('parent-book', 'Parent Book');

        const result = await handler.handleEvent(createEvent(parentBook));

        expect(result).toBe('parent-result');
        expect(handler.parentCalls).toHaveLength(1);
        expect(handler.parentCalls[0].getId()).toBe('parent-book');
        expect(handler.childCalls).toHaveLength(0);
    });

    test('resolves a child Book through parent_book_id', async () => {
        const bkper = new Bkper();
        const parentBook = createBook('parent-book', 'Parent Book');
        const requestedBookIds: string[] = [];
        bkper.getBook = async id => {
            requestedBookIds.push(id);
            return parentBook;
        };
        const handler = new RecordingEventHandler(new AppContext(bkper));
        const childBook = createBook('child-book', 'Child Book', {
            parent_book_id: 'parent-book',
        });

        const result = await handler.handleEvent(createEvent(childBook));

        expect(result).toBe('child-result');
        expect(requestedBookIds).toEqual(['parent-book']);
        expect(handler.parentCalls).toHaveLength(0);
        expect(handler.childCalls).toHaveLength(1);
        expect(handler.childCalls[0].childBook.getId()).toBe('child-book');
        expect(handler.childCalls[0].parentBook).toBe(parentBook);
    });

    test('supports the legacy parent_book fallback property', async () => {
        const bkper = new Bkper();
        const parentBook = createBook('legacy-parent', 'Legacy Parent');
        const requestedBookIds: string[] = [];
        bkper.getBook = async id => {
            requestedBookIds.push(id);
            return parentBook;
        };
        const handler = new RecordingEventHandler(new AppContext(bkper));
        const childBook = createBook('child-book', 'Child Book', {
            parent_book: 'legacy-parent',
        });

        const result = await handler.handleEvent(createEvent(childBook));

        expect(result).toBe('child-result');
        expect(requestedBookIds).toEqual(['legacy-parent']);
        expect(handler.childCalls).toHaveLength(1);
    });

    test('skips Exchange Bot events before loading the parent Book', async () => {
        const bkper = new Bkper();
        let parentLoads = 0;
        bkper.getBook = async () => {
            parentLoads += 1;
            return createBook('parent-book', 'Parent Book');
        };
        const handler = new RecordingEventHandler(new AppContext(bkper));
        const childBook = createBook('child-book', 'Child Book', {
            parent_book_id: 'parent-book',
        });

        const result = await handler.handleEvent(createEvent(childBook, 'exchange-bot'));

        expect(result).toBe(false);
        expect(parentLoads).toBe(0);
        expect(handler.parentCalls).toHaveLength(0);
        expect(handler.childCalls).toHaveLength(0);
    });

    test('normalizes an empty handler result to false', async () => {
        const handler = new RecordingEventHandler(new AppContext(new Bkper()));
        handler.parentResult = '';

        const result = await handler.handleEvent(createEvent(createBook('parent', 'Parent')));

        expect(result).toBe(false);
    });

    test('builds the PWA parent Book anchor', () => {
        const handler = new RecordingEventHandler(new AppContext(new Bkper()));
        const book = createBook('book-123', 'Parent Book');

        expect(handler.getBookAnchor(book)).toBe(
            "<a href='https://bkper.app/books/book-123/transactions'>Parent Book</a>"
        );
    });

    test('finds a linked parent Group only for the current child Book', async () => {
        const handler = new RecordingEventHandler(new AppContext(new Bkper()));
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const childGroup = new Group(childBook, { id: 'child-group', name: 'Revenue' });
        const linkedParentGroup = new Group(parentBook, {
            id: 'parent-group',
            name: 'Revenue',
            properties: { child_book_id: 'child-book' },
        });
        parentBook.getGroup = async name => (name === 'Revenue' ? linkedParentGroup : undefined);

        const result = await handler.findLinkedParentGroup(childBook, parentBook, childGroup);

        expect(result).toBe(linkedParentGroup);
    });

    test('does not link a parent Group assigned to another child Book', async () => {
        const handler = new RecordingEventHandler(new AppContext(new Bkper()));
        const childBook = createBook('child-book', 'Child Book');
        const parentBook = createBook('parent-book', 'Parent Book');
        const childGroup = new Group(childBook, { id: 'child-group', name: 'Revenue' });
        const otherParentGroup = new Group(parentBook, {
            id: 'parent-group',
            name: 'Revenue',
            properties: { child_book_id: 'other-child' },
        });
        parentBook.getGroup = async () => otherParentGroup;

        const result = await handler.findLinkedParentGroup(childBook, parentBook, childGroup);

        expect(result).toBeNull();
    });
});
