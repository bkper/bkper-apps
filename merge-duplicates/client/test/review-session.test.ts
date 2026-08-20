import { describe, expect, it } from 'bun:test';
import { ReviewSession, suggestionKey, type ReviewApi } from '../src/app/review-session';
import type { AnalyzeResponse, Suggestion, Transaction } from '../src/api/app-api';

function transaction(id: string): Transaction & { id: string } {
    return {
        id,
        date: '2026-06-10',
        amount: '10',
        description: id,
        posted: true,
        creditAccount: { id: 'bank', name: 'Bank' },
        debitAccount: { id, name: id },
        properties: {},
    };
}

function suggestion(firstId: string, secondId: string): Suggestion {
    return {
        strength: 'Strong',
        explanation: 'Likely duplicate',
        transactions: [transaction(firstId), transaction(secondId)],
    };
}

function analysis(suggestions: Suggestion[]): AnalyzeResponse {
    return {
        suggestions,
        skipped: { total: 0, checked: 0, trashed: 0, locked: 0, invalid: 0 },
    };
}

describe('browser-memory review session', () => {
    it('derives order-independent keys and preserves decisions when suggestions are replaced', () => {
        const session = new ReviewSession();
        const one = suggestion('b', 'a');
        const removed = suggestion('c', 'd');
        session.replaceAnalysis(
            analysis([one, removed]),
            [transaction('a'), transaction('b')],
            'next'
        );

        expect(suggestionKey(one)).toBe('a|b');
        expect(session.accepted.map(suggestionKey)).toEqual(['a|b', 'c|d']);
        expect(session.rejected).toEqual([]);

        session.setSelected('a|b', false);
        session.replaceAnalysis(analysis([suggestion('a', 'b'), suggestion('e', 'f')]), [
            transaction('a'),
            transaction('b'),
            transaction('e'),
            transaction('f'),
        ]);

        expect(session.suggestions.map(suggestionKey)).toEqual(['a|b', 'e|f']);
        expect(session.accepted.map(suggestionKey)).toEqual(['e|f']);
        expect(session.rejected.map(suggestionKey)).toEqual(['a|b']);

        session.setAllSelected(false);
        expect(session.accepted).toEqual([]);
        session.setAllSelected(true);
        expect(session.accepted.map(suggestionKey)).toEqual(['a|b', 'e|f']);
    });

    it('merges accepted pairs sequentially with ID-only payloads and continues after failures', async () => {
        const events: string[] = [];
        const api: ReviewApi = {
            merge: async request => {
                events.push(`merge:${request.primary.id}`);
                if (request.primary.id === 'a') throw new Error('merge failed');
                return transaction(`merged-${request.primary.id}`);
            },
            learn: async request => {
                events.push(`learn:${request.examples.map(pair => pair[0]?.id).join(',')}`);
                return { book: { id: 'book', name: 'Book' } };
            },
        };
        const session = new ReviewSession();
        session.replaceAnalysis(
            analysis([
                suggestion('a', 'b'),
                suggestion('c', 'd'),
                suggestion('e', 'f'),
                suggestion('g', 'h'),
            ]),
            []
        );
        session.setSelected('e|f', false);
        session.setSelected('g|h', false);

        await session.apply(
            api,
            {
                bookId: 'book',
                query: '',
                accountId: null,
                groupId: null,
                permission: 'OWNER',
            },
            () => undefined
        );

        expect(events).toEqual(['merge:a', 'merge:c', 'learn:e,g']);
        expect(session.progress.map(item => item.status)).toEqual(['failed', 'merged']);
        expect(session.learningResults[0]).toMatchObject({
            status: 'saved',
            savedCount: 2,
            resourceType: 'book',
            resourceName: 'Book',
        });
        expect(session.processed).toBe(true);
        expect(session.cursor).toBeUndefined();
        expect(session.transactions).toEqual([]);
    });

    it('skips learning locally for Post collaborators and keeps the existing notice path', async () => {
        let learnCalled = false;
        const api: ReviewApi = {
            merge: async () => transaction('merged'),
            learn: async () => {
                learnCalled = true;
                return { book: { id: 'book' } };
            },
        };
        const session = new ReviewSession();
        session.replaceAnalysis(analysis([suggestion('a', 'b')]), []);
        session.setAllSelected(false);

        await session.apply(
            api,
            {
                bookId: 'book',
                query: '',
                accountId: null,
                groupId: null,
                permission: 'POSTER',
            },
            () => undefined
        );

        expect(learnCalled).toBe(false);
        expect(session.learningResults[0]).toMatchObject({
            status: 'skipped',
            savedCount: 0,
        });
        expect(session.learningResults[0]?.message).toContain('Post collaborators');
    });
});
