import { describe, expect, test } from 'bun:test';
import { Amount, Book, Transaction } from 'bkper-js';
import { CalculateRealizedResultsProcessor } from '../../../../src/api/services/calculate/calculate-realized-results-processor.js';

interface BatchCall {
    phase: string;
    transactions: Transaction[];
    includeChecked?: boolean;
}

function createBooks(): { portfolioBook: Book; financialBook: Book; baseBook: Book } {
    return {
        portfolioBook: new Book({ id: 'portfolio-book' }),
        financialBook: new Book({ id: 'financial-book' }),
        baseBook: new Book({ id: 'base-book' }),
    };
}

function createTransaction(book: Book, payload: bkper.Transaction, locked = false): Transaction {
    const transaction = new Transaction(book, payload);
    transaction.isLocked = () => locked;
    return transaction;
}

function createMtmTransaction(
    book: Book,
    remoteId: string,
    date: string,
    amount: number,
    debitAccountName: string
): Transaction {
    const transaction = createTransaction(book, { remoteIds: [remoteId] });
    transaction.getDate = () => date;
    transaction.getAmount = () => new Amount(amount);
    transaction.getDebitAccountName = async () => debitAccountName;
    return transaction;
}

describe('legacy CalculateRealizedResultsProcessor', () => {
    test('generates and reads temporary ids and skips empty phases', async () => {
        const { portfolioBook, financialBook, baseBook } = createBooks();
        const processor = new CalculateRealizedResultsProcessor(
            portfolioBook,
            financialBook,
            baseBook
        );
        const originalRandomUuid = crypto.randomUUID;
        Object.defineProperty(crypto, 'randomUUID', {
            configurable: true,
            value: () => '00000000-0000-4000-8000-000000000000',
        });

        try {
            expect(processor.generateTemporaryId()).toBe(
                'crrp_id_00000000-0000-4000-8000-000000000000'
            );
        } finally {
            Object.defineProperty(crypto, 'randomUUID', {
                configurable: true,
                value: originalRandomUuid,
            });
        }
        expect(
            processor.getTemporaryId(
                createTransaction(portfolioBook, {
                    remoteIds: ['other', 'crrp_id_temporary', 'later'],
                })
            )
        ).toBe('crrp_id_temporary');
        expect(processor.getTemporaryId(createTransaction(portfolioBook, {}))).toBe('');
        await expect(processor.fireBatchOperations()).resolves.toBeUndefined();
    });

    test('tracks MTM balances by prefix, date, and movement direction', async () => {
        const { portfolioBook, financialBook, baseBook } = createBooks();
        const processor = new CalculateRealizedResultsProcessor(
            portfolioBook,
            financialBook,
            baseBook
        );

        processor.setFinancialBookTransactionToCreate(
            createMtmTransaction(
                financialBook,
                'mtm_first',
                '2025-01-01',
                5,
                'Instrument Unrealized'
            )
        );
        processor.setFinancialBookTransactionToCreate(
            createMtmTransaction(financialBook, 'mtm_second', '2025-01-02', 8, 'Instrument')
        );
        processor.setFinancialBookTransactionToCreate(
            createMtmTransaction(financialBook, 'mtm_later', '2025-01-03', 100, 'Instrument')
        );
        processor.setFinancialBookTransactionToCreate(
            createMtmTransaction(
                financialBook,
                'mtm_hist_first',
                '2025-01-01',
                2,
                'Instrument Unrealized Hist'
            )
        );
        processor.setFinancialBookTransactionToCreate(
            createMtmTransaction(financialBook, 'mtm_hist_second', '2025-01-02', 7, 'Instrument')
        );

        expect((await processor.getMtmBalance('2025-01-02')).toString()).toBe('3');
        expect((await processor.getHistMtmBalance('2025-01-02')).toString()).toBe('5');
    });

    test('replaces deduplicated entries and canonicalizes dependent ids in phase order', async () => {
        const { portfolioBook, financialBook, baseBook } = createBooks();
        const calls: BatchCall[] = [];
        portfolioBook.batchCreateTransactions = async transactions => {
            calls.push({ phase: 'portfolio-create', transactions });
            return transactions.map(
                (transaction, index) =>
                    new Transaction(portfolioBook, {
                        id: `canonical-${index + 1}`,
                        remoteIds: transaction.getRemoteIds(),
                    })
            );
        };
        portfolioBook.batchUpdateTransactions = async (transactions, includeChecked) => {
            calls.push({ phase: 'portfolio-update', transactions, includeChecked });
            return transactions;
        };
        financialBook.batchCreateTransactions = async transactions => {
            calls.push({ phase: 'financial-create', transactions });
            return transactions;
        };
        baseBook.batchCreateTransactions = async transactions => {
            calls.push({ phase: 'base-create', transactions });
            return transactions;
        };
        const processor = new CalculateRealizedResultsProcessor(
            portfolioBook,
            financialBook,
            baseBook
        );
        const replacedPortfolioCreate = createTransaction(portfolioBook, {
            remoteIds: ['crrp_id_first'],
        });
        const replacementPortfolioCreate = createTransaction(portfolioBook, {
            remoteIds: ['crrp_id_first'],
        });
        const secondPortfolioCreate = createTransaction(portfolioBook, {
            remoteIds: ['crrp_id_second'],
        });
        const replacedPortfolioUpdate = createTransaction(portfolioBook, {
            id: 'portfolio-update',
        });
        const replacementPortfolioUpdate = createTransaction(portfolioBook, {
            id: 'portfolio-update',
        });
        const realized = createTransaction(financialBook, { remoteIds: ['crrp_id_first'] });
        const historicalRealized = createTransaction(financialBook, {
            remoteIds: ['hist_crrp_id_first'],
        });
        const mtm = createTransaction(financialBook, {
            remoteIds: ['mtm_crrp_id_first'],
        });
        const historicalMtm = createTransaction(financialBook, {
            remoteIds: ['mtm_hist_crrp_id_first'],
        });
        const fx = createTransaction(baseBook, { remoteIds: ['fx_crrp_id_first'] });
        const historicalFx = createTransaction(baseBook, {
            remoteIds: ['fx_hist_crrp_id_first'],
        });

        processor.setStockBookTransactionToCreate(replacedPortfolioCreate);
        processor.setStockBookTransactionToCreate(replacementPortfolioCreate);
        processor.setStockBookTransactionToCreate(secondPortfolioCreate);
        processor.setStockBookTransactionToUpdate(replacedPortfolioUpdate);
        processor.setStockBookTransactionToUpdate(replacementPortfolioUpdate);
        processor.setFinancialBookTransactionToCreate(realized);
        processor.setFinancialBookTransactionToCreate(historicalRealized);
        processor.setFinancialBookTransactionToCreate(mtm);
        processor.setFinancialBookTransactionToCreate(historicalMtm);
        processor.setBaseBookTransactionToCreate(fx);
        processor.setBaseBookTransactionToCreate(historicalFx);

        await expect(processor.fireBatchOperations()).resolves.toBeUndefined();

        expect(calls.map(call => call.phase)).toEqual([
            'portfolio-create',
            'portfolio-update',
            'financial-create',
            'base-create',
        ]);
        expect(calls[0]?.transactions).toEqual([replacementPortfolioCreate, secondPortfolioCreate]);
        expect(calls[1]?.transactions).toEqual([replacementPortfolioUpdate]);
        expect(calls[1]?.includeChecked).toBe(true);
        expect(realized.getRemoteIds()).toEqual(['crrp_id_first', 'canonical-1']);
        expect(historicalRealized.getRemoteIds()).toEqual([
            'hist_crrp_id_first',
            'hist_canonical-1',
        ]);
        expect(mtm.getRemoteIds()).toEqual(['mtm_crrp_id_first', 'mtm_canonical-1']);
        expect(historicalMtm.getRemoteIds()).toEqual([
            'mtm_hist_crrp_id_first',
            'mtm_hist_canonical-1',
        ]);
        expect(fx.getRemoteIds()).toEqual(['fx_crrp_id_first', 'fx_canonical-1']);
        expect(historicalFx.getRemoteIds()).toEqual([
            'fx_hist_crrp_id_first',
            'fx_hist_canonical-1',
        ]);
    });

    test('checks every queued Transaction for locks and stops after a failed phase', async () => {
        const setters: Array<
            (processor: CalculateRealizedResultsProcessor, transaction: Transaction) => void
        > = [
            (processor, transaction) => processor.setStockBookTransactionToCreate(transaction),
            (processor, transaction) => processor.setStockBookTransactionToUpdate(transaction),
            (processor, transaction) => processor.setFinancialBookTransactionToCreate(transaction),
            (processor, transaction) => processor.setBaseBookTransactionToCreate(transaction),
        ];
        for (const setTransaction of setters) {
            const { portfolioBook, financialBook, baseBook } = createBooks();
            const processor = new CalculateRealizedResultsProcessor(
                portfolioBook,
                financialBook,
                baseBook
            );
            expect(processor.hasLockedTransaction()).toBe(false);
            setTransaction(
                processor,
                createTransaction(portfolioBook, { id: 'locked', remoteIds: ['locked'] }, true)
            );
            expect(processor.hasLockedTransaction()).toBe(true);
        }

        const { portfolioBook, financialBook, baseBook } = createBooks();
        const calls: string[] = [];
        const createError = new Error('Portfolio create failed');
        portfolioBook.batchCreateTransactions = async () => {
            calls.push('portfolio-create');
            throw createError;
        };
        portfolioBook.batchUpdateTransactions = async transactions => {
            calls.push('portfolio-update');
            return transactions;
        };
        financialBook.batchCreateTransactions = async transactions => {
            calls.push('financial-create');
            return transactions;
        };
        baseBook.batchCreateTransactions = async transactions => {
            calls.push('base-create');
            return transactions;
        };
        const processor = new CalculateRealizedResultsProcessor(
            portfolioBook,
            financialBook,
            baseBook
        );
        processor.setStockBookTransactionToCreate(
            createTransaction(portfolioBook, { remoteIds: ['crrp_id_first'] })
        );
        processor.setStockBookTransactionToUpdate(
            createTransaction(portfolioBook, { id: 'portfolio-update' })
        );
        processor.setFinancialBookTransactionToCreate(
            createTransaction(financialBook, { remoteIds: ['financial'] })
        );
        processor.setBaseBookTransactionToCreate(
            createTransaction(baseBook, { remoteIds: ['base'] })
        );

        await expect(processor.fireBatchOperations()).rejects.toBe(createError);
        expect(calls).toEqual(['portfolio-create']);
    });
});
