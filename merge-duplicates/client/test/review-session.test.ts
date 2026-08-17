import { describe, expect, it } from 'bun:test';
import { ReviewSession, type ReviewApi } from '../src/app/review-session';
import type { ScanResponse, Suggestion } from '../src/api/app-api';

function suggestion(id: string, firstId: string, secondId: string): Suggestion {
    const snapshot = (transactionId: string) => ({
        id: transactionId,
        date: '2026-06-10',
        amount: '10',
        description: transactionId,
        fromAccount: { id: 'bank', name: 'Bank' },
        toAccount: { id: transactionId, name: transactionId },
        properties: {},
        draft: false,
    });
    return {
        id,
        strength: 'Strong',
        explanation: 'Likely duplicate',
        first: snapshot(firstId),
        second: snapshot(secondId),
    };
}

function page(suggestions: Suggestion[], cursor?: string): ScanResponse {
    return {
        permission: 'OWNER',
        suggestions,
        fingerprints: suggestions.flatMap(item => [item.first, item.second]),
        cursor,
        scanned: 200,
        candidateCount: suggestions.length,
        skipped: { total: 0, checked: 0, trashed: 0, locked: 0 },
        promptVersion: 'merge-duplicates-v1',
    };
}

describe('browser-memory review session', () => {
    it('appends pages while preserving decisions and global non-overlap', () => {
        const session = new ReviewSession();
        session.appendPage(page([suggestion('one', 'a', 'b')], 'next'));
        session.reject('one');
        session.appendPage(page([suggestion('overlap', 'b', 'c'), suggestion('two', 'd', 'e')]));

        expect(session.accepted.map(item => item.id)).toEqual(['two']);
        expect(session.rejected.map(item => item.id)).toEqual(['one']);
        session.undo('one');
        expect(session.accepted.map(item => item.id)).toEqual(['two', 'one']);
    });

    it('merges accepted pairs sequentially, continues after failures, and learns rejections independently', async () => {
        const events: string[] = [];
        const api: ReviewApi = {
            merge: async request => {
                events.push(`merge:${request.firstTransactionId}`);
                if (request.firstTransactionId === 'a') throw new Error('merge failed');
                return { mergedTransactionId: `merged-${request.firstTransactionId}` };
            },
            learn: async request => {
                events.push(`learn:${request.pair.first.id}`);
                throw new Error('learning failed');
            },
        };
        const session = new ReviewSession();
        session.appendPage(
            page(
                [
                    suggestion('one', 'a', 'b'),
                    suggestion('two', 'c', 'd'),
                    suggestion('three', 'e', 'f'),
                ],
                'next'
            )
        );
        session.reject('three');

        await session.apply(
            api,
            { bookId: 'book', query: '', accountId: null, groupId: null },
            () => undefined
        );

        expect(events).toEqual(['merge:a', 'merge:c', 'learn:e']);
        expect(session.progress.map(item => item.status)).toEqual(['failed', 'merged']);
        expect(session.learningResults[0].status).toBe('failed');
        expect(session.processed).toBe(true);
        expect(session.cursor).toBeUndefined();
        expect(session.fingerprints).toEqual([]);
    });
});
