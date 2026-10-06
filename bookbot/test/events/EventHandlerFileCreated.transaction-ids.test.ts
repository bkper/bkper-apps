/// <reference types="@bkper/bkper-api-types" />

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Account, AccountType, Book, File, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerFileCreated } from '../../src/events/EventHandlerFileCreated.js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';

describe('EventHandlerFileCreated transaction IDs', () => {
    let context: AppContext;
    let account: Account;
    let file: File;
    let fileBook: Book;

    beforeEach(() => {
        account = {
            getId: () => 'account-1',
            getName: () => 'Bank',
            getType: () => AccountType.ASSET,
        } as unknown as Account;
        fileBook = { getId: () => 'book-1' } as unknown as Book;
        file = {
            getId: () => 'FILE:/123_A',
            getBook: () => fileBook,
            json: () => ({ id: 'FILE:/123_A' }),
        } as unknown as File;
        context = {
            bkper: { getBook: mock(async () => undefined) },
            createDiscovery: () => ({
                discover: mock(async () => ({ dataSet: undefined })),
                discoverProperties: mock(async () => undefined),
            }),
        } as unknown as AppContext;
    });


    it('does not attach the statement file to imported transactions', async () => {
        let importedTransactions: Transaction[] = [];
        const defaultBook = {
            getId: () => 'book-1',
            batchCreateTransactions: mock(async (transactions: Transaction[]) => {
                importedTransactions = transactions;
                return transactions;
            }),
        } as unknown as Book;
        fileBook = defaultBook;

        await new EventHandlerFileCreated(context).recordTransactions([
            { date: '2024-01-01', description: 'First row', amount: 10, properties: {} },
            { date: '2024-01-02', description: 'Last row', amount: 20, properties: {} },
        ], defaultBook, file, account);

        expect(importedTransactions).toHaveLength(2);
        expect(importedTransactions.every(transaction => transaction.getFiles().length === 0)).toBe(true);
    });

    // Confirms native IDs returned by each batch stay attached to the correct recording after sorting and routing.
    it('associates returned native IDs with sorted recordings across books and accounts', async () => {
        const createdTransaction = (id: string) => ({ getId: () => id } as unknown as Transaction);
        const defaultBatches: Transaction[][] = [];
        const routedBatches: Transaction[][] = [];
        const namedAccount = {
            getId: () => 'account-3',
            getName: () => 'Checking',
            getType: () => AccountType.ASSET,
        } as unknown as Account;
        const routedAccount = {
            getId: () => 'account-2',
            getName: () => 'Savings',
            getType: () => AccountType.ASSET,
        } as unknown as Account;
        const routedBook = {
            getId: () => 'book-2',
            getAccount: mock(async (name: string) => name === 'Savings' ? routedAccount : undefined),
            batchCreateTransactions: mock(async (transactions: Transaction[]) => {
                routedBatches.push(transactions);
                return transactions.map(transaction => createdTransaction(`created-${transaction.getDescription()}`));
            }),
        } as unknown as Book;
        const defaultBook = {
            getId: () => 'book-1',
            getAccount: mock(async (name: string) => name === 'Checking' ? namedAccount : undefined),
            batchCreateTransactions: mock(async (transactions: Transaction[]) => {
                defaultBatches.push(transactions);
                return transactions.map(transaction => createdTransaction(`created-${transaction.getDescription()}`));
            }),
        } as unknown as Book;
        fileBook = defaultBook;
        context.bkper.getBook = mock(async (bookId: string) => bookId === 'book-2' ? routedBook : defaultBook);

        const extracted: ExtractedTransaction[] = [
            { date: '2024-02-01', description: 'Default late', amount: 100, properties: {} },
            { date: '2024-01-15', description: 'Routed book', amount: -25, properties: {}, book_id: 'book-2', account_name: 'Savings' },
            { date: '2024-01-01', description: 'Default early', amount: 50, properties: {} },
            { date: '2024-01-10', description: 'Named default', amount: 75, properties: {}, account_name: 'Checking' },
        ];

        const createdBatches = await new EventHandlerFileCreated(context).recordTransactions(extracted, defaultBook, file, account);
        const recordingsByDescription = new Map(
            createdBatches.flatMap(batch => batch.recordings.map(recording => [recording.extracted.description, recording]))
        );

        expect(defaultBatches[0].map(transaction => transaction.getDescription())).toEqual([
            'Default early',
            'Named default',
            'Default late',
        ]);
        expect(routedBatches[0].map(transaction => transaction.getDescription())).toEqual(['Routed book']);
        expect(recordingsByDescription.get('Default early')?.transactionId).toBe('created-Default early');
        expect(recordingsByDescription.get('Named default')?.transactionId).toBe('created-Named default');
        expect(recordingsByDescription.get('Default late')?.transactionId).toBe('created-Default late');
        expect(recordingsByDescription.get('Routed book')?.transactionId).toBe('created-Routed book');
    });
});
