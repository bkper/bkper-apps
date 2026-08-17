import { describe, expect, it } from 'bun:test';
import {
    filterEligibleTransactions,
    generateCandidatePairs,
    retainNonOverlappingSuggestions,
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

        expect(generateCandidatePairs(previous, current).map(pair => pair.key)).toEqual([
            'current|same-from',
            'current|same-to',
        ]);
    });

    it('allows incomplete drafts to qualify from amount, date, and description', () => {
        const complete = tx('complete');
        const draft = tx('draft', {
            posted: false,
            creditAccount: undefined,
            debitAccount: undefined,
            description: 'Card purchase pending',
        });
        const blankDraft = tx('blank-draft', {
            posted: false,
            creditAccount: undefined,
            debitAccount: undefined,
            description: '',
        });

        expect(
            generateCandidatePairs([], [complete, draft, blankDraft]).map(pair => pair.key)
        ).toEqual(['complete|draft']);
    });

    it('only emits cross-page pairs involving the current page', () => {
        const previous = [tx('old-a'), tx('old-b')];
        const current = [tx('new')];

        expect(generateCandidatePairs(previous, current).map(pair => pair.key)).toEqual([
            'new|old-a',
            'new|old-b',
        ]);
    });

    it('ranks strong suggestions first and deterministically removes overlaps', () => {
        const pairs = generateCandidatePairs([], [tx('a'), tx('b'), tx('c')]);
        const retained = retainNonOverlappingSuggestions(pairs, [
            { pairIndex: 0, duplicate: true, strength: 'Possible', explanation: 'Possible match' },
            { pairIndex: 1, duplicate: true, strength: 'Strong', explanation: 'Best match' },
            { pairIndex: 2, duplicate: true, strength: 'Strong', explanation: 'Also strong' },
        ]);

        expect(retained.map(item => item.key)).toEqual(['a|c']);
    });
});
