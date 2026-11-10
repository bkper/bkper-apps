import { addLocale } from 'report-shared/strings';
import { describe, expect, it } from 'vitest';
import { buildReport, planQueries, planReport } from '../../src/services/report';
import type { Snapshot } from '../../src/services/snapshot';
import { buildSuggestions, readSuggestions } from '../../src/services/suggestions';
import { ServerTiming } from '../../src/services/timing';
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

/** Reads the suggestions of a snapshot from the fixture's ledger, noting every query. */
async function readFrom(snapshot: Snapshot, lang = 'en') {
    const ledger = fixtureLedger();
    ledger.today = snapshot.today;
    const queries: string[] = [];
    const suggestions = await readSuggestions(snapshot, lang, {
        loadBalances: async asked => {
            queries.push(...asked);
            return asked.map(query => ledgerBalances(ledger, query));
        },
        timing: new ServerTiming(),
    });
    return { suggestions, queries };
}

/** The fixture with only some of its root groups. */
async function withRoots(...roots: string[]): Promise<Snapshot> {
    return { ...(await fixtureSnapshot()), roots };
}

describe('buildSuggestions', () => {
    it('suggests the net result, the largest expenses by month and a position', async () => {
        expect(buildSuggestions(await fixtureSnapshot(), 'en')).toEqual([
            {
                text: 'Net result this year',
                intent: {
                    root: 'net-result',
                    period: { span: 'year', year: 'current' },
                    monthly: false,
                },
            },
            {
                text: 'Expenses by month this year',
                intent: {
                    root: 'g-expenses',
                    period: { span: 'year', year: 'current' },
                    monthly: true,
                },
            },
            {
                text: 'Assets today',
                intent: { root: 'g-assets', period: { span: 'now' }, monthly: false },
            },
        ]);
    });

    it('suggests this year and today, as the map holds no dates of movements', async () => {
        // Years after the fixture's last movements, the suggestions are the same.
        expect(buildSuggestions(await laterSnapshot(), 'en')).toEqual(
            buildSuggestions(await fixtureSnapshot(), 'en')
        );
    });

    it('suggests only reports the Book can have', async () => {
        const ledger = fixtureLedger();
        for (const snapshot of [await fixtureSnapshot(), await laterSnapshot()]) {
            for (const { intent } of buildSuggestions(snapshot, 'en')) {
                const queries = planQueries(planReport(intent, snapshot));
                const balances = queries.map(query => ledgerBalances(ledger, query));
                expect(buildReport(intent, snapshot, balances).answer.amount).toBeDefined();
            }
        }
    });

    it('ranks roots of a kind by how many accounts they hold, reading no amounts', async () => {
        const snapshot = await fixtureSnapshot();
        snapshot.groups['g-net'].type = 'INCOMING';
        const order = (roots: string[]) =>
            buildSuggestions({ ...snapshot, roots }, 'en').map(suggestion => suggestion.text);
        // Net income holds three accounts, Revenue one. Both are Incoming, so the Book has no
        // net result.
        expect(order(['g-revenue', 'g-net'])).toEqual([
            'Net income by month this year',
            'Revenue this year',
        ]);
        // Archived accounts do not count: as large as each other, they keep Book order.
        snapshot.accounts['a-rent'].archived = true;
        snapshot.accounts['a-food'].archived = true;
        expect(order(['g-revenue', 'g-net'])).toEqual([
            'Revenue by month this year',
            'Net income this year',
        ]);
    });

    it('counts the accounts of subgroups, each once', async () => {
        const snapshot = await fixtureSnapshot();
        // Assets holds Cash and, through Banks, Bank A and Bank B; Card holds Credit Card.
        const texts = (roots: string[]) =>
            buildSuggestions({ ...snapshot, roots }, 'en').map(suggestion => suggestion.text);
        snapshot.groups['g-card'].type = 'ASSET';
        expect(texts(['g-card', 'g-assets'])).toEqual(['Assets today', 'Card today']);
        // Three accounts each, once listed twice: a tie keeps Book order.
        snapshot.groups['g-card'].accounts = ['a-card', 'a-card', 'a-bank-a', 'a-cash'];
        expect(texts(['g-assets', 'g-card'])).toEqual(['Assets today', 'Card today']);
        snapshot.groups['g-card'].accounts.push('a-bank-b');
        expect(texts(['g-assets', 'g-card'])).toEqual(['Card today', 'Assets today']);
    });

    it('fills three suggestions with other roots when the Book has no positions', async () => {
        const suggestions = buildSuggestions(
            await withRoots('g-expenses', 'g-revenue', 'g-net'),
            'en'
        );
        expect(suggestions.map(suggestion => suggestion.text)).toEqual([
            'Net result this year',
            'Expenses by month this year',
            'Revenue this year',
        ]);
    });

    it('suggests the net result only when the Book has one, and its group once', async () => {
        const texts = (snapshot: Snapshot) =>
            buildSuggestions(snapshot, 'en').map(suggestion => suggestion.text);
        // The group that combines Incoming and Outgoing is the net result.
        expect(texts(await withRoots('g-net', 'g-expenses'))).toEqual([
            'Net result this year',
            'Expenses by month this year',
        ]);
        // Simple roots, which Report nets.
        expect(texts(await ledgerSnapshot(simpleRootsLedger()))[0]).toBe('Net result this year');
        // Roots that share an account have none.
        const shared = await withRoots('g-expenses', 'g-revenue', 'g-net');
        shared.groups['g-net'] = { ...shared.groups['g-net'], type: 'OUTGOING' };
        expect(texts(shared)).not.toContain('Net result this year');
    });

    it('leaves out roots without accounts and the net result without both sides', async () => {
        // Card holds no account here; Expenses alone has nothing to net against.
        const snapshot = await withRoots('g-card', 'g-assets', 'g-expenses');
        snapshot.groups['g-card'] = { ...snapshot.groups['g-card'], accounts: [] };
        expect(buildSuggestions(snapshot, 'en')).toEqual([
            {
                text: 'Expenses by month this year',
                intent: {
                    root: 'g-expenses',
                    period: { span: 'year', year: 'current' },
                    monthly: true,
                },
            },
            {
                text: 'Assets today',
                intent: { root: 'g-assets', period: { span: 'now' }, monthly: false },
            },
        ]);
        expect(buildSuggestions({ ...snapshot, roots: ['g-card'] }, 'en')).toEqual([]);
    });
});

describe('readSuggestions', () => {
    it('suggests this year when it has movements, reading only the reports’ own queries', async () => {
        const snapshot = await fixtureSnapshot();
        const { suggestions, queries } = await readFrom(snapshot);
        expect(suggestions).toEqual(buildSuggestions(snapshot, 'en'));
        // The net result and Expenses, this year and the year before; a position today never
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
                text: 'Net result in 2026',
                intent: {
                    root: 'net-result',
                    period: { span: 'year', year: 2026 },
                    monthly: false,
                },
            },
            {
                text: 'Expenses by month in 2026',
                intent: { root: 'g-expenses', period: { span: 'year', year: 2026 }, monthly: true },
            },
            {
                text: 'Assets today',
                intent: { root: 'g-assets', period: { span: 'now' }, monthly: false },
            },
        ]);
        // One query of history per suggested root that can move, never one per root group.
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
            suggestion_net_result_year: 'Neta rezulto en {year}',
            suggestion_monthly_year: '{root} monate en {year}',
        });
        const { suggestions } = await readFrom(await laterSnapshot(), 'eo');
        expect(suggestions.map(suggestion => suggestion.text)).toEqual([
            'Neta rezulto en 2026',
            'Expenses monate en 2026',
            'Assets today',
        ]);
    });

    it('keeps a suggestion’s period when its balances cannot be read', async () => {
        const snapshot = await laterSnapshot();
        const suggestions = await readSuggestions(snapshot, 'en', {
            loadBalances: async () => {
                throw new Error('Bkper is unavailable');
            },
            timing: new ServerTiming(),
        });
        expect(suggestions).toEqual(buildSuggestions(snapshot, 'en'));
    });
});
