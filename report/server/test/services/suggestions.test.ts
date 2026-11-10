import { addLocale } from 'report-shared/strings';
import { describe, expect, it } from 'vitest';
import { buildReport, planQueries, planReport } from '../../src/services/report';
import type { Snapshot } from '../../src/services/snapshot';
import type { DecisionClient } from '../../src/services/decision-client';
import { NET_RESULT_ROOT } from '../../src/services/report-intent';
import {
    buildSuggestions,
    readSuggestions,
    suggestionCandidates,
    type SuggestionStore,
} from '../../src/services/suggestions';
import { ServerTiming } from '../../src/services/timing';
import { createTestEnv } from '../test-env';
import {
    fixtureLedger,
    fixtureSnapshot,
    ledgerBalances,
    ledgerSnapshot,
    simpleRootsLedger,
} from '../fixtures/snapshot-book';

/** The fixture read years later: its last movements, in November 2026, are then old. */
async function laterSnapshot(): Promise<Snapshot> {
    return { ...(await fixtureSnapshot()), today: '2028-03-10' };
}

/** What Jev answers: the probability of each option, by its label (the group's name). */
type Probabilities = Record<string, number>;

/**
 * A decision client that answers the suggestion question with these probabilities, noting each
 * request; it fails when there are none.
 */
function fakeJev(probabilities?: Probabilities) {
    const requests: { state: unknown; questions: Record<string, unknown> }[] = [];
    const client = {
        systemOne: async (request: { state: unknown; questions: Record<string, unknown> }) => {
            requests.push(request);
            if (!probabilities) {
                throw new Error('Bkper AI is unavailable');
            }
            const [choice] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
            return {
                model: 'jev',
                answers: {
                    first: {
                        type: 'choice',
                        choice,
                        confidence: probabilities[choice],
                        probabilities,
                    },
                },
                usage: { input_tokens: 0, output_tokens: 0 },
            };
        },
    } as unknown as DecisionClient;
    return { client, requests };
}

/** The fixture's labels, most important first: its net income, its assets and its expenses. */
const NET_ASSETS_EXPENSES: Probabilities = {
    'Net income': 0.5,
    Assets: 0.2,
    Expenses: 0.15,
    Banks: 0.07,
    Revenue: 0.05,
    Card: 0.03,
};

/** Reads the suggestions of a snapshot from the fixture's ledger, noting every query. */
async function readFrom(
    snapshot: Snapshot,
    lang = 'en',
    jev = fakeJev(NET_ASSETS_EXPENSES),
    cache?: SuggestionStore
) {
    const ledger = fixtureLedger();
    ledger.today = snapshot.today;
    const queries: string[] = [];
    const suggestions = await readSuggestions(snapshot, lang, {
        loadBalances: async asked => {
            queries.push(...asked);
            return asked.map(query => ledgerBalances(ledger, query));
        },
        timing: new ServerTiming(),
        decisions: jev.client,
        ...(cache ? { cache } : {}),
    });
    return { suggestions, queries };
}

const texts = (suggestions: { text: string }[]) => suggestions.map(suggestion => suggestion.text);

describe('suggestionCandidates', () => {
    it('offers the groups of the first two levels, each as its natural report', async () => {
        const candidates = suggestionCandidates(await fixtureSnapshot());
        const thisYear = { span: 'year', year: 'current' };
        const now = { span: 'now' };
        // Book order: roots as the Book lists them, each followed by the groups under it.
        expect(candidates.map(({ id, intent }) => ({ id, intent }))).toEqual([
            { id: 'g-assets', intent: { root: 'g-assets', period: now, monthly: false } },
            {
                id: 'g-banks',
                intent: { root: 'g-assets', target: 'g-banks', period: now, monthly: false },
            },
            { id: 'g-card', intent: { root: 'g-card', period: now, monthly: false } },
            { id: 'g-expenses', intent: { root: 'g-expenses', period: thisYear, monthly: true } },
            { id: 'g-revenue', intent: { root: 'g-revenue', period: thisYear, monthly: true } },
            // Income and expenses together, the Book's own profit and loss: its total this year.
            { id: 'g-net', intent: { root: 'g-net', period: thisYear, monthly: false } },
        ]);
    });

    it('leaves out hidden groups, deeper ones, groups with nothing posted and mixed natures', async () => {
        const ledger = fixtureLedger();
        const groups = ledger.book.groups ?? [];
        // Assets is hidden, and so is Banks with it.
        groups.forEach(group => (group.hidden = group.id === 'g-assets'));
        // A third level is never offered.
        const level = (id: string, parent: string) => ({
            ...groups[4],
            id,
            name: id,
            parent: { id: parent },
        });
        groups.push(level('g-mid', 'g-revenue'), level('g-deep', 'g-mid'));
        const salary = ledger.book.accounts?.find(account => account.id === 'a-salary');
        salary?.groups?.push({ id: 'g-deep' });
        // Card's only account has nothing posted.
        const card = ledger.book.accounts?.find(account => account.id === 'a-card');
        if (card) card.hasTransactionPosted = false;
        // Expenses holds a balance with its activity: a report of it would be refused.
        const cash = ledger.book.accounts?.find(account => account.id === 'a-cash');
        cash?.groups?.push({ id: 'g-expenses' });

        const candidates = suggestionCandidates(await ledgerSnapshot(ledger));
        expect(candidates.map(candidate => candidate.id)).toEqual(['g-revenue', 'g-mid', 'g-net']);
    });

    it('offers the net result only where Report nets separate roots', async () => {
        const ids = async (snapshot: Promise<Snapshot>) =>
            suggestionCandidates(await snapshot).map(candidate => candidate.id);
        // The Book's own group that combines them stands for it.
        expect(await ids(fixtureSnapshot())).not.toContain(NET_RESULT_ROOT);
        expect(await ids(ledgerSnapshot(simpleRootsLedger()))).toContain(NET_RESULT_ROOT);
    });

    it('offers at most 20, the largest, still in Book order', async () => {
        const ledger = fixtureLedger();
        const many = Array.from({ length: 24 }, (_, n) => `g-extra-${n}`);
        for (const id of many) {
            ledger.book.groups?.push({ ...ledger.book.groups[3], id, name: id });
        }
        // The fixture's Expenses, Revenue and Net income hold more accounts than any of these.
        ledger.book.accounts
            ?.find(account => account.id === 'a-rent')
            ?.groups?.push(...many.map(id => ({ id })));
        const candidates = suggestionCandidates(await ledgerSnapshot(ledger));
        expect(candidates).toHaveLength(20);
        expect(candidates.slice(0, 6).map(candidate => candidate.id)).toEqual([
            'g-assets',
            'g-banks',
            'g-card',
            'g-expenses',
            'g-revenue',
            'g-net',
        ]);
    });
});

describe('buildSuggestions', () => {
    it('suggests the three most important reports, the most important first', async () => {
        const snapshot = await fixtureSnapshot();
        expect(
            buildSuggestions(snapshot, 'en', ['g-net', 'g-assets', 'g-expenses', 'g-card'])
        ).toEqual([
            {
                text: 'Net income this year',
                intent: {
                    root: 'g-net',
                    period: { span: 'year', year: 'current' },
                    monthly: false,
                },
            },
            {
                text: 'Assets today',
                intent: { root: 'g-assets', period: { span: 'now' }, monthly: false },
            },
            {
                text: 'Expenses by month this year',
                intent: {
                    root: 'g-expenses',
                    period: { span: 'year', year: 'current' },
                    monthly: true,
                },
            },
        ]);
    });

    it('skips a group under or over one already suggested', async () => {
        const snapshot = await fixtureSnapshot();
        expect(
            texts(buildSuggestions(snapshot, 'en', ['g-assets', 'g-banks', 'g-card', 'g-net']))
        ).toEqual(['Assets today', 'Card today', 'Net income this year']);
        expect(texts(buildSuggestions(snapshot, 'en', ['g-banks', 'g-assets', 'g-net']))).toEqual([
            'Banks today',
            'Net income this year',
            'Card today',
        ]);
    });

    it('skips a group of the same nature that shares accounts with one already suggested', async () => {
        const ledger = fixtureLedger();
        // Cash at hand: assets like Assets, sharing its Cash.
        ledger.book.groups?.push({
            ...(ledger.book.groups?.[0] ?? {}),
            id: 'g-cash',
            name: 'Cash at hand',
        });
        ledger.book.accounts
            ?.find(account => account.id === 'a-cash')
            ?.groups?.push({ id: 'g-cash' });
        const snapshot = await ledgerSnapshot(ledger);
        expect(
            texts(buildSuggestions(snapshot, 'en', ['g-assets', 'g-cash', 'g-net', 'g-expenses']))
        ).toEqual([
            'Assets today',
            'Net income this year',
            // Net income holds Expenses' accounts too, but income and expenses together are
            // another report.
            'Expenses by month this year',
        ]);
    });

    it('suggests in Book order without an order', async () => {
        expect(texts(buildSuggestions(await fixtureSnapshot(), 'en'))).toEqual([
            'Assets today',
            'Card today',
            'Expenses by month this year',
        ]);
    });

    it('names the net result Report nets', async () => {
        const snapshot = await ledgerSnapshot(simpleRootsLedger());
        expect(texts(buildSuggestions(snapshot, 'en', [NET_RESULT_ROOT]))[0]).toBe(
            'Net result this year'
        );
    });

    it('offers only reports the Book can have', async () => {
        const ledger = fixtureLedger();
        for (const snapshot of [
            await fixtureSnapshot(),
            await laterSnapshot(),
            await ledgerSnapshot(simpleRootsLedger()),
        ]) {
            for (const { intent } of suggestionCandidates(snapshot)) {
                const queries = planQueries(planReport(intent, snapshot));
                const balances = queries.map(query => ledgerBalances(ledger, query));
                expect(buildReport(intent, snapshot, balances).answer.amount).toBeDefined();
            }
        }
    });
});

describe('readSuggestions', () => {
    it('asks Jev once which report the person wants first, among the candidates', async () => {
        const snapshot = await fixtureSnapshot();
        const jev = fakeJev(NET_ASSETS_EXPENSES);
        const { suggestions } = await readFrom(snapshot, 'en', jev);
        expect(texts(suggestions)).toEqual([
            'Net income this year',
            'Assets today',
            'Expenses by month this year',
        ]);
        expect(jev.requests).toHaveLength(1);
        const [question] = Object.values(jev.requests[0].questions) as {
            type: string;
            criteria: Record<string, string>;
        }[];
        expect(Object.keys(jev.requests[0].questions)).toHaveLength(1);
        expect(question.type).toBe('choice');
        expect(Object.keys(question.criteria)).toEqual([
            'Assets',
            'Banks',
            'Card',
            'Expenses',
            'Revenue',
            'Net income',
        ]);
        // An option says where it is and how much of the Book it holds, never an amount: two of
        // the eight accounts with transactions posted that are not archived.
        expect(question.criteria.Banks).toContain('Assets');
        expect(question.criteria.Expenses).toMatch(/\b25%/);
    });

    it('remembers the order for the same map, and asks again when the map changes', async () => {
        const cache = createTestEnv().KV as SuggestionStore;
        const jev = fakeJev(NET_ASSETS_EXPENSES);
        const snapshot = await fixtureSnapshot();
        await readFrom(snapshot, 'en', jev, cache);
        // Another day, another language: the same map.
        const later = await readFrom(await laterSnapshot(), 'pt', jev, cache);
        expect(jev.requests).toHaveLength(1);
        expect(later.suggestions.map(suggestion => suggestion.intent.root)).toEqual([
            'g-net',
            'g-assets',
            'g-expenses',
        ]);
        snapshot.groups['g-card'].name = 'Credit cards';
        await readFrom(snapshot, 'en', jev, cache);
        expect(jev.requests).toHaveLength(2);
    });

    it('suggests in Book order when Jev fails, and remembers nothing', async () => {
        const cache = createTestEnv().KV as SuggestionStore;
        const snapshot = await fixtureSnapshot();
        const failed = await readFrom(snapshot, 'en', fakeJev(), cache);
        expect(texts(failed.suggestions)).toEqual(texts(buildSuggestions(snapshot, 'en')));
        const jev = fakeJev(NET_ASSETS_EXPENSES);
        await readFrom(snapshot, 'en', jev, cache);
        expect(jev.requests).toHaveLength(1);
    });

    it('suggests this year when it has movements, reading only the reports’ own queries', async () => {
        const { suggestions, queries } = await readFrom(await fixtureSnapshot());
        expect(texts(suggestions)).toEqual([
            'Net income this year',
            'Assets today',
            'Expenses by month this year',
        ]);
        // Net income and Expenses, this year and the year before; a position today never
        // moves, so Assets reads nothing here.
        expect(queries).toEqual([
            "group:'Net income' after:$y before:$m+1 by:m",
            "group:'Net income' after:$y-1 before:$m-11 by:m",
            "group:'Expenses' after:$y before:$m+1 by:m",
            "group:'Expenses' after:$y-1 before:$m-11 by:m",
        ]);
    });

    it('suggests the last year with movements on a Book with only old data, and says so', async () => {
        const { suggestions, queries } = await readFrom(await laterSnapshot());
        expect(suggestions).toEqual([
            {
                text: 'Net income in 2026',
                intent: { root: 'g-net', period: { span: 'year', year: 2026 }, monthly: false },
            },
            {
                text: 'Assets today',
                intent: { root: 'g-assets', period: { span: 'now' }, monthly: false },
            },
            {
                text: 'Expenses by month in 2026',
                intent: { root: 'g-expenses', period: { span: 'year', year: 2026 }, monthly: true },
            },
        ]);
        // One query of history per suggested report that can move, never one per group.
        expect(queries.filter(query => !/ (on|after):/.test(query))).toEqual([
            "group:'Net income' before:$m+1 by:m",
            "group:'Expenses' before:$m+1 by:m",
        ]);
    });

    it('suggests reports that show the Book’s data', async () => {
        const ledger = fixtureLedger();
        const snapshot = await laterSnapshot();
        ledger.today = snapshot.today;
        const { suggestions } = await readFrom(snapshot);
        for (const { intent } of suggestions) {
            const queries = planQueries(planReport(intent, snapshot));
            const balances = queries.map(query => ledgerBalances(ledger, query));
            const report = buildReport(intent, snapshot, balances);
            expect(report.answer?.amount).not.toBe('0');
            expect(report.breakdown.length).toBeGreaterThan(0);
        }
    });

    it('writes the year in the requested language', async () => {
        addLocale('eo', {
            suggestion_breakdown_year: '{root} en {year}',
            suggestion_monthly_year: '{root} monate en {year}',
        });
        const { suggestions } = await readFrom(await laterSnapshot(), 'eo');
        expect(texts(suggestions)).toEqual([
            'Net income en 2026',
            'Assets today',
            'Expenses monate en 2026',
        ]);
    });

    it('keeps a suggestion’s period when its balances cannot be read', async () => {
        const snapshot = await laterSnapshot();
        const order = ['g-net', 'g-assets', 'g-expenses'];
        const suggestions = await readSuggestions(snapshot, 'en', {
            loadBalances: async () => {
                throw new Error('Bkper is unavailable');
            },
            timing: new ServerTiming(),
            decisions: fakeJev(NET_ASSETS_EXPENSES).client,
        });
        expect(suggestions).toEqual(buildSuggestions(snapshot, 'en', order));
    });
});
