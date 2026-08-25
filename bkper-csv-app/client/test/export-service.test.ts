import { describe, expect, it } from 'bun:test';
import { Transaction } from 'bkper-js';
import { defaultExportOptions } from '../src/export-config';
import {
    createCsvExportService,
    getEffectiveTransactionsQuery,
    listTransactionsForExport,
    type BookForExport,
    type TransactionListForExport,
    type TransactionsDataTableBuilderForExport,
} from '../src/export-service';

function transactionList(cursor?: string): TransactionListForExport {
    return {
        async getAccount() {
            return undefined;
        },
        getCursor() {
            return cursor;
        },
        getItems() {
            return [];
        },
    };
}

describe('transaction export loading', () => {
    it('uses an empty query string to export all transactions when no query is provided', async () => {
        const calls: Array<{ query?: string; limit?: number; cursor?: string }> = [];
        const book: BookForExport = {
            async listTransactions(query, limit, cursor) {
                calls.push({ query, limit, cursor });
                return transactionList();
            },
        };

        await listTransactionsForExport(book, { query: '   ' });

        expect(calls).toEqual([{ query: '', limit: 1000, cursor: undefined }]);
    });

    it('resolves effective query values', () => {
        expect(getEffectiveTransactionsQuery('')).toBe('');
        expect(getEffectiveTransactionsQuery('   ')).toBe('');
        expect(getEffectiveTransactionsQuery(' after:2026 ')).toBe('after:2026');
    });

    it('trims query text before loading transactions', async () => {
        const calls: Array<{ query?: string; limit?: number; cursor?: string }> = [];
        const book: BookForExport = {
            async listTransactions(query, limit, cursor) {
                calls.push({ query, limit, cursor });
                return transactionList();
            },
        };

        await listTransactionsForExport(book, { query: '  after:2026  ' });

        expect(calls).toEqual([{ query: 'after:2026', limit: 1000, cursor: undefined }]);
    });

    it('loads all transaction pages', async () => {
        const calls: Array<{ cursor?: string }> = [];
        const pages = [transactionList('next-page'), transactionList()];
        const book: BookForExport = {
            async listTransactions(_query, _limit, cursor) {
                calls.push({ cursor });
                const page = pages.shift();
                if (!page) {
                    throw new Error('Unexpected extra page request');
                }
                return page;
            },
        };

        await listTransactionsForExport(book, { query: 'account:Bank' });

        expect(calls).toEqual([{ cursor: undefined }, { cursor: 'next-page' }]);
    });

    it('loads Book metadata and builds CSV through one service boundary', async () => {
        const transaction = Object.create(Transaction.prototype) as Transaction;
        const builder = createBuilder([
            ['Date', 'Description'],
            ['2026-08-25', 'Taxi; airport'],
        ]);
        const service = createCsvExportService({
            async getBook(bookId) {
                expect(bookId).toBe('book-123');
                return {
                    getName: () => 'Operations',
                    async listTransactions(query) {
                        expect(query).toBe('is:draft');
                        return {
                            async getAccount() {
                                return undefined;
                            },
                            getCursor() {
                                return undefined;
                            },
                            getItems() {
                                return [transaction];
                            },
                        };
                    },
                    createTransactionsDataTable() {
                        return builder;
                    },
                };
            },
        });

        expect(await service.getBookName('book-123')).toBe('Operations');
        expect(
            await service.createCsv('book-123', {
                query: 'is:draft',
                options: defaultExportOptions,
            })
        ).toEqual({
            csv: 'Date;Description\r\n2026-08-25;"Taxi; airport"',
            transactionCount: 1,
        });
    });
});

function createBuilder(rows: unknown[][]): TransactionsDataTableBuilderForExport {
    const builder: TransactionsDataTableBuilderForExport = {
        formatDates: () => builder,
        formatValues: () => builder,
        recordedAt: () => builder,
        ids: () => builder,
        properties: () => builder,
        hiddenProperties: () => builder,
        urls: () => builder,
        async build() {
            return rows;
        },
    };
    return builder;
}
