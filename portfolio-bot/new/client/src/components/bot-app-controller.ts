import type { Book } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { appEnv } from './../app-env.js';
import { APP_ID } from './../constants.js';
import { isBookAccessRequiredError, isNotFoundError } from './../errors.js';
import { Utils } from './../utils.js';
import { authService } from './../services/auth-service.js';
import { bkperService } from './../services/bkper-service.js';
import { botService } from './../services/bot-service.js';
import type { BotAppView } from './bot-app-view.js';
import type { PortfolioBotBook } from '../types.js';
import { BotAppErrors } from './bot-app-errors.js';

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
        await Promise.all([this.initApp(), this.initBookContext()]);
    }

    // async retryValidations(): Promise<void> {
    //     const book = this.view.book;
    //     if (!book || this.view.validating) {
    //         return;
    //     }
    //     const visibleBooks = this.view.books
    //         .map(exchangeBook => exchangeBook.book)
    //         .filter(Utils.canViewBook);
    //     await this.validateBooks(book, new Set(visibleBooks));
    // }

    private async initApp(): Promise<void> {
        this.view.app = await bkperService.loadApp();
    }

    private async initBookContext(): Promise<void> {
        await authService.init();
        if (!authService.accessToken) {
            return;
        }

        const book = await this.initBook();
        if (!book) {
            return;
        }

        const installedApp = await this.initInstalledApp(book);
        if (!installedApp) {
            return;
        }

        // const books = await this.loadBooks(book);
        this.view.appState = BotAppState.READY;

        // await this.validateBooks(book, books);
    }

    private async initBook(): Promise<Book | undefined> {
        this.view.book = undefined;
        this.view.error = undefined;

        this.view.validating = false;
        this.view.validationError = '';

        const bookId = appEnv.getSearchParam('bookId');
        this.view.bookId = bookId ?? '';

        if (!bookId) {
            this.view.error = BotAppErrors.bookNotSpecified();
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        let book: Book;
        try {
            book = await bkperService.loadBook(bookId, true);
        } catch (error: unknown) {
            if (isBookAccessRequiredError(error)) {
                this.view.error = BotAppErrors.bookAccessRequired(bookId);
            } else {
                this.view.error = isNotFoundError(error)
                    ? BotAppErrors.bookNotFound()
                    : BotAppErrors.bookLoadFailed();
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
            this.view.error = BotAppErrors.insufficientViewPermission(book);
            this.view.warnings = [];
            this.view.appState = BotAppState.READY;
            return undefined;
        }

        return book;
    }

    private async initInstalledApp(book: Book): Promise<boolean> {
        try {
            const installedApp = await bkperService.loadInstalledApp(book, APP_ID);
            if (installedApp) {
                return true;
            }
        } catch {
            // Missing installations and verification failures share the same recovery path.
        }
        this.view.error = BotAppErrors.appInstallationNotVerified(book.getId());
        this.view.appState = BotAppState.ERROR;
        return false;
    }

    // private async loadBooks(book: Book): Promise<Set<Book>> {
    //     this.view.books = [];
    //     this.view.hasEditorPermission = false;
    //     this.view.error = undefined;
    //     this.view.warnings = [];

    //     const hasBaseBook = Utils.hasBaseBookInCollection(book);
    //     const connectedBooks = await botService.getConnectedBooks(book);
    //     const books = connectedBooks.add(book);

    //     // Add books to view
    //     for (const b of books) {
    //         const appBook = this.createExchangeBotBook(b, hasBaseBook);
    //         this.view.books.push(appBook);
    //     }

    //     // Check editor permission (only on Books that the Exchange Update targets)
    //     const booksMissingEditPermission = this.view.books.filter(
    //         b => b.isBase && !Utils.canEditBook(b.book)
    //     );
    //     if (booksMissingEditPermission.length > 0) {
    //         this.view.hasEditorPermission = false;
    //         this.view.error = BotAppErrors.insufficientEditPermission(booksMissingEditPermission);
    //     } else {
    //         this.view.hasEditorPermission = true;
    //     }

    //     // Pending-task validation applies only to Books visible to the User.
    //     const visibleBooks = Array.from(books).filter(Utils.canViewBook);
    //     return new Set(visibleBooks);
    // }

    // private async validateBooks(book: Book, books: Set<Book>): Promise<void> {
    //     this.view.validating = true;
    //     this.view.validationError = '';
    //     this.view.warnings = [];

    //     const warnings: string[] = [];

    //     try {
    //         const missingExcCodes = await this.mapMissingExcCodes(book);
    //         if (missingExcCodes.size > 0) {
    //             warnings.push(
    //                 this.buildWarning(
    //                     'Configured currencies do not have a visible connected Book:',
    //                     missingExcCodes
    //                 )
    //             );
    //             this.view.warnings = [...warnings];
    //         }

    //         const pendingTasksExcCodes = await this.mapPendingTasksExcCodes(books);
    //         if (pendingTasksExcCodes.size > 0) {
    //             warnings.push(this.buildWarning('Books with pending tasks:', pendingTasksExcCodes));
    //             this.view.warnings = [...warnings];
    //         }

    //         const eventErrorsExcCodes = await this.mapEventErrorsExcCodes(book);
    //         if (eventErrorsExcCodes.size > 0) {
    //             warnings.push(this.buildWarning('Books with errors:', eventErrorsExcCodes));
    //             this.view.warnings = [...warnings];
    //         }
    //     } catch {
    //         this.view.validationError = 'An error occurred while validating connected Books.';
    //     } finally {
    //         this.view.validating = false;
    //     }
    // }

    private getInitialDate(book: Book): string {
        const timeZone = book.getTimeZone();
        return Utils.getIsoDateInTimeZone(new Date(), timeZone);
    }

    // private createExchangeBotBook(book: Book, hasBaseBook: boolean): PortfolioBotBook {
    //     return {
    //         book,
    //         excCode: Utils.getExcCode(book),
    //         isBase: Utils.isBaseBook(book) || !hasBaseBook,
    //     };
    // }

    // private async mapPendingTasksExcCodes(collectionBooks: Set<Book>): Promise<Set<string>> {
    //     const excCodes = new Set<string>();
    //     const booksWithPendingTasks = await botService.getBooksWithPendingTasks(collectionBooks);
    //     for (const book of booksWithPendingTasks) {
    //         excCodes.add(Utils.getExcCode(book) ?? '');
    //     }
    //     return excCodes;
    // }

    // private async mapEventErrorsExcCodes(book: Book): Promise<Set<string>> {
    //     const excCodes = new Set<string>();
    //     const collection = book.getCollection();
    //     const collectionBooks = (collection?.getBooks() ?? []).filter(
    //         b => Utils.getExcCode(b) && Utils.canViewBook(b)
    //     );
    //     const booksWithEventErrors = await botService.getBooksWithEventErrors(
    //         new Set(collectionBooks)
    //     );
    //     for (const book of booksWithEventErrors) {
    //         const excCode = Utils.getExcCode(book);
    //         if (excCode) {
    //             excCodes.add(excCode);
    //         }
    //     }
    //     return excCodes;
    // }

    // private async mapMissingExcCodes(book: Book): Promise<Set<string>> {
    //     const missingExcCodes = new Set<string>();
    //     const visibleExcCodes = botService.getCollectionExcCodes(book);
    //     const configuredExcCodes = await botService.getBookConfiguredExcCodes(book);
    //     for (const configuredExcCode of configuredExcCodes) {
    //         if (!visibleExcCodes.has(configuredExcCode)) {
    //             missingExcCodes.add(configuredExcCode);
    //         }
    //     }
    //     return missingExcCodes;
    // }

    // private buildWarning(prefix: string, excCodes: Set<string>): string {
    //     const codesArray = Array.from(excCodes);
    //     return `${prefix} ${codesArray.join(', ')}`;
    // }
}
