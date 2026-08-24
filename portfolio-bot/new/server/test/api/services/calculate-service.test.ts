import { describe, expect, test } from 'bun:test';
import { AccountType, App, Bkper, Book, Permission, TransactionList } from 'bkper-js';
import { CalculateService } from '../../../src/api/services/calculate-service.js';
import { AppContext } from '../../../src/shared/app-context.js';

describe('Calculate service pending-calculation Account query', () => {
    test('rejects a non-viewer before querying pending-calculation Accounts', async () => {
        const portfolioBook = new Book({
            id: 'portfolio-book',
            permission: Permission.RECORDER,
        });
        let transactionQueries = 0;
        portfolioBook.listTransactions = async () => {
            transactionQueries += 1;
            return new TransactionList(portfolioBook, { items: [] });
        };
        const bkper = new Bkper();
        bkper.getBook = async () => portfolioBook;

        const request = CalculateService.listAccountsPendingCalculation(
            new AppContext(bkper, { ASSETS: { fetch } }),
            'portfolio-book'
        );

        await expect(request).rejects.toMatchObject({ status: 403 });
        expect(transactionQueries).toBe(0);
    });

    test('rejects a Book without Portfolio Bot before querying pending-calculation Accounts', async () => {
        const portfolioBook = new Book({
            id: 'portfolio-book',
            permission: Permission.VIEWER,
        });
        portfolioBook.getApps = async () => [];
        let transactionQueries = 0;
        portfolioBook.listTransactions = async () => {
            transactionQueries += 1;
            return new TransactionList(portfolioBook, { items: [] });
        };
        const bkper = new Bkper();
        bkper.getBook = async () => portfolioBook;

        const request = CalculateService.listAccountsPendingCalculation(
            new AppContext(bkper, { ASSETS: { fetch } }),
            'portfolio-book'
        );

        await expect(request).rejects.toMatchObject({
            status: 403,
            message: 'Portfolio Bot is not installed in this Book.',
        });
        expect(transactionQueries).toBe(0);
    });

    test('loads the Portfolio Book chart and returns the legacy pending Account ids', async () => {
        const portfolioBook = new Book({
            id: 'portfolio-book',
            permission: Permission.VIEWER,
            accounts: [
                {
                    id: 'instrument-account',
                    name: 'Instrument',
                    type: AccountType.ASSET,
                    permanent: true,
                    properties: { needs_rebuild: 'TRUE' },
                },
            ],
        });
        portfolioBook.getApps = async () => [new App({ id: 'stock-bot' })];
        portfolioBook.listTransactions = async () =>
            new TransactionList(portfolioBook, { items: [] });
        const bkper = new Bkper();
        const loads: Array<{ id: string; includeAccounts?: boolean }> = [];
        bkper.getBook = async (id, includeAccounts) => {
            loads.push({ id, includeAccounts });
            return portfolioBook;
        };
        const context = new AppContext(bkper, { ASSETS: { fetch } });

        const accountIds = await CalculateService.listAccountsPendingCalculation(
            context,
            'portfolio-book'
        );

        expect(accountIds).toEqual(['instrument-account']);
        expect(loads).toEqual([{ id: 'portfolio-book', includeAccounts: true }]);
    });
});
