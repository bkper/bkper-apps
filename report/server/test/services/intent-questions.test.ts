import { describe, expect, it } from 'vitest';
import { LANGUAGES } from 'report-shared/languages';
import {
    CHART_WORDS,
    MAX_REQUEST_CHARACTERS,
    NO_CHART,
    NO_ROOT,
    WHOLE,
    buildIntentRequest,
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

    it('offers each root group by name, the net result and no report', async () => {
        const snapshot = await fixtureSnapshot();
        const { request, roots } = buildIntentRequest('expenses', snapshot);
        expect(roots).toEqual({
            Assets: 'g-assets',
            Card: 'g-card',
            Expenses: 'g-expenses',
            Revenue: 'g-revenue',
            'Net income': 'g-net',
            [NET_RESULT_ROOT]: NET_RESULT_ROOT,
            [NO_ROOT]: NO_ROOT,
        });
        expect(Object.keys(request.questions.root.criteria)).toEqual(Object.keys(roots));
    });

    it('describes each root by its nature and what it contains', async () => {
        const { request } = buildIntentRequest('expenses', await fixtureSnapshot());
        const criteria = request.questions.root.criteria;
        expect(criteria.Assets).toMatch(/^Assets: what is owned/);
        expect(criteria.Assets).toContain('Contains: Banks, Cash, Bank A, Bank B.');
        expect(criteria.Expenses).toMatch(/^Outgoing: money spent/);
        expect(criteria.Expenses).toContain('Rent');
        expect(criteria.Revenue).toMatch(/^Incoming: money received/);
        expect(criteria.Card).toMatch(/^Liabilities: what is owed/);
        expect(criteria['Net income']).toMatch(/^Money received and spent together/);
    });

    it('never offers a root the Book hides', async () => {
        const { roots } = buildIntentRequest('card', hidden(await fixtureSnapshot(), 'g-card'));
        expect(Object.values(roots)).not.toContain('g-card');
        expect(Object.values(roots)).toContain('g-assets');
    });

    it('offers the groups below the roots, then their accounts, each once, and the whole', async () => {
        const { request, targets } = buildIntentRequest('rent', await fixtureSnapshot());
        // Old Supplier is archived; Owner, in no group, is a root of its own.
        expect(Object.keys(targets)).toEqual([
            'Banks',
            'Bank A',
            'Bank B',
            'Cash',
            'Credit Card',
            'Food',
            'Rent',
            'Salary',
        ]);
        expect(targets.Banks).toEqual({ id: 'g-banks', roots: ['g-assets'] });
        // An account under several roots names each, in Book order.
        expect(targets.Rent).toEqual({ id: 'a-rent', roots: ['g-expenses', 'g-net'] });
        const criteria = request.questions.target.criteria;
        expect(Object.keys(criteria)).toEqual([...Object.keys(targets), WHOLE]);
        expect(criteria['Bank A']).toBe('Account in Assets › Banks. Asset: owned.');
        expect(criteria.Cash).toBe('Account in Assets. Asset: owned.');
        expect(criteria.Banks).toBe('Group in Assets. Asset: owned.');
        expect(criteria.Rent).toBe('Account in Expenses. Outgoing: money spent.');
        expect(criteria[WHOLE]).toMatch(/^None of these/);
    });

    it('never offers a target the Book hides, or one under it', async () => {
        const banks = buildIntentRequest('bank', hidden(await fixtureSnapshot(), 'g-banks'));
        expect(Object.keys(banks.targets)).not.toContain('Banks');
        expect(Object.keys(banks.targets)).not.toContain('Bank A');
        expect(Object.keys(banks.targets)).toContain('Cash');

        // Rent is also under Net income, which the Book shows.
        const expenses = buildIntentRequest('rent', hidden(await fixtureSnapshot(), 'g-expenses'));
        expect(expenses.targets.Rent).toEqual({ id: 'a-rent', roots: ['g-net'] });
        expect(Object.keys(expenses.targets)).not.toContain('Old Supplier');
    });

    it('offers no group without an account with transactions posted', async () => {
        const snapshot = await fixtureSnapshot();
        for (const id of ['a-bank-a', 'a-bank-b']) {
            snapshot.accounts[id] = { ...snapshot.accounts[id], posted: false };
        }
        const { targets } = buildIntentRequest('bank', snapshot);
        expect(Object.keys(targets)).not.toContain('Banks');
        expect(Object.keys(targets)).not.toContain('Bank A');
    });

    it('offers at most 254 targets and the whole, groups first, in Book order', async () => {
        const { request, targets } = buildIntentRequest(
            'x',
            wideSnapshot(await fixtureSnapshot(), 2, 200)
        );
        expect(Object.keys(request.questions.target.criteria)).toHaveLength(255);
        expect(Object.keys(request.questions.target.criteria).at(-1)).toBe(WHOLE);
        expect(Object.keys(targets)[0]).toBe('R0-0');
        expect(Object.keys(targets).at(-1)).toBe('R1-53');
    });

    it('keeps the targets of deep Books with long names bounded', async () => {
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
        const criteria = request.questions.target.criteria;
        expect(Object.keys(criteria)).toHaveLength(255);
        expect(criteria[long('G0-5', 0).slice(0, 60)]).toBe(
            `Group in ${long('G0-0', 0).slice(0, 60)} › … › ${long('G0-4', 0).slice(0, 60)}. Outgoing: money spent.`
        );
        expect(JSON.stringify(request.questions.target).length).toBeLessThan(60_000);
    });

    it('offers the net result only to Books with activity roots', async () => {
        const snapshot = withRoots(await fixtureSnapshot(), ['g-assets', 'g-card']);
        const { roots } = buildIntentRequest('balance', snapshot);
        expect(Object.values(roots)).toEqual(['g-assets', 'g-card', NO_ROOT]);
    });

    it('keeps a root named like a special option distinct from it', async () => {
        const snapshot = renamed(await fixtureSnapshot(), 'g-card', 'None');
        const { roots } = buildIntentRequest('card', snapshot);
        expect(roots['None (2)']).toBe('g-card');
        expect(roots[NO_ROOT]).toBe(NO_ROOT);
    });

    it('describes a limited number of names, fewer when the Book has many roots', async () => {
        const base = await fixtureSnapshot();
        const one = buildIntentRequest('x', wideSnapshot(base, 1, 100)).request;
        expect(one.questions.root.criteria['Root 0']).toContain('R0-59.');
        expect(one.questions.root.criteria['Root 0']).not.toContain('R0-60');

        const many = buildIntentRequest('x', wideSnapshot(base, 300, 10)).request;
        const criteria = many.questions.root.criteria;
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
            'root',
            'target',
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
