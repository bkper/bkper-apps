namespace BotViewService {

    export function getBotViewTemplate(bookId: string, accountId: string, groupId: string): GoogleAppsScript.HTML.HtmlOutput {

        const book = BkperApp.getBook(bookId);
        const account = book.getAccount(accountId);
        const group = book.getGroup(groupId);

        const stockBook = BotService.getStockBook(book);
        if (stockBook == null) {
            throw 'Stock Book not found in the collection';
        }

        const template = HtmlService.createTemplateFromFile('BotView');
        template.dateToday = Utilities.formatDate(new Date(), book.getTimeZone(), 'yyyy-MM-dd');
        template.enableReset = true;

        if (stockBook.getPermission() == BkperApp.Permission.OWNER && checkIfAllBooksAreUnlocked(book)) {
            template.enableFullReset = true;
        } else {
            template.enableFullReset = false;
        }

        template.book = { id: stockBook.getId(), name: stockBook.getName() };
        template.accounts = [];
        template.group = {};

        let accountsExcCodes = new Set<string>();

        if (account) {
            let stockAccount = stockBook.getAccount(account.getName());
            addAccount(stockAccount);
        } else if (group) {
            let stockGroup = stockBook.getGroup(group.getName());
            if (stockGroup) {
                template.group = {
                    id: group.getId(),
                    name: group.getName()
                }
                for (const account of stockGroup.getAccounts()) {
                    addAccount(account);
                }
            }
        } else {
            for (const account of BotService.getUncalculatedAccounts(stockBook, BotService.getBaseBook(book))) {
                addAccount(account);
            }
            template.enableReset = false;
            template.enableFullReset = false;
        }

        function addAccount(account: Bkper.Account) {
            if (!account) {
                return;
            }
            const stockAccount = new StockAccount(account);
            if (!stockAccount.isPermanent() || stockAccount.isArchived() || !stockAccount.getExchangeCode()) {
                // bypass non permanent accounts
                return;
            }
            if (account == null || (account != null && account.getNormalizedName() == stockAccount.getNormalizedName())) {
                template.accounts.push({
                    id: stockAccount.getId(),
                    name: stockAccount.getName()
                });
                accountsExcCodes.add(stockAccount.getExchangeCode());
            }
        }

        // Batch size
        const batchSize = 15;

        template.accounts.sort((a: { name: string; }, b: { name: string; }) => a.name.localeCompare(b.name));
        // @ts-ignore
        const accountIds = template.accounts.map(a => a.id);
        template.chunckedAccountsIds = BotService.chunk(accountIds, batchSize);

        const bookExcCodesUserCanEdit = BotService.getBooksExcCodesUserCanEdit(book);

        let bookExcCodesUserCannotEdit: string[] = [];
        for (const code of Array.from(accountsExcCodes)) {
            if (!bookExcCodesUserCanEdit.has(code)) {
                bookExcCodesUserCannotEdit.push(code);
            }
        }

        if (bookExcCodesUserCannotEdit.length > 0) {
            template.permissionGranted = false;
            template.permissionError = `User needs EDITOR or OWNER permission in ${bookExcCodesUserCannotEdit.join(', ')} books`;
        } else {
            template.permissionGranted = true;
        }

        return template.evaluate().setTitle('Stock Bot').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    function checkIfAllBooksAreUnlocked(baseBook: Bkper.Book): boolean {
        let books = baseBook.getCollection().getBooks();
        console.log(`books: ${books.length}`);
        for (const book of books) {
            console.log(`book: ${book.getName()}, lockDate: ${book.getLockDate()}, closingDate: ${book.getClosingDate()}`);
            if ((!book.getLockDate() || book.getLockDate() == '1900-00-00') && (!book.getClosingDate() || book.getClosingDate() == '1900-00-00')) {
                continue;
            } else {
                return false;
            };
        };
        return true;
    }
}
