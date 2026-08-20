import { describe, expect, it } from 'bun:test';
import { Permission, type Account, type Bkper, type Book, type Group } from 'bkper-js';
import { AppContext } from '../src/app-context';
import {
    appendLearningExamples,
    collectApplicableLearningExamples,
    formatRejectedPairExample,
    saveRejectedExamples,
} from '../src/services/learning-service';
import type { TransactionFingerprint } from '../src/services/candidate-service';

const first: bkper.Transaction = {
    id: 'private-id-a',
    date: '2026-06-10',
    amount: '12.50',
    description: 'Coffee\nshop',
    posted: true,
    creditAccount: { id: 'account-secret', name: 'Card' },
    debitAccount: { id: 'expense-secret', name: 'Meals' },
    properties: { merchant: 'Corner Cafe', hidden_: 'secret' },
};

const second: bkper.Transaction = {
    ...first,
    id: 'private-id-b',
    date: '2026-06-11',
    description: 'CORNER CAFE',
};

describe('plain-text rejected-pair learning', () => {
    it('formats one concise line from minimized visible transaction context', () => {
        const line = formatRejectedPairExample([first, second]);

        expect(line.split('\n')).toHaveLength(1);
        expect(line).toContain('2026-06-10');
        expect(line).toContain('12.5');
        expect(line).toContain('Card → Meals');
        expect(line).toContain('merchant=Corner Cafe');
        expect(line).not.toContain('hidden_');
        expect(line).not.toContain('private-id');
        expect(line).not.toContain('account-secret');
        expect(line.startsWith('{')).toBe(false);
    });

    it('retains the newest fifty lines while staying within the property budget', () => {
        const existing = Array.from(
            { length: 50 },
            (_, index) => `example ${index + 1} ${'x'.repeat(1_900)}`
        ).join('\n');
        const updated = appendLearningExamples(existing, ['new example']);
        const lines = updated.split('\n');

        expect(lines.length).toBeLessThanOrEqual(50);
        expect(updated.length).toBeLessThanOrEqual(90_000);
        expect(lines[0]).not.toContain('example 1 ');
        expect(lines.at(-1)).toBe('new example');
    });

    it('stores a batch on Account in one visible-property update and returns the full updated Account', async () => {
        let accountValue = '';
        let updates = 0;
        const accountPayload: bkper.Account = { id: 'account', name: 'Client A' };
        const account = {
            getProperty: () => accountValue,
            setVisibleProperty: (_key: string, value: string) => {
                accountValue = value;
                return account;
            },
            update: async () => {
                updates += 1;
                return account;
            },
            json: () => ({
                ...accountPayload,
                properties: { merge_duplicate_examples: accountValue },
            }),
        } as unknown as Account;
        const ownerBook = {
            getPermission: () => Permission.OWNER,
            getAccount: async () => account,
            getGroup: async () => {
                throw new Error('Group fallback must not run');
            },
        } as unknown as Book;

        const saved = await saveRejectedExamples(context(ownerBook), {
            bookId: 'book',
            accountId: 'account',
            examples: [
                [first, second],
                [second, { ...first, id: 'third', description: 'Lunch' }],
            ],
        });

        expect(saved).toEqual({ account: account.json() });
        expect(updates).toBe(1);
        expect(accountValue.split('\n')).toHaveLength(2);
        expect(accountValue).toContain('Coffee shop');
    });

    it('targets the Book when no Account or Group is selected', async () => {
        let value = '';
        const payload: bkper.Book = { id: 'book', name: 'Book' };
        const book = {
            getPermission: () => Permission.EDITOR,
            getProperty: () => value,
            setVisibleProperty: (_key: string, next: string) => {
                value = next;
                return book;
            },
            update: async () => book,
            json: () => ({ ...payload, properties: { merge_duplicate_examples: value } }),
        } as unknown as Book;

        const result = await saveRejectedExamples(context(book), {
            bookId: 'book',
            examples: [[first, second]],
        });

        expect(result).toEqual({ book: book.json() });
    });

    it('rejects Post collaborators instead of silently returning a skipped result', async () => {
        const posterBook = { getPermission: () => Permission.POSTER } as unknown as Book;

        expect(
            saveRejectedExamples(context(posterBook), {
                bookId: 'book',
                examples: [[first, second]],
            })
        ).rejects.toThrow('OWNER or EDITOR');
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
            getAccount: async (id: string) =>
                id === fingerprint.fromAccount?.id ? account : undefined,
        } as unknown as Book;

        expect(await collectApplicableLearningExamples(book, [fingerprint])).toEqual([
            'book example',
            'account example',
            'child example',
            'parent example',
        ]);
    });
});

const fingerprint: TransactionFingerprint = {
    id: 'private-id-a',
    date: '2026-06-10',
    amount: '12.5',
    description: 'Coffee shop',
    fromAccount: { id: 'account-secret', name: 'Card' },
    toAccount: { id: 'expense-secret', name: 'Meals' },
    properties: { merchant: 'Corner Cafe' },
    draft: false,
};

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
