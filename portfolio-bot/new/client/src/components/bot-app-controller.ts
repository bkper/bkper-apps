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

        const installedInBook = await this.initInstalledApp(book);
        if (!installedInBook) {
            return;
        }

        const portfolioBook = await this.initPortfolioBook(book);
        if (!portfolioBook) {
            return;
        }

        if (portfolioBook.getId() !== book.getId()) {
            const installedInPortfolioBook = await this.initInstalledApp(portfolioBook);
            if (!installedInPortfolioBook) {
                return;
            }
        }

        await this.loadContext(book, portfolioBook);
        this.view.appState = BotAppState.READY;
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
            this.view.appState = BotAppState.ERROR;
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

    private async loadContext(book: Book, portfolioBook: Book): Promise<void> {
        const accountId = appEnv.getSearchParam('accountId');
        const groupId = appEnv.getSearchParam('groupId');

        const account = accountId ? await book.getAccount(accountId) : undefined;
        const group = groupId ? await book.getGroup(groupId) : undefined;

        const accounts: Account[] = [];
        let viewGroup: Group | undefined;
        let enableReset = true;

        if (account) {
            const stockAccount = await portfolioBook.getAccount(account.getName());
            await this.addAccount(accounts, stockAccount, account);
        } else if (group) {
            const stockGroup = await portfolioBook.getGroup(group.getName());
            if (stockGroup) {
                viewGroup = stockGroup;
                for (const stockAccount of await stockGroup.getAccounts()) {
                    await this.addAccount(accounts, stockAccount);
                }
            }
        } else {
            const pendingAccounts = await botApiService.listAccountsPendingCalculation(
                portfolioBook.getId()
            );
            for (const pendingAccountId of pendingAccounts.ids) {
                const stockAccount = await portfolioBook.getAccount(pendingAccountId);
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

    private async loadAccount(
        book: Book,
        portfolioBook: Book
    ): Promise<Account | null | undefined> {
        const accountId = appEnv.getSearchParam('accountId');
        if (!accountId) {
            return undefined;
        }

        let accountIdentifier = accountId;
        let bookIdentifier = book.getName() ?? book.getId();

        const fail = (error: AppError): null => {
            this.view.error = error;
            this.view.appState = BotAppState.ERROR;
            return null;
        };

        try {
            const account = await book.getAccount(accountId);
            if (!account) {
                return fail(this.accountNotFound(accountIdentifier, bookIdentifier));
            }

            accountIdentifier = account.getName() ?? accountId;
            bookIdentifier = portfolioBook.getName() ?? portfolioBook.getId();

            const portfolioAccount = await portfolioBook.getAccount(accountIdentifier);
            return (
                portfolioAccount ?? fail(this.accountNotFound(accountIdentifier, bookIdentifier))
            );
        } catch (error: unknown) {
            return fail(
                isNotFoundError(error)
                    ? this.accountNotFound(accountIdentifier, bookIdentifier)
                    : this.accountLoadFailed(accountIdentifier, bookIdentifier)
            );
        }
    }

    private async loadGroup(book: Book, portfolioBook: Book): Promise<Group | null | undefined> {
        const groupId = appEnv.getSearchParam('groupId');
        if (!groupId) {
            return undefined;
        }

        let groupIdentifier = groupId;
        let bookIdentifier = book.getName() ?? book.getId();

        const fail = (error: AppError): null => {
            this.view.error = error;
            this.view.appState = BotAppState.ERROR;
            return null;
        };

        try {
            const group = await book.getGroup(groupId);
            if (!group) {
                return fail(this.groupNotFound(groupIdentifier, bookIdentifier));
            }

            groupIdentifier = group.getName() ?? groupId;
            bookIdentifier = portfolioBook.getName() ?? portfolioBook.getId();

            const portfolioGroup = await portfolioBook.getGroup(groupIdentifier);
            return portfolioGroup ?? fail(this.groupNotFound(groupIdentifier, bookIdentifier));
        } catch (error: unknown) {
            return fail(
                isNotFoundError(error)
                    ? this.groupNotFound(groupIdentifier, bookIdentifier)
                    : this.groupLoadFailed(groupIdentifier, bookIdentifier)
            );
        }
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

    private accountNotFound(identifier: string, bookIdentifier: string): AppError {
        return BotAppErrors.accountNotFound(identifier, bookIdentifier);
    }

    private accountLoadFailed(identifier: string, bookIdentifier: string): AppError {
        return BotAppErrors.accountLoadFailed(identifier, bookIdentifier);
    }

    private groupNotFound(identifier: string, bookIdentifier: string): AppError {
        return BotAppErrors.groupNotFound(identifier, bookIdentifier);
    }

    private groupLoadFailed(identifier: string, bookIdentifier: string): AppError {
        return BotAppErrors.groupLoadFailed(identifier, bookIdentifier);
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
}
