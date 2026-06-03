import type { Account, Transaction } from 'bkper-js';

export interface TransactionsForExport {
    transactions: Transaction[];
    account?: Account;
}

export interface TransactionListForExport {
    getAccount(): Promise<Account | undefined>;
    getCursor(): string | undefined;
    getItems(): Transaction[];
}

export interface BookForExport {
    listTransactions(
        query?: string,
        limit?: number,
        cursor?: string,
    ): Promise<TransactionListForExport>;
}

export interface ListTransactionsOptions {
    query: string;
    pageSize?: number;
    onProgress?: (loaded: number) => void;
}

const DEFAULT_PAGE_SIZE = 1000;

export async function listTransactionsForExport(
    book: BookForExport,
    options: ListTransactionsOptions,
): Promise<TransactionsForExport> {
    const transactions: Transaction[] = [];
    const query = options.query.trim();
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    let cursor: string | undefined;
    let account: Account | undefined;

    do {
        const list = await book.listTransactions(query, pageSize, cursor);
        account ??= await list.getAccount();
        transactions.push(...list.getItems());
        options.onProgress?.(transactions.length);
        cursor = list.getCursor();
    } while (cursor);

    return { transactions, account };
}
