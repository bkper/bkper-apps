import { describe, expect, it } from 'vitest';
import { LANGUAGES } from 'report-shared/languages';
import {
    CHART_WORDS,
    MAX_REQUEST_CHARACTERS,
    NO_CHART,
    NO_ROOT,
    UNSPECIFIED,
    buildIntentRequest,
} from '../../src/services/intent-questions';
import { buildPeriodOptions } from '../../src/services/periods';
import { NET_RESULT_ROOT } from '../../src/services/report-intent';
import type { Snapshot } from '../../src/services/snapshot';
import { TODAY, fixtureSnapshot } from '../fixtures/snapshot-book';

function withRoots(snapshot: Snapshot, ids: string[]): Snapshot {
    return { ...snapshot, roots: ids };
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
        activeMonths: [],
    };
    for (let r = 0; r < roots; r++) {
        const ids = Array.from({ length: accounts }, (_, a) => `r${r}-a${a}`);
        groups[`r${r}`] = { ...node, id: `r${r}`, name: `Root ${r}`, groups: [], accounts: ids };
        for (const [a, id] of ids.entries()) {
            accountMap[id] = { ...node, id, name: `R${r}-${a}`, archived: false };
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

    it('offers every period option and unspecified', async () => {
        const snapshot = await fixtureSnapshot();
        const { request } = buildIntentRequest('expenses', snapshot);
        const options = buildPeriodOptions({ today: TODAY, dataRange: snapshot.dataRange });
        expect(request.questions.period.criteria).toEqual({
            ...Object.fromEntries(options.map(option => [option.id, option.description])),
            [UNSPECIFIED]: expect.any(String),
        });
    });

    it('keeps the period choice within 255 options', async () => {
        const snapshot: Snapshot = {
            ...(await fixtureSnapshot()),
            dataRange: { firstMonth: '1990-01', lastMonth: '2026-11' },
        };
        const { request } = buildIntentRequest('expenses', snapshot);
        const ids = Object.keys(request.questions.period.criteria);
        expect(ids).toHaveLength(255);
        expect(ids.at(-1)).toBe(UNSPECIFIED);
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
        for (const id of ['over_time', 'composition', 'versus_earlier', 'bridge'] as const) {
            expect(questions[id].type).toBe('noul');
            expect(questions[id].instructions).toMatch(/^Does `request` ask /);
            // No question refers to another or says when not to answer yes.
            expect(questions[id].instructions).not.toMatch(/\bnot\b|unless|except/i);
        }
        expect(Object.keys(questions)).toEqual([
            'root',
            'period',
            'over_time',
            'composition',
            'versus_earlier',
            'bridge',
            'chart_named',
            'language',
        ]);
    });

    it('sends no null values and a bounded request', async () => {
        const prompt = 'x'.repeat(MAX_REQUEST_CHARACTERS + 50);
        const { request } = buildIntentRequest(prompt, await fixtureSnapshot());
        expect(values(request)).not.toContain(null);
        expect(request.state).toMatchObject({ request: 'x'.repeat(MAX_REQUEST_CHARACTERS) });
    });
});
