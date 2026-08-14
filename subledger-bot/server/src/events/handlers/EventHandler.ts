import { Book, type Group } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { CHILD_BOOK_ID_PROP, PARENT_BOOK_ID_PROP } from '../../constants.js';
import type { EventHandlerResult } from '../types.js';

export abstract class EventHandler {
    protected context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    // parent >> child
    protected abstract processParentBookEvent(
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null>;

    // child >> parent
    protected abstract processChildBookEvent(
        childBook: Book,
        parentBook: Book,
        event: bkper.Event
    ): Promise<string | null>;

    async handleEvent(event: bkper.Event): Promise<EventHandlerResult> {
        const baseBook = new Book(event.book, this.context.bkper.getConfig());
        const parentBookId = baseBook.getProperty(PARENT_BOOK_ID_PROP, 'parent_book');

        if (event.agent!.id === 'exchange-bot') {
            console.log('Skipping Exchange Bot Agent.');
            return false;
        }

        let response: string | null;
        if (parentBookId) {
            const parentBook = await this.context.bkper.getBook(parentBookId);
            const childBook = baseBook;
            response = await this.processChildBookEvent(childBook, parentBook, event);
        } else {
            const parentBook = baseBook;
            response = await this.processParentBookEvent(parentBook, event);
        }
        if (response == null || response === '') {
            return false;
        }
        return response;
    }

    protected buildBookAnchor(book: Book): string {
        return `<a href='https://bkper.app/books/${encodeURIComponent(book.getId())}/transactions'>${book.getName()}</a>`;
    }

    protected async getLinkedParentGroup(
        childBook: Book,
        parentBook: Book,
        childGroup: Group | null | undefined
    ): Promise<Group | null> {
        if (childGroup == null) {
            return null;
        }
        const parentGroup = await parentBook.getGroup(childGroup.getName());
        if (parentGroup && parentGroup.getProperty(CHILD_BOOK_ID_PROP) === childBook.getId()) {
            return parentGroup;
        }
        return null;
    }
}
