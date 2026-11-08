import { describe, expect, it } from 'vitest';
import {
    bookProblem,
    canOrganize,
    mixedGroupProblem,
    noNetResultProblem,
} from '../../src/services/book-problems';
import type { FakeLedger } from '../fixtures/ledger';
import { fixtureLedger, ledgerSnapshot, simpleRootsLedger } from '../fixtures/snapshot-book';

/** The map of a ledger whose accounts have, or have not, transactions posted. */
async function snapshotOf(ledger: FakeLedger, permission: bkper.Permission = 'VIEWER') {
    ledger.book.permission = permission;
    return ledgerSnapshot(ledger);
}

function unposted(ledger: FakeLedger, ids: string[]): FakeLedger {
    for (const account of ledger.book.accounts ?? []) {
        if (ids.includes(account.id ?? '')) {
            account.hasTransactionPosted = false;
        }
    }
    return ledger;
}

function ungroup(ledger: FakeLedger, ids: string[]): FakeLedger {
    for (const account of ledger.book.accounts ?? []) {
        if (ids.includes(account.id ?? '')) {
            account.groups = [];
        }
    }
    return ledger;
}

const ALL_ACCOUNTS = [
    'a-cash',
    'a-bank-a',
    'a-bank-b',
    'a-card',
    'a-rent',
    'a-food',
    'a-old',
    'a-salary',
    'a-owner',
];

describe('bookProblem', () => {
    it('finds none in a Book whose accounts with transactions are in groups', async () => {
        // Owner, the one account in no group, is 1 of 9 with transactions.
        expect(bookProblem(await snapshotOf(fixtureLedger()))).toBeUndefined();
    });

    it('finds none in a flat Book: root groups holding their accounts directly', async () => {
        const ledger = fixtureLedger();
        ledger.removeGroup('g-banks');
        ledger.removeGroup('g-net');
        for (const account of ledger.book.accounts ?? []) {
            if (account.id === 'a-bank-a' || account.id === 'a-bank-b') {
                account.groups = [{ id: 'g-assets' }];
            }
        }
        expect(bookProblem(await snapshotOf(ledger))).toBeUndefined();
    });

    it('finds an empty Book without accounts', async () => {
        const ledger = fixtureLedger();
        ledger.book.accounts = [];
        expect(bookProblem(await snapshotOf(ledger))).toEqual({
            code: 'empty_book',
            bookName: 'Test Ledger',
            canOrganize: false,
        });
    });

    it('finds an empty Book whose accounts have no transactions, even without groups', async () => {
        const ledger = ungroup(unposted(fixtureLedger(), ALL_ACCOUNTS), ALL_ACCOUNTS);
        ledger.book.groups = [];
        expect(bookProblem(await snapshotOf(ledger, 'OWNER'))).toEqual({
            code: 'empty_book',
            bookName: 'Test Ledger',
            canOrganize: true,
        });
    });

    it('finds nothing to report on in a Book without groups', async () => {
        const ledger = ungroup(fixtureLedger(), ALL_ACCOUNTS);
        ledger.book.groups = [];
        expect(bookProblem(await snapshotOf(ledger, 'EDITOR'))).toEqual({
            code: 'nothing_to_report',
            bookName: 'Test Ledger',
            canOrganize: true,
            ungrouped: 9,
            total: 9,
        });
    });

    it('finds nothing to report on when more than half the accounts with transactions are in no group', async () => {
        // 5 of 9 in no group; accounts without transactions count for neither.
        const ledger = ungroup(fixtureLedger(), ['a-cash', 'a-bank-a', 'a-bank-b', 'a-card']);
        expect(bookProblem(await snapshotOf(ledger))).toEqual({
            code: 'nothing_to_report',
            bookName: 'Test Ledger',
            canOrganize: false,
            ungrouped: 5,
            total: 9,
        });
        unposted(ledger, ['a-cash', 'a-bank-a']);
        // 3 of 7: most accounts with transactions are in groups.
        expect(bookProblem(await snapshotOf(ledger))).toBeUndefined();
    });

    it('finds none when exactly half the accounts with transactions are in no group', async () => {
        const ledger = unposted(ungroup(fixtureLedger(), ['a-cash', 'a-bank-a', 'a-bank-b']), [
            'a-old',
        ]);
        // 4 of 8 in no group.
        expect(bookProblem(await snapshotOf(ledger))).toBeUndefined();
    });

    it('finds an empty Book before nothing to report on', async () => {
        const ledger = unposted(ungroup(fixtureLedger(), ALL_ACCOUNTS), ALL_ACCOUNTS);
        expect(bookProblem(await snapshotOf(ledger))).toMatchObject({ code: 'empty_book' });
    });
});

describe('canOrganize', () => {
    it('lets only OWNER and EDITOR organize the Book’s groups', () => {
        expect(canOrganize('OWNER')).toBe(true);
        expect(canOrganize('EDITOR')).toBe(true);
        for (const permission of ['POSTER', 'RECORDER', 'VIEWER', 'NONE', '']) {
            expect(canOrganize(permission)).toBe(false);
        }
    });
});

describe('noNetResultProblem', () => {
    it('names the activity roots that hold Incoming and Outgoing accounts', async () => {
        const ledger = simpleRootsLedger();
        ledger.removeGroup('g-revenue');
        expect(noNetResultProblem(await snapshotOf(ledger, 'OWNER'))).toEqual({
            code: 'no_net_result',
            bookName: 'Test Ledger',
            canOrganize: true,
            incoming: [],
            outgoing: ['Expenses'],
            shared: [],
        });
    });

    it('names the activity roots that share accounts, in Book order', async () => {
        const ledger = simpleRootsLedger();
        ledger.addGroup(
            { id: 'g-travel', name: 'Travel', type: 'OUTGOING', credit: false, permanent: false },
            ['a-food']
        );
        expect(noNetResultProblem(await snapshotOf(ledger))).toEqual({
            code: 'no_net_result',
            bookName: 'Test Ledger',
            canOrganize: false,
            incoming: ['Revenue'],
            outgoing: ['Expenses', 'Travel'],
            shared: ['Expenses', 'Travel'],
        });
    });

    it('takes the roots that share accounts when the balances show them', async () => {
        const snapshot = await snapshotOf(simpleRootsLedger());
        expect(noNetResultProblem(snapshot, ['Revenue', 'Expenses'])).toMatchObject({
            shared: ['Revenue', 'Expenses'],
        });
    });
});

describe('mixedGroupProblem', () => {
    it('finds a group whose accounts with transactions hold balances and activity', async () => {
        const ledger = fixtureLedger();
        ledger.addGroup(
            { id: 'g-all', name: 'Everything', mixed: true, credit: false, permanent: false },
            ['a-cash', 'a-salary']
        );
        expect(mixedGroupProblem(await snapshotOf(ledger, 'EDITOR'), 'g-all')).toEqual({
            code: 'mixed_group',
            bookName: 'Test Ledger',
            canOrganize: true,
            group: 'Everything',
        });
    });

    it('finds the accounts at any depth', async () => {
        const ledger = fixtureLedger();
        ledger.addAccount({ id: 'a-fees', name: 'Fees', type: 'INCOMING', groups: ['g-banks'] });
        const snapshot = await snapshotOf(ledger);
        expect(mixedGroupProblem(snapshot, 'g-assets')).toMatchObject({ group: 'Assets' });
        expect(mixedGroupProblem(snapshot, 'g-banks')).toMatchObject({ group: 'Banks' });
    });

    it('finds none for Asset with Liability, or Incoming with Outgoing', async () => {
        const ledger = fixtureLedger();
        ledger.addGroup(
            { id: 'g-worth', name: 'Worth', mixed: true, credit: false, permanent: true },
            ['a-cash', 'a-card']
        );
        const snapshot = await snapshotOf(ledger);
        expect(mixedGroupProblem(snapshot, 'g-worth')).toBeUndefined();
        expect(mixedGroupProblem(snapshot, 'g-net')).toBeUndefined();
        expect(mixedGroupProblem(snapshot, 'g-assets')).toBeUndefined();
    });

    it('finds none when the accounts of the other kind have no transactions', async () => {
        const ledger = fixtureLedger();
        ledger.addGroup(
            { id: 'g-all', name: 'Everything', mixed: true, credit: false, permanent: false },
            ['a-cash', 'a-salary']
        );
        unposted(ledger, ['a-salary']);
        expect(mixedGroupProblem(await snapshotOf(ledger), 'g-all')).toBeUndefined();
    });
});
