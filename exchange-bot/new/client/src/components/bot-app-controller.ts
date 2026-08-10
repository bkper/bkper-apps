import type { Book } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { Utils } from './../utils.js';
import { authService } from './../services/auth-service.js';
import { bookService } from './../services/book-service.js';
import { botService } from './../services/bot-service.js';
import type { BotAppView } from './bot-app-view.js';
import type { BotAppBook } from './exchange-update/exchange-update-view.js';

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
        try {
            this.view.embedded =
                new URL(self.location.href).searchParams.get('embedded') === 'true';

            await authService.init();
            if (!authService.accessToken) {
                return;
            }

            const bookId = new URL(self.location.href).searchParams.get('bookId');
            if (!bookId) {
                throw new Error('Error: Missing bookId URL param');
            }

            const book = await bookService.loadBook(bookId);

            this.view.book = book;
            this.view.initialDate = this.getInitialDate(book);

            await this.loadContext(book);
            this.view.appState = BotAppState.READY;
        } catch (error: unknown) {
            this.view.error = this.formatError(error, 'The selected Book could not be loaded');
            this.view.appState = BotAppState.ERROR;
        }
    }

    private async loadContext(book: Book): Promise<void> {
        this.view.books = [];
        this.view.basePermissionGranted = false;
        this.view.permissionGranted = false;
        this.view.permissionError = '';

        const hasBaseBook = Utils.hasBaseBookInCollection(book);
        const connectedBooks = await botService.getConnectedBooks(book);
        const books = connectedBooks.add(book);

        // Add books to view
        for (const b of books) {
            const appBook = this.createBotAppBook(b, hasBaseBook);
            this.view.books.push(appBook);
        }

        // Map books with pending tasks
        const pendingTasksExcCodes = await this.mapPendingTasksExcCodes(books);

        // Check base editor permission
        const canEdit = Utils.canEditBook(book);
        if (!canEdit) {
            this.view.basePermissionGranted = false;
            this.view.permissionError = `User needs EDITOR or OWNER permission in ${book.getName()} book`;
            return;
        } else {
            this.view.basePermissionGranted = true;
        }

        // Map possibly hidden books
        const missingExcCodes = await this.mapMissingExcCodes(book);

        // Map books with errors
        const botErrorsExcCodes = await this.mapEventErrorsExcCodes(book);

        if (missingExcCodes.size > 0) {
            this.view.permissionGranted = false;
            this.view.permissionError = this.buildContextError(
                'User needs permission in',
                missingExcCodes
            );
        } else if (pendingTasksExcCodes.size > 0) {
            this.view.permissionGranted = false;
            this.view.permissionError = this.buildContextError(
                'There are pending bot tasks in',
                pendingTasksExcCodes
            );
        } else if (botErrorsExcCodes.size > 0) {
            this.view.permissionGranted = false;
            this.view.permissionError = this.buildContextError(
                'There are bot errors in',
                botErrorsExcCodes
            );
        } else {
            this.view.permissionGranted = true;
        }
    }

    private getInitialDate(book: Book): string {
        const timeZone = book.getTimeZone();
        return Utils.getIsoDateInTimeZone(new Date(), timeZone);
    }

    private createBotAppBook(book: Book, hasBaseBook: boolean): BotAppBook {
        return {
            id: book.getId(),
            code: Utils.getExcCode(book),
            isBase: Utils.isBaseBook(book) || !hasBaseBook,
            fractionDigits: book.getFractionDigits(),
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
        const collectionBooks = (collection?.getBooks() ?? []).filter(b => Utils.getExcCode(b));
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

    private buildContextError(prefixText: string, excCodes: Set<string>): string {
        const codesArray = Array.from(excCodes);
        const suffixText = codesArray.length > 1 ? 'books' : 'book';
        return `${prefixText} ${codesArray.join(', ')} ${suffixText}`;
    }

    private formatError(error: unknown, message: string): string {
        return error instanceof Error ? error.message : message;
    }
}
