import { AccountType, type Account, type Book } from 'bkper-js';
import { EXC_CODE_PROP } from '../../shared/constants.js';

/** Legacy menu context rules shared by Account-level API operations. */
export class BotService {
    getFinancialBook(book: Book, excCode?: string | null): Book | null {
        const collection = book.getCollection();
        if (!collection || excCode == null) {
            return null;
        }
        for (const connectedBook of collection.getBooks()) {
            if (
                connectedBook.getFractionDigits() !== 0 &&
                this.getBookExchangeCode(connectedBook) === excCode
            ) {
                return connectedBook;
            }
        }
        return null;
    }

    async getAccountExcCode(account: Account): Promise<string | null> {
        const type = account.getType();
        if (type === AccountType.INCOMING || type === AccountType.OUTGOING) {
            return null;
        }
        for (const group of await account.getGroups()) {
            const exchangeCode = group.getProperty(EXC_CODE_PROP);
            if (exchangeCode != null && exchangeCode.trim() !== '') {
                return exchangeCode;
            }
        }
        return null;
    }

    private getBookExchangeCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }
}
