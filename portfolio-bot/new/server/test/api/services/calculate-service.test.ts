import { describe, expect, test } from 'bun:test';
import { Account, AccountType, App, Bkper, Book, Permission, TransactionList } from 'bkper-js';
import { CalculateService } from '../../../src/api/services/calculate-service.js';
import type { OperationContext } from '../../../src/api/services/operation-service.js';
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

describe('Calculate service operation', () => {
    test('loads and reuses the Financial and Base Book charts before calculating', async () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const portfolioAccount = new Account(portfolioBook, { id: 'instrument-account' });
        const leanFinancialBook = new Book({ id: 'financial-book' });
        const leanBaseBook = new Book({ id: 'base-book' });
        const fullFinancialBook = new Book({ id: 'financial-book', accounts: [] });
        const fullBaseBook = new Book({ id: 'base-book', accounts: [] });
        let operationContext: OperationContext = {
            portfolioBook,
            portfolioAccount,
            financialBook: leanFinancialBook,
            baseBook: leanBaseBook,
        };
        const loads: string[] = [];

        class TestCalculateService extends CalculateService {
            protected static override async resolveContext(): Promise<OperationContext> {
                return operationContext;
            }

            protected static override async validateContext(): Promise<void> {}

            protected static override async loadFullBook(
                _context: AppContext,
                bookId: string
            ): Promise<Book> {
                loads.push(bookId);
                return bookId === 'financial-book' ? fullFinancialBook : fullBaseBook;
            }
        }

        const context = new AppContext(new Bkper(), { ASSETS: { fetch } });
        await TestCalculateService.calculate(context, 'portfolio-book', 'instrument-account', {
            date: '2026-08-05',
            performMtm: false,
        });

        expect(loads).toEqual(['financial-book', 'base-book']);
        expect(operationContext.financialBook).toBe(fullFinancialBook);
        expect(operationContext.baseBook).toBe(fullBaseBook);

        loads.length = 0;
        operationContext = {
            portfolioBook,
            portfolioAccount,
            financialBook: leanFinancialBook,
            baseBook: leanFinancialBook,
        };
        await TestCalculateService.calculate(context, 'portfolio-book', 'instrument-account', {
            date: '2026-08-05',
            performMtm: false,
        });

        expect(loads).toEqual(['financial-book']);
        expect(operationContext.financialBook).toBe(fullFinancialBook);
        expect(operationContext.baseBook).toBe(fullFinancialBook);
    });

    test('resolves operation context before calculating', async () => {
        const loadError = new Error('Portfolio Book unavailable');
        const bkper = new Bkper();
        bkper.getBook = async () => {
            throw loadError;
        };

        const request = CalculateService.calculate(
            new AppContext(bkper, { ASSETS: { fetch } }),
            'portfolio-book',
            'instrument-account',
            { date: '2026-08-05', performMtm: false }
        );

        await expect(request).rejects.toBe(loadError);
    });
});
