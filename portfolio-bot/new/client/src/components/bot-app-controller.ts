import type { Account, Book, Group } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { appEnv } from './../app-env.js';
import { APP_ID } from './../constants.js';
import { isBookAccessRequiredError, isNotFoundError } from './../errors.js';
import { Utils } from './../utils.js';
import { authService } from './../services/auth-service.js';
import { bkperService } from './../services/bkper-service.js';
import { botApiService } from './../services/bot-api-service.js';
import { botService } from './../services/bot-service.js';
import type { AppError } from './../types.js';
import type { BotAppView } from './bot-app-view.js';
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
        this.resetStates();

        await authService.init();
        if (!authService.accessToken) {
            return;
        }

        const book = await this.initBook();
        if (!book) {
            return;
        }

        const bookAppInstalled = await this.initInstalledApp(book);
        if (!bookAppInstalled) {
            return;
        }

        const portfolioBook = await this.initPortfolioBook(book);
        if (!portfolioBook) {
            return;
        }

        if (portfolioBook.getId() !== book.getId()) {
            const portfolioBookAppInstalled = await this.initInstalledApp(portfolioBook);
            if (!portfolioBookAppInstalled) {
                return;
            }
        }

        await this.initContext(book, portfolioBook);

        // const books = await this.loadBooks(book);
        this.view.appState = BotAppState.READY;

        // await this.validateBooks(book, books);
    }

    private resetStates(): void {
        this.view.appState = BotAppState.LOADING;
        this.view.portfolioBook = undefined;
        this.view.group = undefined;
        this.view.accounts = [];
        this.view.enableReset = false;
        this.view.error = undefined;
        this.view.initialDate = '';
        this.view.books = [];
        this.view.hasViewerPermission = false;
        this.view.hasEditorPermission = false;
        this.view.validating = false;
        this.view.validationError = '';
        this.view.warnings = [];
    }

    private async initBook(): Promise<Book | undefined> {
        const bookId = appEnv.getSearchParam('bookId');
        if (!bookId) {
            this.view.error = this.bookNotSpecified();
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        let book: Book;
        try {
            book = await bkperService.loadBook(bookId, true);
        } catch (error: unknown) {
            if (isBookAccessRequiredError(error)) {
                this.view.error = this.bookAccessRequired(bookId);
            } else {
                this.view.error = isNotFoundError(error)
                    ? this.bookNotFound()
                    : this.bookLoadFailed();
            }
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        const canView = Utils.canViewBook(book);
        this.view.hasViewerPermission = canView;

        if (!canView) {
            this.view.error = this.insufficientViewPermission(book);
            this.view.appState = BotAppState.READY;
            return undefined;
        }

        return book;
    }

    private async initPortfolioBook(book: Book): Promise<Book | undefined> {
        let portfolioBook = botService.getStockBook(book);
        if (!portfolioBook) {
            this.view.error = this.portfolioBookNotFoundInCollection();
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        const portfolioBookId = portfolioBook.getId();
        try {
            portfolioBook =
                portfolioBookId == book.getId()
                    ? book
                    : await bkperService.loadBook(portfolioBookId, true);
        } catch (error: unknown) {
            if (isBookAccessRequiredError(error)) {
                this.view.error = this.bookAccessRequired(portfolioBookId, true);
            } else {
                this.view.error = isNotFoundError(error)
                    ? this.bookNotFound(true)
                    : this.bookLoadFailed(true);
            }
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        this.view.initialDate = this.getInitialDate(portfolioBook);
        this.view.portfolioBook = portfolioBook;

        const canView = Utils.canViewBook(portfolioBook);
        this.view.hasViewerPermission = canView;

        if (!canView) {
            this.view.error = this.insufficientViewPermission(portfolioBook, true);
            this.view.appState = BotAppState.READY;
            return undefined;
        }

        return portfolioBook;
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
        this.view.error = this.appInstallationNotVerified(book.getId());
        this.view.appState = BotAppState.ERROR;
        return false;
    }

    private async initContext(book: Book, portfolioBook: Book): Promise<void> {
        const accountId = appEnv.getSearchParam('accountId') ?? undefined;
        const groupId = appEnv.getSearchParam('groupId') ?? undefined;
        await this.buildContext(book, portfolioBook, accountId, groupId);
    }

    private async buildContext(
        book: Book,
        stockBook: Book,
        accountId?: string,
        groupId?: string
    ): Promise<void> {
        const account = accountId ? await book.getAccount(accountId) : undefined;
        const group = groupId ? await book.getGroup(groupId) : undefined;

        const accounts: Account[] = [];
        let viewGroup: Group | undefined;
        let enableReset = true;

        if (account) {
            const stockAccount = await stockBook.getAccount(account.getName());
            await this.addAccount(accounts, stockAccount, account);
        } else if (group) {
            const stockGroup = await stockBook.getGroup(group.getName());
            if (stockGroup) {
                viewGroup = stockGroup;
                for (const stockAccount of await stockGroup.getAccounts()) {
                    await this.addAccount(accounts, stockAccount);
                }
            }
        } else {
            const pendingAccounts = await botApiService.listAccountsPendingCalculation(
                stockBook.getId()
            );
            for (const pendingAccountId of pendingAccounts.ids) {
                const stockAccount = await stockBook.getAccount(pendingAccountId);
                await this.addAccount(accounts, stockAccount);
            }
            enableReset = false;
        }

        accounts.sort((first, second) =>
            (first.getName() ?? '').localeCompare(second.getName() ?? '')
        );

        this.view.accounts = accounts;
        this.view.group = viewGroup;
        this.view.enableReset = enableReset;
    }

    private async addAccount(
        accounts: Account[],
        stockAccount: Account | undefined,
        selectedAccount?: Account
    ): Promise<void> {
        if (!stockAccount) {
            return;
        }
        if (
            !stockAccount.isPermanent() ||
            stockAccount.isArchived() ||
            !(await Utils.getExchangeCode(stockAccount))
        ) {
            return;
        }
        if (
            selectedAccount &&
            selectedAccount.getNormalizedName() != stockAccount.getNormalizedName()
        ) {
            return;
        }
        accounts.push(stockAccount);
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

    private bookNotSpecified(): AppError {
        return BotAppErrors.bookNotSpecified();
    }

    private bookAccessRequired(id: string, isPortfolioBook?: boolean): AppError {
        const name = isPortfolioBook ? 'the Portfolio Book' : undefined;
        return BotAppErrors.bookAccessRequired(id, name);
    }

    private bookNotFound(isPortfolio?: boolean): AppError {
        const name = isPortfolio ? 'Portfolio Book' : undefined;
        const guidance = isPortfolio
            ? "Verify the selected Book's Collection and try again."
            : undefined;
        return BotAppErrors.bookNotFound(name, guidance);
    }

    private portfolioBookNotFoundInCollection(): AppError {
        return BotAppErrors.bookNotFound(
            'Portfolio Book',
            "No Portfolio Book was found in the selected Book's Collection."
        );
    }

    private bookLoadFailed(isPortfolio?: boolean): AppError {
        const name = isPortfolio ? 'Portfolio Book' : undefined;
        return BotAppErrors.bookLoadFailed(name);
    }

    private insufficientViewPermission(book: Book, isPortfolio?: boolean): AppError {
        const name = isPortfolio ? 'Portfolio Book' : undefined;
        return BotAppErrors.insufficientViewPermission(book, name);
    }

    private appInstallationNotVerified(bookId: string): AppError {
        return BotAppErrors.appInstallationNotVerified(bookId);
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
