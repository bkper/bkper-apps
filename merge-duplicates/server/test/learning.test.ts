import { describe, expect, it } from 'bun:test';
import { Permission, type Account, type Bkper, type Book, type Group } from 'bkper-js';
import { AppContext } from '../src/app-context';
import {
    appendLearningExample,
    collectApplicableLearningExamples,
    formatRejectedPairExample,
    saveRejectedPair,
} from '../src/services/learning-service';
import type { TransactionFingerprint } from '../src/services/candidate-service';

const first: TransactionFingerprint = {
    id: 'private-id-a',
    date: '2026-06-10',
    amount: '12.50',
    description: 'Coffee\nshop',
    fromAccount: { id: 'account-secret', name: 'Card' },
    toAccount: { id: 'expense-secret', name: 'Meals' },
    properties: { merchant: 'Corner Cafe' },
    draft: false,
};

const second: TransactionFingerprint = {
    ...first,
    id: 'private-id-b',
    date: '2026-06-11',
    description: 'CORNER CAFE',
};

describe('plain-text rejected-pair learning', () => {
    it('formats one concise line using only the allowed AI snapshot context', () => {
        const line = formatRejectedPairExample({ first, second });

        expect(line.split('\n')).toHaveLength(1);
        expect(line).toContain('2026-06-10');
        expect(line).toContain('12.50');
        expect(line).toContain('Card → Meals');
        expect(line).toContain('merchant=Corner Cafe');
        expect(line).not.toContain('private-id');
        expect(line).not.toContain('account-secret');
        expect(line.startsWith('{')).toBe(false);
        expect(line).not.toContain('rejected:');
    });

    it('appends without deduplication and retains only the latest forty lines', () => {
        const existing = Array.from({ length: 40 }, (_, index) => `example ${index + 1}`).join(
            '\n'
        );
        const updated = appendLearningExample(existing, 'example 40');
        const lines = updated.split('\n');

        expect(lines).toHaveLength(40);
        expect(lines[0]).toBe('example 2');
        expect(lines.at(-1)).toBe('example 40');
        expect(lines.filter(line => line === 'example 40')).toHaveLength(2);
    });

    it('stores on Account before Group or Book and skips property writes for posters', async () => {
        let accountValue = '';
        const account = {
            getProperty: () => accountValue,
            setVisibleProperty: (_key: string, value: string) => {
                accountValue = value;
                return account;
            },
            update: async () => account,
        } as unknown as Account;
        const ownerBook = {
            getPermission: () => Permission.OWNER,
            getAccount: async () => account,
            getGroup: async () => {
                throw new Error('Group fallback must not run');
            },
        } as unknown as Book;
        const ownerContext = context(ownerBook);

        const saved = await saveRejectedPair(ownerContext, {
            bookId: 'book',
            accountId: 'account',
            groupId: 'group',
            pair: { first, second },
        });

        expect(saved.resourceType).toBe('account');
        expect(accountValue).toContain('Coffee shop');

        const posterBook = { getPermission: () => Permission.POSTER } as unknown as Book;
        const skipped = await saveRejectedPair(context(posterBook), {
            bookId: 'book',
            pair: { first, second },
        });
        expect(skipped.skipped).toBe(true);
        expect(skipped.notice).toContain('Post collaborators');
    });

    it('loads Book, Account, selected groups, and every ancestor example for AI', async () => {
        const parent = learningGroup('parent example');
        const child = learningGroup('child example', parent);
        const account = {
            getProperty: () => 'account example',
            getGroups: async () => [child],
        } as unknown as Account;
        const book = {
            getProperty: () => 'book example',
            getAccount: async (id: string) => (id === first.fromAccount?.id ? account : undefined),
        } as unknown as Book;

        expect(await collectApplicableLearningExamples(book, [first])).toEqual([
            'book example',
            'account example',
            'child example',
            'parent example',
        ]);
    });
});

function context(book: Book): AppContext {
    const bkper = { getBook: async () => book } as unknown as Bkper;
    return new AppContext(bkper, { ASSETS: { fetch } });
}

function learningGroup(example: string, parent?: Group): Group {
    return {
        getProperty: () => example,
        getParent: () => parent,
    } as unknown as Group;
}
