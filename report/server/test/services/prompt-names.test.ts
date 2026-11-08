import { describe, expect, it } from 'vitest';
import { NameIndex } from 'report-shared/name-index';
import { MAX_NAMED, bookNames, findPromptNames } from '../../src/services/prompt-names';
import type {
    NodeType,
    Snapshot,
    SnapshotAccount,
    SnapshotGroup,
} from '../../src/services/snapshot';
import { fixtureSnapshot } from '../fixtures/snapshot-book';

/** What each name found reads: its name, root and target. */
async function found(prompt: string, snapshot?: Snapshot) {
    return findPromptNames(prompt, snapshot ?? (await fixtureSnapshot())).map(
        ({ name, kind, root, target }) => ({ name, kind, root, ...(target ? { target } : {}) })
    );
}

const names = async (prompt: string, snapshot?: Snapshot) =>
    (await found(prompt, snapshot)).map(({ name }) => name);

interface GroupSpec {
    id: string;
    name: string;
    type?: NodeType;
    parent?: string;
    groups?: string[];
    accounts?: string[];
}

/** A map of groups and accounts, in Book order. */
function mapOf(
    groups: GroupSpec[],
    accounts: Record<string, string>,
    ungrouped: Record<string, string> = {}
): Snapshot {
    const node = (type: NodeType) => ({
        type,
        credit: type === 'INCOMING' || type === 'LIABILITY',
        permanent: type === 'ASSET' || type === 'LIABILITY',
    });
    const account = (id: string, name: string): SnapshotAccount => ({
        id,
        name,
        ...node('OUTGOING'),
        type: 'OUTGOING',
        archived: false,
        posted: true,
    });
    return {
        book: { id: 'book', name: 'Book', permission: 'VIEWER' },
        today: '2026-11-05',
        dataAt: '2026-11-05T15:00:00.000Z',
        roots: groups.filter(group => !group.parent).map(group => group.id),
        groups: Object.fromEntries(
            groups.map(({ id, name, type, parent, groups, accounts }): [string, SnapshotGroup] => [
                id,
                {
                    id,
                    name,
                    ...node(type ?? 'OUTGOING'),
                    ...(parent ? { parent } : {}),
                    groups: groups ?? [],
                    accounts: accounts ?? [],
                },
            ])
        ),
        accounts: Object.fromEntries(
            Object.entries(accounts).map(([id, name]) => [id, account(id, name)])
        ),
        ungrouped: Object.fromEntries(
            Object.entries(ungrouped).map(([id, name]) => [id, account(id, name)])
        ),
    };
}

describe('findPromptNames', () => {
    it('finds a root, a nested group, an account and an account in no group, with their roots', async () => {
        expect(await found('Assets today')).toEqual([
            { name: 'Assets', kind: 'group', root: 'g-assets' },
        ]);
        expect(await found('banks today')).toEqual([
            { name: 'Banks', kind: 'group', root: 'g-assets', target: 'g-banks' },
        ]);
        expect(await found('credit card debt')).toEqual([
            { name: 'Credit Card', kind: 'account', root: 'g-card', target: 'a-card' },
        ]);
        expect(await found('owner balance')).toEqual([
            { name: 'Owner', kind: 'account', root: 'a-owner' },
        ]);
    });

    it('ignores case and accents, in both the request and the names', async () => {
        const book = mapOf([{ id: 'g', name: 'Dívidas', accounts: ['a'] }], { a: 'Refeições' });
        expect(await names('DIVIDAS em 2015', book)).toEqual(['Dívidas']);
        expect(await names('refeicoes de 2015', book)).toEqual(['Refeições']);
        // Decomposed accents and full-width letters read the same.
        expect(await names('Refeic\u0327o\u0303es', book)).toEqual(['Refeições']);
        expect(await names('ＤＩＶＩＤＡＳ', book)).toEqual(['Dívidas']);
    });

    it('matches whole names only', async () => {
        expect(await names('foods and rental')).toEqual([]);
        expect(await names('Food2026')).toEqual([]);
        expect(await names("food's share, (rent)")).toEqual(['Food', 'Rent']);
        expect(await names('expenses-food')).toEqual(['Expenses', 'Food']);
    });

    it('finds names in languages written without spaces', async () => {
        expect(await names('2026年のFoodの費用')).toEqual(['Food']);
        const book = mapOf([{ id: 'g', name: '收入', accounts: ['a'] }], { a: '工资' });
        expect(await names('2015年的收入', book)).toEqual(['收入']);
        expect(await names('รายจ่าย Food ปี 2026')).toEqual(['Food']);
    });

    it('finds multiword names with any whitespace between their words', async () => {
        expect(await names('credit   card')).toEqual(['Credit Card']);
        expect(await names('net\u00a0income by month')).toEqual(['Net income']);
    });

    it('prefers the longest name, then the one that starts first', async () => {
        const book = mapOf([{ id: 'g', name: 'Fees', accounts: ['a1', 'a2', 'a3', 'a4'] }], {
            a1: 'HSBC',
            a2: 'HSBC fees',
            a3: 'Fees and taxes',
            a4: 'Taxes',
        });
        expect(await names('HSBC fees in 2015', book)).toEqual(['HSBC fees']);
        expect(await names('HSBC and fees', book)).toEqual(['HSBC', 'Fees']);
        // "Fees and taxes" is longer than "HSBC fees", which it overlaps.
        expect(await names('HSBC fees and taxes', book)).toEqual(['HSBC', 'Fees and taxes']);
        const even = mapOf([{ id: 'g', name: 'Group', accounts: ['a1', 'a2', 'a3'] }], {
            a1: 'red car',
            a2: 'car fee',
            a3: 'Fee',
        });
        // Overlapping names of equal length: the one that starts first.
        expect(await names('red car fee', even)).toEqual(['red car', 'Fee']);
    });

    it('resolves colliding names: written exactly, then a group, then Book order', async () => {
        const book = mapOf(
            [
                { id: 'g1', name: 'Food', accounts: ['a1', 'a2'] },
                { id: 'g2', name: 'Cafe', accounts: [] },
            ],
            { a1: 'Café', a2: 'Food ' },
            { u1: 'CAFÉ' }
        );
        // A group and an account of the same name: the group.
        expect(await found('food', book)).toEqual([{ name: 'Food', kind: 'group', root: 'g1' }]);
        // Written exactly: case and accents decide.
        expect(await found('Café', book)).toEqual([
            { name: 'Café', kind: 'account', root: 'g1', target: 'a1' },
        ]);
        expect(await found('CAFÉ', book)).toEqual([{ name: 'CAFÉ', kind: 'account', root: 'u1' }]);
        // After a run of whitespace or a hashtag, still written exactly.
        expect(await found('food  Café', book)).toEqual([
            { name: 'Food', kind: 'group', root: 'g1' },
            { name: 'Café', kind: 'account', root: 'g1', target: 'a1' },
        ]);
        expect(await found('#tag Café', book)).toEqual([
            { name: 'Café', kind: 'account', root: 'g1', target: 'a1' },
        ]);
        // None written exactly: the group.
        expect(await found('cafe', book)).toEqual([{ name: 'Cafe', kind: 'group', root: 'g2' }]);
        // Two accounts, none written exactly: the first in Book order.
        const accounts = mapOf(
            [{ id: 'g', name: 'G', accounts: ['a1'] }],
            { a1: 'Cafe' },
            {
                u1: 'café',
            }
        );
        expect(await found('CAFE', accounts)).toEqual([
            { name: 'Cafe', kind: 'account', root: 'g', target: 'a1' },
        ]);
    });

    it('leaves out names in hashtags and names of one character', async () => {
        expect(await names('expenses #food')).toEqual(['Expenses']);
        const book = mapOf([{ id: 'g', name: 'E', accounts: ['a'] }], { a: 'Rent' });
        expect(await names('food e rent', book)).toEqual(['Rent']);
    });

    it('keeps each name once, in the order written, up to the most a report shows', async () => {
        expect(await names('rent vs food vs RENT')).toEqual(['Rent', 'Food']);
        const many = mapOf(
            [{ id: 'g', name: 'Group', accounts: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] }],
            { a1: 'One', a2: 'Two', a3: 'Three', a4: 'Four', a5: 'Five', a6: 'Six', a7: 'Seven' }
        );
        const all = await names('seven six five four three two one', many);
        expect(all).toEqual(['Seven', 'Six', 'Five', 'Four', 'Three', 'Two']);
        expect(all).toHaveLength(MAX_NAMED);
    });

    it('reads an account under several roots from a root the request already reads', async () => {
        // Food is under Expenses and Net income, Salary under Revenue and Net income.
        const book = await fixtureSnapshot();
        expect(book.roots.indexOf('g-expenses')).toBeLessThan(book.roots.indexOf('g-net'));
        expect(await found('food')).toEqual([
            { name: 'Food', kind: 'account', root: 'g-expenses', target: 'a-food' },
        ]);
        expect(await found('net income and food')).toEqual([
            { name: 'Net income', kind: 'group', root: 'g-net' },
            { name: 'Food', kind: 'account', root: 'g-net', target: 'a-food' },
        ]);
        expect(await found('food and old supplier')).toEqual([
            { name: 'Food', kind: 'account', root: 'g-expenses', target: 'a-food' },
            { name: 'Old Supplier', kind: 'account', root: 'g-expenses', target: 'a-old' },
        ]);
    });

    it('carries the nature of what it found', async () => {
        const [food, banks] = findPromptNames('food and banks', await fixtureSnapshot());
        expect(food).toMatchObject({ permanent: false });
        expect(banks).toMatchObject({ permanent: true });
        const [owner] = findPromptNames('owner', await fixtureSnapshot());
        expect(owner).toMatchObject({ permanent: true });
    });

    it('finds nothing in a request that names nothing of the Book, or a renamed name', async () => {
        expect(await names('what is the weather tomorrow')).toEqual([]);
        const renamed = await fixtureSnapshot();
        renamed.accounts['a-food'] = { ...renamed.accounts['a-food'], name: 'Groceries' };
        expect(await names('food in October', renamed)).toEqual([]);
        expect(await names('groceries in October', renamed)).toEqual(['Groceries']);
    });
});

describe('bookNames', () => {
    it('lists every group and account once, in Book order, with the first root holding it', async () => {
        expect(bookNames(await fixtureSnapshot())).toEqual([
            { id: 'g-assets', name: 'Assets', kind: 'group', root: 'g-assets' },
            { id: 'g-banks', name: 'Banks', kind: 'group', root: 'g-assets' },
            { id: 'a-bank-a', name: 'Bank A', kind: 'account', root: 'g-assets' },
            { id: 'a-bank-b', name: 'Bank B', kind: 'account', root: 'g-assets' },
            { id: 'a-cash', name: 'Cash', kind: 'account', root: 'g-assets' },
            { id: 'g-card', name: 'Card', kind: 'group', root: 'g-card' },
            { id: 'a-card', name: 'Credit Card', kind: 'account', root: 'g-card' },
            { id: 'g-expenses', name: 'Expenses', kind: 'group', root: 'g-expenses' },
            { id: 'a-food', name: 'Food', kind: 'account', root: 'g-expenses' },
            { id: 'a-old', name: 'Old Supplier', kind: 'account', root: 'g-expenses' },
            { id: 'a-rent', name: 'Rent', kind: 'account', root: 'g-expenses' },
            { id: 'g-revenue', name: 'Revenue', kind: 'group', root: 'g-revenue' },
            { id: 'a-salary', name: 'Salary', kind: 'account', root: 'g-revenue' },
            { id: 'g-net', name: 'Net income', kind: 'group', root: 'g-net' },
            { id: 'a-owner', name: 'Owner', kind: 'account', root: 'a-owner' },
        ]);
    });
});

describe('completing names', () => {
    const multilingual = mapOf(
        [
            { id: 'g1', name: 'Despesas', accounts: ['a1', 'a2', 'a3', 'a4'], groups: ['g2'] },
            { id: 'g2', name: 'Despesas fixas', parent: 'g1', accounts: ['a5', 'a6'] },
            { id: 'g3', name: 'Cafe', accounts: ['a7', 'a8'] },
            { id: 'g4', name: '工资收入', accounts: ['a9'] },
        ],
        {
            a1: 'Refeições',
            a2: 'HSBC',
            a3: 'HSBC tarifas',
            a4: 'Café',
            a5: 'Aluguel',
            a6: 'Conta  corrente',
            a7: 'red car',
            a8: 'car fee',
            a9: 'المصروفات',
        },
        { u1: 'Food', u2: 'E' }
    );

    it('offers only names the Worker then finds in the request, as written', async () => {
        const contexts = ['{}', 'despesas e {}', '{} em 2026', '2015年的{}', 'red {} by month'];
        let checked = 0;
        for (const snapshot of [await fixtureSnapshot(), multilingual]) {
            const index = new NameIndex(bookNames(snapshot));
            for (const { name } of bookNames(snapshot)) {
                const letters = [...name];
                for (let cut = 1; cut <= letters.length; cut++) {
                    const typed = letters.slice(0, cut).join('');
                    for (const context of contexts) {
                        const [before, after] = context.split('{}');
                        const text = before + typed + after;
                        const caret = before.length + typed.length;
                        for (const completion of index.complete(text, caret)) {
                            const request =
                                text.slice(0, completion.from) +
                                completion.text +
                                text.slice(completion.to);
                            const ids = findPromptNames(request, snapshot).map(
                                found => found.target ?? found.root
                            );
                            expect(ids, request).toContain(completion.name.id);
                            checked++;
                        }
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(100);
    });
});
