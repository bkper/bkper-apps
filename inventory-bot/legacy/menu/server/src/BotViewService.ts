namespace BotViewService {

    export function getBotViewTemplate(bookId: string, accountId: string, groupId: string): GoogleAppsScript.HTML.HtmlOutput {

        const book = BkperApp.getBook(bookId);
        const inventoryBook = BotService.getInventoryBook(book);
        if (inventoryBook == null) {
            throw 'Inventory Book not found in the collection';
        }

        // Account, Group
        const group = book.getGroup(groupId);
        let groupName = group ? group.getName() : undefined;

        const account = book.getAccount(accountId);
        let inventoryAccount: Bkper.Account | undefined = undefined;
        if (account) {
            inventoryAccount = inventoryBook.getAccount(account.getName());
        }

        const template = HtmlService.createTemplateFromFile('BotView');

        template.book = { id: inventoryBook.getId(), name: inventoryBook.getName() };
        template.account = inventoryAccount ? { id: inventoryAccount.getId(), name: inventoryAccount.getName() } : undefined;
        template.group = group ? { id: inventoryBook.getGroup(groupName!).getId(), name: groupName! } : undefined;

        return template.evaluate().setTitle('Inventory Bot').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

}