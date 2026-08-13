import type { Book } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { appEnv } from './../app-env.js';
import { Errors, isBookAccessRequiredError, isNotFoundError } from './../errors.js';
import { Utils } from './../utils.js';
import { authService } from './../services/auth-service.js';
import { bookService } from './../services/book-service.js';
import { botService } from './../services/bot-service.js';
import type { BotAppView } from './bot-app-view.js';
import type { ExchangeBotBook } from '../types.js';

export enum BotAppState {
    LOADING = 'LOADING',
    READY = 'READY',
    ERROR = 'ERROR',
}

export class BotAppController implements ReactiveController {
    private readonly view: BotAppView;

    constructor(view: BotAppView) {
        this.view = view;
        this.view.addController(this);
    }

    hostConnected(): void {
        this.initialize();
    }

    async initialize(): Promise<void> {
        this.view.embedded = appEnv.isEmbedded();

        await authService.init();
        if (!authService.accessToken) {
            return;
        }

        const book = await this.initializeBook();
        if (!book) {
            return;
        }

        const books = await this.loadBooks(book);
        this.view.appState = BotAppState.READY;

        await this.validateBooks(book, books);
    }

    private async initializeBook(): Promise<Book | undefined> {
        this.view.book = undefined;
        this.view.error = '';
        this.view.permissionError = '';
        this.view.validating = false;

        const bookId = appEnv.getSearchParam('bookId');
        this.view.bookId = bookId ?? '';

        if (!bookId) {
            this.view.error = Errors.BOOK_NOT_FOUND;
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        let book: Book;
        try {
            book = await bookService.loadBook(bookId, true);
        } catch (error: unknown) {
            if (isBookAccessRequiredError(error)) {
                this.view.permissionError = Errors.BOOK_ACCESS_REQUIRED;
            } else {
                this.view.error = isNotFoundError(error)
                    ? Errors.BOOK_NOT_FOUND
                    : Errors.BOOK_LOAD_FAILED;
            }
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        this.view.book = book;
        this.view.initialDate = this.getInitialDate(book);

        const canView = Utils.canViewBook(book);
        this.view.hasViewerPermission = canView;

        if (!canView) {
            this.view.books = [];
            this.view.hasEditorPermission = false;
            this.view.permissionError = Utils.getViewPermissionError(book);
            this.view.warnings = [];
            this.view.appState = BotAppState.READY;
            return undefined;
        }

        return book;
    }

    private async loadBooks(book: Book): Promise<Set<Book>> {
        this.view.books = [];
        this.view.hasEditorPermission = false;
        this.view.permissionError = '';
        this.view.warnings = [];

        const hasBaseBook = Utils.hasBaseBookInCollection(book);
        const connectedBooks = await botService.getConnectedBooks(book);
        const books = connectedBooks.add(book);

        // Add books to view
        for (const b of books) {
            const appBook = this.createExchangeBotBook(b, hasBaseBook);
            this.view.books.push(appBook);
        }

        // Check editor permission (only on Books that the Exchange Update targets)
        const booksMissingEditPermission = this.view.books.filter(
            b => b.isBase && !Utils.canEditBook(b.book)
        );
        if (booksMissingEditPermission.length > 0) {
            this.view.hasEditorPermission = false;
            this.view.permissionError = this.buildEditPermissionError(booksMissingEditPermission);
        } else {
            this.view.hasEditorPermission = true;
        }

        // Pending-task validation applies only to Books visible to the User.
        const visibleBooks = Array.from(books).filter(Utils.canViewBook);
        return new Set(visibleBooks);
    }

    private async validateBooks(book: Book, books: Set<Book>): Promise<void> {
        this.view.validating = true;

        const warnings: string[] = [];

        const missingExcCodes = await this.mapMissingExcCodes(book);
        if (missingExcCodes.size > 0) {
            warnings.push(
                this.buildWarning(
                    'Configured currencies do not have a visible connected Book:',
                    missingExcCodes
                )
            );
            this.view.warnings = [...warnings];
        }

        const pendingTasksExcCodes = await this.mapPendingTasksExcCodes(books);
        if (pendingTasksExcCodes.size > 0) {
            warnings.push(this.buildWarning('Books with pending tasks:', pendingTasksExcCodes));
            this.view.warnings = [...warnings];
        }

        const eventErrorsExcCodes = await this.mapEventErrorsExcCodes(book);
        if (eventErrorsExcCodes.size > 0) {
            warnings.push(this.buildWarning('Books with errors:', eventErrorsExcCodes));
            this.view.warnings = [...warnings];
        }

        this.view.validating = false;
    }

    private getInitialDate(book: Book): string {
        const timeZone = book.getTimeZone();
        return Utils.getIsoDateInTimeZone(new Date(), timeZone);
    }

    private createExchangeBotBook(book: Book, hasBaseBook: boolean): ExchangeBotBook {
        return {
            book,
            excCode: Utils.getExcCode(book),
            isBase: Utils.isBaseBook(book) || !hasBaseBook,
        };
    }

    private async mapPendingTasksExcCodes(collectionBooks: Set<Book>): Promise<Set<string>> {
        const excCodes = new Set<string>();
        const booksWithPendingTasks = await botService.getBooksWithPendingTasks(collectionBooks);
        for (const book of booksWithPendingTasks) {
            excCodes.add(Utils.getExcCode(book) ?? '');
        }
        return excCodes;
    }

    private async mapEventErrorsExcCodes(book: Book): Promise<Set<string>> {
        const excCodes = new Set<string>();
        const collection = book.getCollection();
        const collectionBooks = (collection?.getBooks() ?? []).filter(
            b => Utils.getExcCode(b) && Utils.canViewBook(b)
        );
        const booksWithEventErrors = await botService.getBooksWithEventErrors(
            new Set(collectionBooks)
        );
        for (const book of booksWithEventErrors) {
            const excCode = Utils.getExcCode(book);
            if (excCode) {
                excCodes.add(excCode);
            }
        }
        return excCodes;
    }

    private async mapMissingExcCodes(book: Book): Promise<Set<string>> {
        const missingExcCodes = new Set<string>();
        const visibleExcCodes = botService.getCollectionExcCodes(book);
        const configuredExcCodes = await botService.getBookConfiguredExcCodes(book);
        for (const configuredExcCode of configuredExcCodes) {
            if (!visibleExcCodes.has(configuredExcCode)) {
                missingExcCodes.add(configuredExcCode);
            }
        }
        return missingExcCodes;
    }

    private buildEditPermissionError(books: ExchangeBotBook[]): string {
        const identifiers = books.map(b => b.book.getName() ?? b.excCode ?? b.book.getId());
        const prefix = 'User needs EDITOR or OWNER permission in the following books:';
        const suffix = identifiers.length > 1 ? 'books' : 'book';
        return `${prefix} ${identifiers.join(', ')} ${suffix}`;
    }

    private buildWarning(prefix: string, excCodes: Set<string>): string {
        const codesArray = Array.from(excCodes);
        return `${prefix} ${codesArray.join(', ')}`;
    }
}
