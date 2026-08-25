import type { Account, Transaction } from 'bkper-js';
import { dataTableToCsv } from './csv';
import { configureTransactionsDataTableBuilder } from './export-builder';
import type { TransactionsDataTableBuilderLike } from './export-builder';
import type { ExportOptions } from './export-config';

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
        cursor?: string
    ): Promise<TransactionListForExport>;
}

export interface TransactionsDataTableBuilderForExport extends TransactionsDataTableBuilderLike {
    build(): Promise<unknown[][]> | unknown[][];
}

export interface BookForCsvExport extends BookForExport {
    getName(): string | undefined;
    createTransactionsDataTable(
        transactions: Transaction[],
        account?: Account
    ): TransactionsDataTableBuilderForExport;
}

export interface BkperClientForCsvExport {
    getBook(bookId: string): Promise<BookForCsvExport>;
}

export interface CreateCsvOptions extends ListTransactionsOptions {
    options: ExportOptions;
    onBuilding?: () => void;
}

export interface CsvExportResult {
    csv: string | null;
    transactionCount: number;
}

export interface CsvExportService {
    getBookName(bookId: string): Promise<string>;
    createCsv(bookId: string, options: CreateCsvOptions): Promise<CsvExportResult>;
}

export function createCsvExportService(client: BkperClientForCsvExport): CsvExportService {
    return {
        async getBookName(bookId) {
            const book = await client.getBook(bookId);
            return book.getName() ?? bookId;
        },
        async createCsv(bookId, options) {
            const book = await client.getBook(bookId);
            const result = await listTransactionsForExport(book, options);
            if (result.transactions.length === 0) {
                return { csv: null, transactionCount: 0 };
            }

            options.onBuilding?.();
            const builder = configureTransactionsDataTableBuilder(
                book.createTransactionsDataTable(result.transactions, result.account),
                options.options
            );
            const dataTable = await builder.build();
            return {
                csv: dataTableToCsv(dataTable, options.options.delimiter),
                transactionCount: result.transactions.length,
            };
        },
    };
}

export interface ListTransactionsOptions {
    query: string;
    pageSize?: number;
    onProgress?: (loaded: number) => void;
}

const DEFAULT_PAGE_SIZE = 1000;

export function getEffectiveTransactionsQuery(query: string): string {
    return query.trim();
}

export async function listTransactionsForExport(
    book: BookForExport,
    options: ListTransactionsOptions
): Promise<TransactionsForExport> {
    const transactions: Transaction[] = [];
    const query = getEffectiveTransactionsQuery(options.query);
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
