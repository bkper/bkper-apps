import { describe, expect, it } from 'bun:test';
import {
    collectCandidateTransactions,
    filterEligibleTransactions,
    type TransactionFingerprint,
} from '../src/services/candidate-service';

function tx(
    id: string,
    overrides: Partial<TransactionFingerprint & bkper.Transaction> = {}
): bkper.Transaction {
    return {
        id,
        date: '2026-06-10',
        amount: '10.00',
        description: `Transaction ${id}`,
        posted: true,
        creditAccount: { id: 'bank', name: 'Bank' },
        debitAccount: { id: `other-${id}`, name: `Other ${id}` },
        properties: {},
        ...overrides,
    };
}

describe('deterministic candidate filtering', () => {
    it('excludes trashed, checked, and locked transactions with exclusive counts', () => {
        const result = filterEligibleTransactions(
            [
                tx('ok', { date: '2026-06-11' }),
                tx('trashed', { trashed: true, checked: true }),
                tx('checked', { checked: true }),
                tx('locked', { date: '2026-06-01' }),
            ],
            '2026-06-01'
        );

        expect(result.transactions.map(item => item.id)).toEqual(['ok']);
        expect(result.skipped).toEqual({ total: 3, trashed: 1, checked: 1, locked: 1 });
    });

    it('preserves display metadata needed to match the main transaction list', () => {
        const result = filterEligibleTransactions([
            tx('typed', {
                dateFormatted: '10/06/2026',
                creditAccount: { id: 'bank', name: 'Bank', type: 'ASSET' },
                debitAccount: { id: 'expense', name: 'Expense', type: 'OUTGOING' },
            }),
        ]);

        expect(result.transactions[0]).toMatchObject({
            dateFormatted: '10/06/2026',
            fromAccount: { id: 'bank', name: 'Bank', type: 'ASSET' },
            toAccount: { id: 'expense', name: 'Expense', type: 'OUTGOING' },
        });
    });

    it('requires equal amounts, dates within seven calendar days, and a shared same-side account', () => {
        const current = [
            tx('current', {
                date: '2026-06-10',
                amount: '10.0',
                creditAccount: { id: 'bank', name: 'Bank' },
                debitAccount: { id: 'expense', name: 'Expense' },
            }),
        ];
        const previous = [
            tx('same-from', { date: '2026-06-03', amount: '10.00' }),
            tx('same-to', {
                date: '2026-06-12',
                creditAccount: { id: 'card', name: 'Card' },
                debitAccount: { id: 'expense', name: 'Expense' },
            }),
            tx('opposite-side', {
                creditAccount: { id: 'expense', name: 'Expense' },
                debitAccount: { id: 'bank', name: 'Bank' },
            }),
            tx('too-late', { date: '2026-06-02' }),
            tx('different-amount', { amount: '10.01' }),
        ];

        const result = collectCandidateTransactions(previous, current);

        expect(result.pairCount).toBe(2);
        expect(result.transactions.map(transaction => transaction.id)).toEqual([
            'same-from',
            'same-to',
            'current',
        ]);
    });

    it('allows drafts with discovered Account conflicts to qualify from amount, date, and description', () => {
        const posted = tx('posted', {
            creditAccount: { id: 'bank', name: 'Bank' },
            debitAccount: { id: 'expense', name: 'Expense' },
            description: 'Intercom charge',
        });
        const discoveredDraft = tx('discovered-draft', {
            posted: false,
            creditAccount: { id: 'wrong-bank', name: 'Wrong Bank' },
            debitAccount: { id: 'wrong-expense', name: 'Wrong Expense' },
            description: 'Intercom, Inc.',
        });
        const blankDraft = tx('blank-draft', {
            posted: false,
            creditAccount: undefined,
            debitAccount: undefined,
            description: '',
        });

        const result = collectCandidateTransactions([], [posted, discoveredDraft, blankDraft]);

        expect(result.pairCount).toBe(1);
        expect(result.transactions.map(transaction => transaction.id)).toEqual([
            'posted',
            'discovered-draft',
        ]);
    });

    it('only emits cross-page pairs involving the current page', () => {
        const previous = [tx('old-a'), tx('old-b')];
        const current = [tx('new')];

        const result = collectCandidateTransactions(previous, current);

        expect(result.pairCount).toBe(2);
        expect(result.transactions.map(transaction => transaction.id)).toEqual([
            'old-a',
            'old-b',
            'new',
        ]);
    });

    it('collects each participating transaction once in listing order without materializing pairs', () => {
        const unrelated = tx('unrelated', { amount: '99' });
        const first = tx('first');
        const second = tx('second');
        const third = tx('third');

        const result = collectCandidateTransactions([], [unrelated, first, second, third]);

        expect(result.pairCount).toBe(3);
        expect(result.transactions.map(transaction => transaction.id)).toEqual([
            'first',
            'second',
            'third',
        ]);
    });
});
