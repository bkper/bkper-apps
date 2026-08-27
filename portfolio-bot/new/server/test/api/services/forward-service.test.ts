import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Account, Bkper, Book } from 'bkper-js';
import { ForwardService } from '../../../src/api/services/forward-service.js';
import { ForwardDateService } from '../../../src/api/services/forward/forward-date-service.js';
import type { OperationContext } from '../../../src/api/services/operation-service.js';
import { Summary } from '../../../src/api/services/summary.js';
import { AppContext } from '../../../src/shared/app-context.js';

interface ForwardCall {
    portfolioBookId: string;
    accountId: string | undefined;
    financialBookId: string;
    baseBookId: string;
    date: string;
}

const originalExecute = ForwardDateService.prototype.execute;
let forwardCalls: ForwardCall[] = [];

beforeEach(() => {
    forwardCalls = [];
    ForwardDateService.prototype.execute = async (context, date) => {
        forwardCalls.push({
            portfolioBookId: context.portfolioBook.getId(),
            accountId: context.portfolioAccount.getId(),
            financialBookId: context.financialBook.getId(),
            baseBookId: context.baseBook.getId(),
            date,
        });
        return new Summary().done('Forwarded');
    };
});

afterEach(() => {
    ForwardDateService.prototype.execute = originalExecute;
});

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
        const response = await TestForwardService.execute(
            context,
            'portfolio-book',
            'instrument-account',
            {
                date: '2026-09-01',
            }
        );

        expect(response).toEqual({ message: 'Forwarded' });
        expect(loads).toEqual(['financial-book']);
        expect(operationContext.financialBook).toBe(fullFinancialBook);
        expect(operationContext.baseBook).toBe(leanBaseBook);
        expect(forwardCalls).toEqual([
            {
                portfolioBookId: 'portfolio-book',
                accountId: 'instrument-account',
                financialBookId: 'financial-book',
                baseBookId: 'base-book',
                date: '2026-09-01',
            },
        ]);

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
        expect(forwardCalls.at(-1)).toEqual({
            portfolioBookId: 'portfolio-book',
            accountId: 'instrument-account',
            financialBookId: 'financial-book',
            baseBookId: 'financial-book',
            date: '2026-09-01',
        });
    });

    test('returns a structured invalid-request error for a Forward validation outcome', async () => {
        ForwardDateService.prototype.execute = async () =>
            new Summary().forwardError('Cannot set forward date: account has uncalculated results');

        class TestForwardService extends ForwardService {
            protected static override async resolveContext(): Promise<OperationContext> {
                const portfolioBook = new Book({ id: 'portfolio-book' });
                const portfolioAccount = new Account(portfolioBook, {
                    id: 'instrument-account',
                });
                const financialBook = new Book({ id: 'financial-book' });
                return {
                    portfolioBook,
                    portfolioAccount,
                    financialBook,
                    baseBook: financialBook,
                };
            }

            protected static override async validateContext(): Promise<void> {}

            protected static override async loadFullBook(): Promise<Book> {
                return new Book({ id: 'financial-book', accounts: [] });
            }
        }

        await expect(
            TestForwardService.execute(
                new AppContext(new Bkper(), { ASSETS: { fetch } }),
                'portfolio-book',
                'instrument-account',
                { date: '2026-09-01' }
            )
        ).rejects.toMatchObject({
            status: 400,
            message: 'Cannot set forward date: account has uncalculated results',
        });
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
