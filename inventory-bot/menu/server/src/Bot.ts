BkperApp.setApiKey(PropertiesService.getScriptProperties().getProperty('API_KEY'));
BkperApp.setAgentId('inventory-bot');

/**
* Object to pass server parameters to client side
* 
* @public
*/
interface ContextParams {
    book: { id: string, name: string },
    account?: { id: string, name: string },
    group?: { id: string, name: string }
}

function doGet(e: GoogleAppsScript.Events.AppsScriptHttpRequestEvent) {
    // @ts-ignore
    const bookId = e.parameter.bookId;
    // @ts-ignore
    const accountId = e.parameter.accountId;
    // @ts-ignore
    const groupId = e.parameter.groupId;

    return BotViewService.getBotViewTemplate(bookId, accountId, groupId);
}

/**
 * Get Template object from server side
 * 
 * @public
 */
function getContextParams(parameters: { [key: string]: string }): ContextParams {

    // Params
    const bookIdParam = parameters.bookId;
    const accountIdParam = parameters.accountId;
    const groupIdParam = parameters.groupId;

    // Book, Account, Group
    const book = BkperApp.getBook(bookIdParam);
    const inventoryBook = BotService.getInventoryBook(book);
    if (inventoryBook == null) {
        throw 'Inventory Book not found in the collection';
    }

    const group = book.getGroup(groupIdParam);
    let groupName = group ? group.getName() : undefined;

    const account = book.getAccount(accountIdParam);
    let inventoryAccount: Bkper.Account | undefined = undefined;
    if (account) {
        inventoryAccount = inventoryBook.getAccount(account.getName());
    }

    // Return context params object
    return {
        book: { id: inventoryBook.getId(), name: inventoryBook.getName() },
        account: inventoryAccount ? { id: inventoryAccount.getId(), name: inventoryAccount.getName() } : undefined,
        group: group ? { id: inventoryBook.getGroup(groupName!).getId(), name: groupName! } : undefined
    }
}

/**
 * Check if Inventory Book has pending tasks
 * 
 * @public
 */
function validate(bookId: string): void {
    const book = BkperApp.getBook(bookId);
    const inventoryBook = BotService.getInventoryBook(book);
    if (inventoryBook == null) {
        throw `Inventory Book not found in the collection. Please set the property ${INVENTORY_BOOK_PROP} to the Inventory Book.`;
    }
    if (BotService.hasPendingTasks(inventoryBook)) {
        throw `Cannot start operation: Inventory Book has pending tasks`;
    }
}

/**
 * Calculate cost of sales for goods
 * 
 * @public
 */
function calculateCostOfSales(contextParams: ContextParams, toDate?: string): { accountName: string, result: string }[] {
    // Log user inputs
    console.log(`book id: ${contextParams.book.id}, account id: ${contextParams.account?.id}, date input: ${toDate}`);

    const accountsToCalculate = getAccountsToCalculate(contextParams);

    let results: { accountName: string, result: string }[] = [];
    for (const account of accountsToCalculate) {
        const summary = CostOfSalesService.calculateCostOfSalesForAccount(contextParams.book.id, account.accountId, toDate);
        results.push({ accountName: account.accountName, result: summary.getResult() });
    }

    return results;
}

/**
 * Get the accounts to calculate COGS
 * 
 * @public
 */
function getAccountsToCalculate(contextParams: ContextParams): { accountName: string, accountId: string }[] {
    const book = BkperApp.getBook(contextParams.book.id);
    const inventoryBook = BotService.getInventoryBook(book);
    if (inventoryBook == null) {
        throw `Inventory Book not found in the collection. Please set the property ${INVENTORY_BOOK_PROP} to the Inventory Book.`;
    }

    let accountsMap = new Map<string, string>();
    if (contextParams.account) {
        const account = inventoryBook.getAccount(contextParams.account.id);
        accountsMap.set(account.getName(), account.getId());
    } else if (contextParams.group) {
        const group = inventoryBook.getGroup(contextParams.group.id);
        const accounts = group.getAccounts();
        for (const account of accounts) {
            if (account.getType() == BkperApp.AccountType.ASSET) {
                accountsMap.set(account.getName(), account.getId());
            }
        }
    } else {
        const accounts = inventoryBook.getAccounts();
        for (const account of accounts) {
            if (account.getType() == BkperApp.AccountType.ASSET) {
                accountsMap.set(account.getName(), account.getId());
            }
        }
    }
    accountsMap = new Map([...accountsMap.entries()].sort());

    let accountsToCalculate: { accountName: string, accountId: string }[] = [];
    for (const [accountName, accountId] of accountsMap) {
        accountsToCalculate.push({ accountName: accountName, accountId: accountId });
    }
    return accountsToCalculate;
}

/**
 * Reset cost of sales for goods
 * 
 * @public
 */
function resetCostOfSales(contextParams: ContextParams): { accountName: string, result: string }[] {
    let results: { accountName: string, result: string }[] = [];

    // Log user inputs
    console.log(`book id: ${contextParams.book.id}, account id: ${contextParams.account?.id}`);

    const accountsToReset = getAccountsToReset(contextParams).sort((a, b) => a.getName().localeCompare(b.getName()));
    for (const account of accountsToReset) {
        const summary = CostOfSalesService.resetCostOfSalesForAccount(contextParams.book.id, account.getId());
        results.push({ accountName: account.getName(), result: summary.getResult() });
    }
    
    return results;
}

/**
 * Get the accounts to reset COGS
 * 
 * @public
 */
function getAccountsToReset(contextParams: ContextParams): Bkper.Account[] {
    let accountsToReset: Bkper.Account[] = [];

    const book = BkperApp.getBook(contextParams.book.id);
    const inventoryBook = BotService.getInventoryBook(book);
    if (inventoryBook == null) {
        throw `Inventory Book not found in the collection. Please set the property ${INVENTORY_BOOK_PROP} to the Inventory Book.`;
    }

    const accounts = inventoryBook.getAccounts();
    for (const account of accounts) {
        if (account.getType() == BkperApp.AccountType.ASSET) {
            accountsToReset.push(account);
        }
    }

    return accountsToReset;
}