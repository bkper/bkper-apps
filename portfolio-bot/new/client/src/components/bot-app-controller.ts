import { Account, Group, type Book } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { appEnv } from './../app-env.js';
import { APP_ID } from './../constants.js';
import { isBookAccessRequiredError, isNotFoundError } from './../errors.js';
import { Utils } from './../utils.js';
import { authService } from './../services/auth-service.js';
import { bkperService } from './../services/bkper-service.js';
import { botApiService } from './../services/bot-api-service.js';
import { botService } from './../services/bot-service.js';
import type { AppError, RealizedResultsContext } from './../types.js';
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

        const context = await this.loadContext(book, portfolioBook);
        if (context === null) {
            return;
        }
        this.view.appState = BotAppState.READY;
    }

    private resetStates(): void {
        this.view.appState = BotAppState.LOADING;
        this.view.portfolioBook = undefined;
        this.view.error = undefined;
        this.view.initialDate = '';
        this.view.realizedResultsContext = undefined;
        this.view.hasViewerPermission = false;
        this.view.hasEditorPermission = false;
        this.view.validating = false;
        this.view.validationError = '';
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

    private async loadContext(book: Book, portfolioBook: Book): Promise<void | null> {
        // Account context takes precedence over Group context when both are selected.
        const account = await this.loadAccount(book, portfolioBook);
        if (account === null) {
            return null;
        }

        // Resolve Group context only when no Account was selected.
        const group = account ? undefined : await this.loadGroup(book, portfolioBook);
        if (group === null) {
            return null;
        }

        let resetEnabled = true;
        const accounts: Account[] = [];

        if (account) {
            await this.addEligiblePortfolioAccount(accounts, account);
        } else if (group) {
            for (const groupAccount of await group.getAccounts()) {
                await this.addEligiblePortfolioAccount(accounts, groupAccount);
            }
        } else {
            const pendingAccounts = await botApiService.listAccountsPendingCalculation(
                portfolioBook.getId()
            );
            for (const pendingAccountId of pendingAccounts.ids) {
                const portfolioAccount = await portfolioBook.getAccount(pendingAccountId);
                await this.addEligiblePortfolioAccount(accounts, portfolioAccount);
            }
            // Disable reset operation when displaying all uncalculated accounts
            resetEnabled = false;
        }

        // Sort accounts alphabetically
        accounts.sort((a1, a2) => (a1.getName() ?? '').localeCompare(a2.getName() ?? ''));

        const context: RealizedResultsContext = {
            portfolioBook,
            selectedAccount: account,
            selectedGroup: group,
            accounts,
            resetEnabled,
        };

        this.view.realizedResultsContext = context;
    }

    private async loadAccount(
        book: Book,
        portfolioBook: Book
    ): Promise<Account | null | undefined> {
        const accountId = appEnv.getSearchParam('accountId');
        if (!accountId) {
            return undefined;
        }

        let account = new Account(book, { id: accountId });
        let bookName = book.getName() ?? book.getId();

        const fail = (error: AppError): null => {
            this.view.error = error;
            this.view.appState = BotAppState.ERROR;
            return null;
        };

        try {
            const bookAccount = await book.getAccount(accountId);
            if (!bookAccount) {
                return fail(this.resourceNotFound(account, bookName));
            }

            account = bookAccount;
            bookName = portfolioBook.getName() ?? portfolioBook.getId();

            const portfolioAccount = await portfolioBook.getAccount(account.getName());
            return portfolioAccount ?? fail(this.resourceNotFound(account, bookName));
        } catch (error: unknown) {
            return fail(
                isNotFoundError(error)
                    ? this.resourceNotFound(account, bookName)
                    : this.resourceLoadFailed(account, bookName)
            );
        }
    }

    private async loadGroup(book: Book, portfolioBook: Book): Promise<Group | null | undefined> {
        const groupId = appEnv.getSearchParam('groupId');
        if (!groupId) {
            return undefined;
        }

        let group = new Group(book, { id: groupId });
        let bookName = book.getName() ?? book.getId();

        const fail = (error: AppError): null => {
            this.view.error = error;
            this.view.appState = BotAppState.ERROR;
            return null;
        };

        try {
            const bookGroup = await book.getGroup(groupId);
            if (!bookGroup) {
                return fail(this.resourceNotFound(group, bookName));
            }

            group = bookGroup;
            bookName = portfolioBook.getName() ?? portfolioBook.getId();

            const portfolioGroup = await portfolioBook.getGroup(group.getName());
            return portfolioGroup ?? fail(this.resourceNotFound(group, bookName));
        } catch (error: unknown) {
            return fail(
                isNotFoundError(error)
                    ? this.resourceNotFound(group, bookName)
                    : this.resourceLoadFailed(group, bookName)
            );
        }
    }

    private async addEligiblePortfolioAccount(
        accounts: Account[],
        account: Account | undefined
    ): Promise<void> {
        if (!account) {
            return;
        }
        const isEligible = await Utils.isEligiblePortfolioAccount(account);
        if (isEligible) {
            accounts.push(account);
        }
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

    private resourceNotFound(resource: Account | Group, bookName: string): AppError {
        return BotAppErrors.bookResourceNotFound(resource, bookName);
    }

    private resourceLoadFailed(resource: Account | Group, bookName: string): AppError {
        return BotAppErrors.bookResourceLoadFailed(resource, bookName);
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
