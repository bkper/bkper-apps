import { Account, Group, type Book } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { appEnv } from './../app-env.js';
import { APP_ID } from './../constants.js';
import { isBookAccessRequiredError, isNotFoundError } from './../errors.js';
import { authService } from './../services/auth-service.js';
import { bkperService } from './../services/bkper-service.js';
import { botService } from './../services/bot-service.js';
import type { AppError, CostOfGoodsSoldContext } from './../types.js';
import { BotAppState } from './../types.js';
import { Utils } from './../utils.js';
import { BotAppErrors } from './bot-app-errors.js';
import type { BotAppView } from './bot-app-view.js';

export class BotAppController implements ReactiveController {
    private readonly view: BotAppView;

    private contextVersion = 0;

    constructor(view: BotAppView) {
        this.view = view;
        this.view.addController(this);
    }

    hostConnected(): void {
        self.addEventListener('message', this.handleMessage);
        this.initialize();
    }

    hostDisconnected(): void {
        self.removeEventListener('message', this.handleMessage);
    }

    private isCurrent(contextVersion: number): boolean {
        return contextVersion === this.contextVersion;
    }

    async initialize(): Promise<void> {
        this.view.embedded = appEnv.isEmbedded();
        const url = new URL(self.location.href);
        const contextVersion = ++this.contextVersion;
        await Promise.all([this.initApp(), this.initBookContext(url, contextVersion)]);
    }

    private readonly handleMessage = async (event: MessageEvent<unknown>): Promise<void> => {
        // Ignore context changes while an operation owns the UI so its per-Account results remain visible.
        if (this.view.appState === BotAppState.EXECUTING) {
            return;
        }

        if (!Utils.isTrustedAppUrlChangeEvent(event, self.parent, appEnv.getBkperOrigin())) {
            return;
        }

        let url: URL;
        try {
            url = new URL(event.data.url);
        } catch {
            return;
        }
        if (url.origin !== new URL(self.location.href).origin) {
            return;
        }

        self.history.replaceState(self.history.state, '', url);
        const contextVersion = ++this.contextVersion;
        await this.initBookContext(url, contextVersion);
    };

    private async initApp(): Promise<void> {
        this.view.app = await bkperService.loadApp();
    }

    private async initBookContext(url: URL, contextVersion: number): Promise<void> {
        this.resetStates();

        await authService.init();
        if (!this.isCurrent(contextVersion) || !authService.accessToken) {
            return;
        }

        const book = await this.initBook(url, contextVersion);
        if (!book) {
            return;
        }

        const installedInBook = await this.initInstalledApp(book, contextVersion);
        if (!this.isCurrent(contextVersion) || !installedInBook) {
            return;
        }

        const inventoryBook = await this.initInventoryBook(book, contextVersion);
        if (!inventoryBook) {
            return;
        }

        if (inventoryBook.getId() !== book.getId()) {
            const installedInInventoryBook = await this.initInstalledApp(
                inventoryBook,
                contextVersion
            );
            if (!installedInInventoryBook) {
                return;
            }
        }

        const context = await this.loadContext(book, inventoryBook, url, contextVersion);
        if (!this.isCurrent(contextVersion) || context === null) {
            return;
        }
        this.view.appState = BotAppState.READY;
    }

    private resetStates(): void {
        this.view.appState = BotAppState.LOADING;
        this.view.inventoryBook = undefined;
        this.view.error = undefined;
        this.view.initialDate = '';
        this.view.cogsContext = undefined;
        this.view.hasViewerPermission = false;
        this.view.hasEditorPermission = false;
        this.view.validating = false;
        this.view.validationError = '';
    }

    private async initBook(url: URL, contextVersion: number): Promise<Book | undefined> {
        const bookId = appEnv.getSearchParam('bookId', url);
        if (!bookId) {
            this.view.error = this.bookNotSpecified();
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        let book: Book;
        try {
            book = await bkperService.loadBook(bookId, true);
        } catch (error: unknown) {
            if (!this.isCurrent(contextVersion)) {
                return undefined;
            }
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

        if (!this.isCurrent(contextVersion)) {
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

    private async initInventoryBook(book: Book, contextVersion: number): Promise<Book | undefined> {
        let inventoryBook = botService.getInventoryBook(book);
        if (!inventoryBook) {
            this.view.error = this.inventoryBookNotFoundInCollection();
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        const inventoryBookId = inventoryBook.getId();
        try {
            inventoryBook =
                inventoryBookId === book.getId()
                    ? book
                    : await bkperService.loadBook(inventoryBookId, true);
        } catch (error: unknown) {
            if (!this.isCurrent(contextVersion)) {
                return undefined;
            }
            if (isBookAccessRequiredError(error)) {
                this.view.error = this.bookAccessRequired(inventoryBookId, true);
            } else {
                this.view.error = isNotFoundError(error)
                    ? this.bookNotFound(true)
                    : this.bookLoadFailed(true);
            }
            this.view.appState = BotAppState.ERROR;
            return undefined;
        }

        if (!this.isCurrent(contextVersion)) {
            return undefined;
        }

        this.view.initialDate = this.getInitialDate(inventoryBook);
        this.view.inventoryBook = inventoryBook;

        const canView = Utils.canViewBook(inventoryBook);
        this.view.hasViewerPermission = canView;

        if (!canView) {
            this.view.error = this.insufficientViewPermission(inventoryBook, true);
            this.view.appState = BotAppState.READY;
            return undefined;
        }

        return inventoryBook;
    }

    private async initInstalledApp(book: Book, contextVersion: number): Promise<boolean> {
        try {
            const installedApp = await bkperService.loadInstalledApp(book, APP_ID);
            if (installedApp) {
                return true;
            }
        } catch {
            // Missing installations and verification failures share the same recovery path.
        }
        if (!this.isCurrent(contextVersion)) {
            return false;
        }
        this.view.error = this.appInstallationNotVerified(book.getId());
        this.view.appState = BotAppState.ERROR;
        return false;
    }

    private async loadContext(
        book: Book,
        inventoryBook: Book,
        url: URL,
        contextVersion: number
    ): Promise<void | null> {
        // Account context takes precedence over Group context when both are selected.
        const account = await this.loadAccount(book, inventoryBook, url, contextVersion);
        if (account === null) {
            return null;
        }

        // Resolve Group context only when no Account was selected.
        const group = account
            ? undefined
            : await this.loadGroup(book, inventoryBook, url, contextVersion);
        if (group === null) {
            return null;
        }

        const accounts: Account[] = [];
        if (account) {
            await this.addEligibleInventoryAccount(accounts, account);
        } else if (group) {
            const groupAccounts = await group.getAccounts();
            for (const groupAccount of groupAccounts) {
                await this.addEligibleInventoryAccount(accounts, groupAccount);
            }
        } else {
            const allAccounts = await inventoryBook.getAccounts();
            for (const inventoryAccount of allAccounts) {
                await this.addEligibleInventoryAccount(accounts, inventoryAccount);
            }
        }

        const accountsExcCodes = await Utils.getExchangeCodes(accounts);
        if (!this.isCurrent(contextVersion)) {
            return null;
        }

        const editableExcCodes = botService.getEditableFinancialBookExchangeCodes(
            inventoryBook,
            accountsExcCodes
        );
        const missingExcCodes = this.getMissingExcCodes(accountsExcCodes, editableExcCodes);

        this.view.hasEditorPermission = missingExcCodes.length === 0;
        if (!this.view.hasEditorPermission) {
            this.view.error = BotAppErrors.insufficientEditPermission(missingExcCodes);
        }

        // Sort accounts alphabetically
        accounts.sort((a1, a2) => (a1.getName() ?? '').localeCompare(a2.getName() ?? ''));

        const cogsContext: CostOfGoodsSoldContext = {
            inventoryBook,
            selectedAccount: account,
            selectedGroup: group,
            accounts,
            resetEnabled: true,
        };

        this.view.cogsContext = cogsContext;
    }

    private getMissingExcCodes(
        accountExcCodes: Set<string>,
        editableExcCodes: Set<string>
    ): string[] {
        const missingExcCodes: string[] = [];
        for (const accountExcCode of accountExcCodes) {
            if (!editableExcCodes.has(accountExcCode)) {
                missingExcCodes.push(accountExcCode);
            }
        }
        return missingExcCodes;
    }

    private async loadAccount(
        book: Book,
        inventoryBook: Book,
        url = new URL(self.location.href),
        contextVersion = this.contextVersion
    ): Promise<Account | null | undefined> {
        const accountId = appEnv.getSearchParam('accountId', url);
        if (!accountId) {
            return undefined;
        }

        let account = new Account(book, { id: accountId });
        let bookName = book.getName() ?? book.getId();

        const fail = (error: AppError): null | undefined => {
            if (!this.isCurrent(contextVersion)) {
                return undefined;
            }
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
            bookName = inventoryBook.getName() ?? inventoryBook.getId();

            const inventoryAccount = await inventoryBook.getAccount(account.getName());
            return inventoryAccount ?? fail(this.resourceNotFound(account, bookName));
        } catch (error: unknown) {
            return fail(
                isNotFoundError(error)
                    ? this.resourceNotFound(account, bookName)
                    : this.resourceLoadFailed(account, bookName)
            );
        }
    }

    private async loadGroup(
        book: Book,
        inventoryBook: Book,
        url = new URL(self.location.href),
        contextVersion = this.contextVersion
    ): Promise<Group | null | undefined> {
        const groupId = appEnv.getSearchParam('groupId', url);
        if (!groupId) {
            return undefined;
        }

        let group = new Group(book, { id: groupId });
        let bookName = book.getName() ?? book.getId();

        const fail = (error: AppError): null | undefined => {
            if (!this.isCurrent(contextVersion)) {
                return undefined;
            }
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
            bookName = inventoryBook.getName() ?? inventoryBook.getId();

            const inventoryGroup = await inventoryBook.getGroup(group.getName());
            return inventoryGroup ?? fail(this.resourceNotFound(group, bookName));
        } catch (error: unknown) {
            return fail(
                isNotFoundError(error)
                    ? this.resourceNotFound(group, bookName)
                    : this.resourceLoadFailed(group, bookName)
            );
        }
    }

    private async addEligibleInventoryAccount(
        accounts: Account[],
        account: Account | undefined
    ): Promise<void> {
        if (!account) {
            return;
        }
        const isEligible = await Utils.isEligibleInventoryAccount(account);
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

    private bookAccessRequired(id: string, isInventory?: boolean): AppError {
        const name = isInventory ? 'the Inventory Book' : undefined;
        return BotAppErrors.bookAccessRequired(id, name);
    }

    private bookNotFound(isInventory?: boolean): AppError {
        const name = isInventory ? 'Inventory Book' : undefined;
        const guidance = isInventory
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

    private inventoryBookNotFoundInCollection(): AppError {
        return BotAppErrors.bookNotFound(
            'Inventory Book',
            "No Inventory Book was found in the selected Book's Collection."
        );
    }

    private bookLoadFailed(isInventory?: boolean): AppError {
        const name = isInventory ? 'Inventory Book' : undefined;
        return BotAppErrors.bookLoadFailed(name);
    }

    private insufficientViewPermission(book: Book, isInventory?: boolean): AppError {
        const name = isInventory ? 'Inventory Book' : undefined;
        return BotAppErrors.insufficientViewPermission(book, name);
    }

    private appInstallationNotVerified(bookId: string): AppError {
        return BotAppErrors.appInstallationNotVerified(bookId);
    }
}
