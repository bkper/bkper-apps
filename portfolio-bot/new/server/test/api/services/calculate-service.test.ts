import { describe, expect, test } from 'bun:test';
import { AccountType, Bkper, Book, TransactionList } from 'bkper-js';
import { CalculateService } from '../../../src/api/services/calculate-service.js';
import { AppContext } from '../../../src/shared/app-context.js';

describe('Calculate service pending-calculation Account query', () => {
    test('loads the Portfolio Book chart and returns the legacy pending Account ids', async () => {
        const portfolioBook = new Book({
            id: 'portfolio-book',
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
