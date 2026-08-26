import { describe, expect, test } from 'bun:test';
import { Account, Bkper, Book } from 'bkper-js';
import { ForwardService } from '../../../src/api/services/forward-service.js';
import type { OperationContext } from '../../../src/api/services/operation-service.js';
import { AppContext } from '../../../src/shared/app-context.js';

describe('Forward service operation', () => {
    test('loads the Financial chart and reuses it when it is also the Base Book', async () => {
        const portfolioBook = new Book({ id: 'portfolio-book' });
        const portfolioAccount = new Account(portfolioBook, { id: 'instrument-account' });
        const leanFinancialBook = new Book({ id: 'financial-book' });
        const leanBaseBook = new Book({ id: 'base-book' });
        const fullFinancialBook = new Book({ id: 'financial-book', accounts: [] });
        let operationContext: OperationContext = {
            portfolioBook,
            portfolioAccount,
            financialBook: leanFinancialBook,
            baseBook: leanBaseBook,
        };
        const loads: string[] = [];

        class TestForwardService extends ForwardService {
            protected static override async resolveContext(): Promise<OperationContext> {
                return operationContext;
            }

            protected static override async validateContext(): Promise<void> {}

            protected static override async loadFullBook(
                _context: AppContext,
                bookId: string
            ): Promise<Book> {
                loads.push(bookId);
                return fullFinancialBook;
            }
        }

        const context = new AppContext(new Bkper(), { ASSETS: { fetch } });
        await TestForwardService.execute(context, 'portfolio-book', 'instrument-account', {
            date: '2026-09-01',
        });

        expect(loads).toEqual(['financial-book']);
        expect(operationContext.financialBook).toBe(fullFinancialBook);
        expect(operationContext.baseBook).toBe(leanBaseBook);

        operationContext = {
            portfolioBook,
            portfolioAccount,
            financialBook: leanFinancialBook,
            baseBook: leanFinancialBook,
        };
        await TestForwardService.execute(context, 'portfolio-book', 'instrument-account', {
            date: '2026-09-01',
        });

        expect(operationContext.financialBook).toBe(fullFinancialBook);
        expect(operationContext.baseBook).toBe(fullFinancialBook);
    });

    test('resolves operation context before forwarding', async () => {
        const loadError = new Error('Portfolio Book unavailable');
        const bkper = new Bkper();
        bkper.getBook = async () => {
            throw loadError;
        };

        const request = ForwardService.execute(
            new AppContext(bkper, { ASSETS: { fetch } }),
            'portfolio-book',
            'instrument-account',
            { date: '2026-09-01' }
        );

        await expect(request).rejects.toBe(loadError);
    });
});
