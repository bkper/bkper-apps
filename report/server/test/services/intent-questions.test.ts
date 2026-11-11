import { describe, expect, it } from 'vitest';
import { LANGUAGES } from 'report-shared/languages';
import {
    CHART_WORDS,
    MAX_REQUEST_CHARACTERS,
    NO_CHART,
    NO_ROOT,
    buildIntentRequest,
    natureDescription,
} from '../../src/services/intent-questions';
import { PERIOD_QUESTION_IDS, buildPeriodQuestions } from '../../src/services/period-questions';
import { NET_RESULT_ROOT } from '../../src/services/report-intent';
import type { Snapshot } from '../../src/services/snapshot';
import { TODAY, fixtureSnapshot } from '../fixtures/snapshot-book';

function withRoots(snapshot: Snapshot, ids: string[]): Snapshot {
    return { ...snapshot, roots: ids };
}

function hidden(snapshot: Snapshot, id: string): Snapshot {
    return {
        ...snapshot,
        groups: { ...snapshot.groups, [id]: { ...snapshot.groups[id], hidden: true } },
    };
}

function renamed(snapshot: Snapshot, id: string, name: string): Snapshot {
    return { ...snapshot, groups: { ...snapshot.groups, [id]: { ...snapshot.groups[id], name } } };
}

/** The fixture with Banks split: Checking holds Bank A, Savings holds Bank B. */
function deepSnapshot(snapshot: Snapshot): Snapshot {
    const banks = snapshot.groups['g-banks'];
    const child = (id: string, name: string, account: string) => ({
        ...banks,
        id,
        name,
        parent: 'g-banks',
        groups: [],
        accounts: [account],
    });
    return {
        ...snapshot,
        groups: {
            ...snapshot.groups,
            'g-banks': { ...banks, groups: ['g-checking', 'g-savings'] },
            'g-checking': child('g-checking', 'Checking', 'a-bank-a'),
            'g-savings': child('g-savings', 'Savings', 'a-bank-b'),
        },
    };
}

/** The names a description lists after `Contains:`. */
function contents(description: string): string[] {
    const match = /Contains: (.*)\.$/.exec(description);
    return match ? match[1].split(', ') : [];
}

/** How each nature reads, as the request describes groups. */
const NATURE = {
    ASSET: natureDescription({ type: 'ASSET', permanent: true }),
    LIABILITY: natureDescription({ type: 'LIABILITY', permanent: true }),
    INCOMING: natureDescription({ type: 'INCOMING', permanent: false }),
    OUTGOING: natureDescription({ type: 'OUTGOING', permanent: false }),
    MIXED_ACTIVITY: natureDescription({ type: 'MIXED', permanent: false }),
};

/** A Book of `roots` Outgoing roots, each with `accounts` accounts named `<root>-<n>`. */
function wideSnapshot(base: Snapshot, roots: number, accounts: number): Snapshot {
    const groups: Snapshot['groups'] = {};
    const accountMap: Snapshot['accounts'] = {};
    const node = {
        type: 'OUTGOING' as const,
        credit: false,
        permanent: false,
    };
    for (let r = 0; r < roots; r++) {
        const ids = Array.from({ length: accounts }, (_, a) => `r${r}-a${a}`);
        groups[`r${r}`] = { ...node, id: `r${r}`, name: `Root ${r}`, groups: [], accounts: ids };
        for (const [a, id] of ids.entries()) {
            accountMap[id] = { ...node, id, name: `R${r}-${a}`, archived: false, posted: true };
        }
    }
    return { ...base, roots: Object.keys(groups), groups, accounts: accountMap };
}

/** Every value of a JSON tree, so tests can look for `null`. */
function values(value: unknown): unknown[] {
    if (value !== null && typeof value === 'object') {
        return [value, ...Object.values(value).flatMap(values)];
    }
    return [value];
}

describe('buildIntentRequest', () => {
    it('states the request and today', async () => {
        const { request } = buildIntentRequest('expenses in 2025', await fixtureSnapshot());
        expect(request.state).toEqual({ request: 'expenses in 2025', today: TODAY });
    });

    it('offers each root group, each followed by the groups below it, the net result and no report', async () => {
        const snapshot = await fixtureSnapshot();
        const { request, groups } = buildIntentRequest('expenses', snapshot);
        expect(groups).toEqual({
            Assets: { id: 'g-assets', root: 'g-assets' },
            Banks: { id: 'g-banks', root: 'g-assets', parent: 'Assets' },
            Card: { id: 'g-card', root: 'g-card' },
            Expenses: { id: 'g-expenses', root: 'g-expenses' },
            Revenue: { id: 'g-revenue', root: 'g-revenue' },
            'Net income': { id: 'g-net', root: 'g-net' },
            [NET_RESULT_ROOT]: { id: NET_RESULT_ROOT, root: NET_RESULT_ROOT },
        });
        expect(Object.keys(request.questions.group.criteria)).toEqual([
            ...Object.keys(groups),
            NO_ROOT,
        ]);
    });

    it('never offers an account: one meant but not written is a row of its group', async () => {
        const snapshot = await fixtureSnapshot();
        const { request } = buildIntentRequest('rent', snapshot);
        const labels = Object.keys(request.questions.group.criteria);
        for (const account of Object.values(snapshot.accounts)) {
            expect(labels).not.toContain(account.name);
        }
    });

    it('describes each group by its nature and the accounts only it holds', async () => {
        const { request } = buildIntentRequest('expenses', await fixtureSnapshot());
        const criteria = request.questions.group.criteria;
        expect(criteria.Assets).toBe(`${NATURE.ASSET} Contains: Cash.`);
        expect(criteria.Banks).toBe(`${NATURE.ASSET} Contains: Bank A, Bank B.`);
        expect(criteria.Card).toBe(`${NATURE.LIABILITY} Contains: Credit Card.`);
        // Rent and Food are in Expenses and Net income: named in the smaller, Expenses. Old
        // Supplier is archived.
        expect(criteria.Expenses).toBe(`${NATURE.OUTGOING} Contains: Food, Rent.`);
        expect(criteria.Revenue).toBe(`${NATURE.INCOMING} Contains: Salary.`);
        expect(criteria['Net income']).toBe(NATURE.MIXED_ACTIVITY);
    });

    it('writes each name of the Book once in the whole request', async () => {
        const base = await fixtureSnapshot();
        for (const snapshot of [base, deepSnapshot(base), wideSnapshot(base, 3, 20)]) {
            const { request } = buildIntentRequest('x', snapshot);
            const written = Object.entries(request.questions.group.criteria).flatMap(
                ([label, description]) => [label, ...contents(description)]
            );
            const folded = written.map(name => name.toLowerCase());
            expect(new Set(folded).size).toBe(folded.length);
            // Nothing else asked names the Book's groups or accounts.
            const { group: _, ...others } = request.questions;
            const rest = JSON.stringify(others);
            for (const name of [
                ...Object.values(snapshot.groups).map(group => group.name),
                ...Object.values(snapshot.accounts).map(account => account.name),
            ]) {
                expect(rest).not.toContain(name);
            }
        }
    });

    it('offers groups at any depth, each with its root and the group it is in', async () => {
        const { groups } = buildIntentRequest('x', deepSnapshot(await fixtureSnapshot()));
        expect(groups.Checking).toEqual({ id: 'g-checking', root: 'g-assets', parent: 'Banks' });
        expect(Object.keys(groups).slice(0, 4)).toEqual(['Assets', 'Banks', 'Checking', 'Savings']);
    });

    it('never offers a group the Book hides, or one under it', async () => {
        const assets = buildIntentRequest('bank', hidden(await fixtureSnapshot(), 'g-assets'));
        expect(Object.keys(assets.groups)).not.toContain('Assets');
        expect(Object.keys(assets.groups)).not.toContain('Banks');
        expect(JSON.stringify(assets.request.questions.group)).not.toContain('Bank A');

        const banks = buildIntentRequest('bank', hidden(await fixtureSnapshot(), 'g-banks'));
        expect(Object.keys(banks.groups)).not.toContain('Banks');
        expect(Object.keys(banks.groups)).toContain('Assets');
    });

    it('offers no group below a root without an account with transactions posted', async () => {
        const snapshot = await fixtureSnapshot();
        for (const id of ['a-bank-a', 'a-bank-b']) {
            snapshot.accounts[id] = { ...snapshot.accounts[id], posted: false };
        }
        const { request, groups } = buildIntentRequest('bank', snapshot);
        expect(Object.keys(groups)).not.toContain('Banks');
        expect(JSON.stringify(request.questions.group)).not.toContain('Bank A');
    });

    it('offers at most 255 options, leaving out the deepest groups first', async () => {
        const base = await fixtureSnapshot();
        // Two roots, each with 150 groups, each holding a group with one account.
        const groups: Snapshot['groups'] = {};
        const accounts: Snapshot['accounts'] = {};
        const node = { type: 'OUTGOING' as const, credit: false, permanent: false };
        for (let r = 0; r < 2; r++) {
            const children = Array.from({ length: 150 }, (_, c) => `r${r}-c${c}`);
            groups[`r${r}`] = {
                ...node,
                id: `r${r}`,
                name: `Root ${r}`,
                groups: children,
                accounts: [],
            };
            for (const id of children) {
                groups[id] = {
                    ...node,
                    id,
                    name: `Child ${id}`,
                    parent: `r${r}`,
                    groups: [`${id}-d`],
                    accounts: [],
                };
                groups[`${id}-d`] = {
                    ...node,
                    id: `${id}-d`,
                    name: `Deep ${id}`,
                    parent: id,
                    groups: [],
                    accounts: [`${id}-a`],
                };
                accounts[`${id}-a`] = {
                    ...node,
                    id: `${id}-a`,
                    name: `Account ${id}`,
                    archived: false,
                    posted: true,
                };
            }
        }
        const { request, groups: offered } = buildIntentRequest('x', {
            ...base,
            roots: ['r0', 'r1'],
            groups,
            accounts,
        });
        const labels = Object.keys(request.questions.group.criteria);
        expect(labels).toHaveLength(255);
        expect(labels.slice(-2)).toEqual([NET_RESULT_ROOT, NO_ROOT]);
        expect(labels.slice(0, 2)).toEqual(['Root 0', 'Child r0-c0']);
        expect(labels).toContain('Root 1');
        expect(labels.filter(label => label.startsWith('Deep'))).toEqual([]);
        // Every group's parent is offered.
        for (const option of Object.values(offered)) {
            expect(option.parent === undefined || Object.hasOwn(offered, option.parent)).toBe(true);
        }
    });

    it('keeps the request of deep Books with long names bounded', async () => {
        const base = await fixtureSnapshot();
        const long = (prefix: string, n: number) => `${prefix}${n}`.padEnd(80, 'x');
        const groups: Snapshot['groups'] = {};
        const accounts: Snapshot['accounts'] = {};
        const node = { type: 'OUTGOING' as const, credit: false, permanent: false };
        // 300 roots, each a chain of 6 groups, the last holding one account.
        for (let r = 0; r < 300; r++) {
            for (let d = 0; d < 6; d++) {
                const id = `r${r}-${d}`;
                groups[id] = {
                    ...node,
                    id,
                    name: long(`G${r}-${d}`, 0),
                    ...(d > 0 ? { parent: `r${r}-${d - 1}` } : {}),
                    groups: d < 5 ? [`r${r}-${d + 1}`] : [],
                    accounts: d === 5 ? [`a${r}`] : [],
                };
            }
            accounts[`a${r}`] = {
                ...node,
                id: `a${r}`,
                name: long('A', r),
                archived: false,
                posted: true,
            };
        }
        const roots = Array.from({ length: 300 }, (_, r) => `r${r}-0`);
        const { request } = buildIntentRequest('x', { ...base, roots, groups, accounts });
        const criteria = request.questions.group.criteria;
        expect(Object.keys(criteria)).toHaveLength(255);
        expect(JSON.stringify(request.questions.group).length).toBeLessThan(60_000);
    });

    it('offers the net result only to Books with activity roots', async () => {
        const snapshot = withRoots(await fixtureSnapshot(), ['g-assets', 'g-card']);
        const { groups } = buildIntentRequest('balance', snapshot);
        expect(Object.values(groups).map(group => group.id)).toEqual([
            'g-assets',
            'g-banks',
            'g-card',
        ]);
    });

    it('keeps a group named like a special option distinct from it', async () => {
        const snapshot = renamed(await fixtureSnapshot(), 'g-card', 'None');
        const { groups } = buildIntentRequest('card', snapshot);
        expect(groups['None (2)']).toEqual({ id: 'g-card', root: 'g-card' });
        expect(groups).not.toHaveProperty(NO_ROOT);
    });

    it('describes a limited number of names, fewer when the Book has many groups', async () => {
        const base = await fixtureSnapshot();
        const one = buildIntentRequest('x', wideSnapshot(base, 1, 100)).request;
        expect(one.questions.group.criteria['Root 0']).toContain('R0-59.');
        expect(one.questions.group.criteria['Root 0']).not.toContain('R0-60');

        const many = buildIntentRequest('x', wideSnapshot(base, 300, 10)).request;
        const criteria = many.questions.group.criteria;
        expect(Object.keys(criteria)).toHaveLength(255);
        expect(criteria['Root 0']).toContain('R0-4.');
        expect(criteria['Root 0']).not.toContain('R0-5');
    });

    it('asks the period as the period questions, which hold no date', async () => {
        const snapshot = await fixtureSnapshot();
        const { request } = buildIntentRequest('expenses 2016 vs 2014', snapshot);
        expect(request.questions).toMatchObject(buildPeriodQuestions('expenses 2016 vs 2014'));
        // The same questions whatever the Book holds or its today.
        const other = buildIntentRequest('expenses 2016 vs 2014', {
            ...snapshot,
            today: '2031-02-03',
            roots: [],
            groups: {},
            accounts: {},
        }).request;
        for (const id of PERIOD_QUESTION_IDS) {
            expect(other.questions[id]).toEqual(request.questions[id]);
        }
    });

    it('offers every Bkper language', async () => {
        const { request } = buildIntentRequest('expenses', await fixtureSnapshot());
        const languages = request.questions.language.criteria;
        expect(Object.keys(languages)).toEqual(LANGUAGES.map(language => language.code));
        expect(languages.pt).toBe('Portuguese (Português)');
        expect(languages.en).toBe('English');
    });

    it('offers every chart word, and none', async () => {
        const { request } = buildIntentRequest('expenses', await fixtureSnapshot());
        expect(Object.keys(request.questions.chart_named.criteria)).toEqual([
            ...CHART_WORDS,
            NO_CHART,
        ]);
    });

    it('asks each judgment as a yes or no question that stands alone', async () => {
        const { questions } = buildIntentRequest('expenses', await fixtureSnapshot()).request;
        for (const id of [
            'over_time',
            'composition',
            'versus_earlier',
            'year_earlier',
            'bridge',
        ] as const) {
            expect(questions[id].type).toBe('noul');
            expect(questions[id].instructions).toMatch(/^Does `request` ask /);
            // No question refers to another or says when not to answer yes.
            expect(questions[id].instructions).not.toMatch(/\bnot\b|unless|except/i);
        }
        expect(Object.keys(questions)).toEqual([
            'group',
            'over_time',
            'composition',
            'versus_earlier',
            'year_earlier',
            'bridge',
            'chart_named',
            'language',
            ...PERIOD_QUESTION_IDS,
        ]);
    });

    it('sends no null values and a bounded request', async () => {
        const prompt = 'x'.repeat(MAX_REQUEST_CHARACTERS + 50);
        const { request } = buildIntentRequest(prompt, await fixtureSnapshot());
        expect(values(request)).not.toContain(null);
        expect(request.state).toMatchObject({ request: 'x'.repeat(MAX_REQUEST_CHARACTERS) });
    });
});
