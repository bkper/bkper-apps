import { AccountType, type Account, type Book, type Transaction } from 'bkper-js';
import { CREDIT_NOTE_PROP, EXC_CODE_PROP, ORDER_PROP } from '../../shared/constants.js';

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

    async isSale(transaction: Transaction): Promise<boolean> {
        return (
            Boolean(transaction.isPosted()) &&
            (await transaction.getDebitAccount())!.getType() == AccountType.OUTGOING
        );
    }

    async isPurchase(transaction: Transaction): Promise<boolean> {
        return (
            Boolean(transaction.isPosted()) &&
            (await transaction.getCreditAccount())!.getType() == AccountType.INCOMING
        );
    }

    async isCreditNote(transaction: Transaction): Promise<boolean> {
        return (
            Boolean(transaction.isPosted()) &&
            (await transaction.getDebitAccount())!.getType() == AccountType.INCOMING &&
            transaction.getProperty(CREDIT_NOTE_PROP) != undefined
        );
    }

    compareToFIFO(tx1: Transaction, tx2: Transaction): number {
        let result = Number(tx1.getDateValue()) - Number(tx2.getDateValue());
        if (result == 0) {
            const order1 = tx1.getProperty(ORDER_PROP) ? +tx1.getProperty(ORDER_PROP)! : 0;
            const order2 = tx2.getProperty(ORDER_PROP) ? +tx2.getProperty(ORDER_PROP)! : 0;
            result = order1 - order2;
        }
        if (result == 0 && tx1.getCreatedAt() && tx2.getCreatedAt()) {
            result = tx1.getCreatedAt().getMilliseconds() - tx2.getCreatedAt().getMilliseconds();
        }
        return result;
    }

    getBeforeDateIsoString(book: Book, toDateIsoString: string): string {
        const toDate = book.parseDate(toDateIsoString);
        const beforeDate = new Date(toDate.getTime());
        beforeDate.setDate(beforeDate.getDate() + 1);
        return book.formatDate(beforeDate);
    }

    private getBookExchangeCode(book: Book): string | undefined {
        return book.getProperty(EXC_CODE_PROP, 'exchange_code');
    }
}
