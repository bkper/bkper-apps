import { describe, expect, it } from 'vitest';
import { buildReport, planQueries, planReport } from '../../src/services/report';
import type { Snapshot } from '../../src/services/snapshot';
import { buildSuggestions } from '../../src/services/suggestions';
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

/** The fixture with only some of its root groups. */
async function withRoots(...roots: string[]): Promise<Snapshot> {
    return { ...(await fixtureSnapshot()), roots };
}

describe('buildSuggestions', () => {
    it('suggests the net result, the largest expenses by month and a position', async () => {
        expect(buildSuggestions(await fixtureSnapshot(), 'en')).toEqual([
            {
                text: 'Net result this year',
                intent: { root: 'net-result', period: 'this_year', monthly: false },
            },
            {
                text: 'Expenses by month this year',
                intent: { root: 'g-expenses', period: 'this_year', monthly: true },
            },
            {
                text: 'Assets today',
                intent: { root: 'g-assets', period: 'today', monthly: false },
            },
        ]);
    });

    it('anchors periods to the last year with movements when this year has none', async () => {
        expect(buildSuggestions(await laterSnapshot(), 'en')).toEqual([
            {
                text: 'Net result in 2026',
                intent: { root: 'net-result', period: '2026', monthly: false },
            },
            {
                text: 'Expenses by month in 2026',
                intent: { root: 'g-expenses', period: '2026', monthly: true },
            },
            {
                text: 'Assets at the end of 2026',
                intent: { root: 'g-assets', period: '2026', monthly: false },
            },
        ]);
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

    it('ranks roots of a kind by their months with movements, reading no amounts', async () => {
        const snapshot = await fixtureSnapshot();
        snapshot.groups['g-net'].type = 'INCOMING';
        const order = (roots: string[]) =>
            buildSuggestions({ ...snapshot, roots }, 'en').map(suggestion => suggestion.text);
        // Net income's accounts moved in seven months this year, Revenue's in two. Both are
        // Incoming, so the Book has no net result.
        expect(order(['g-revenue', 'g-net'])).toEqual([
            'Net income by month this year',
            'Revenue this year',
        ]);
        snapshot.accounts['a-rent'].activeMonths = [];
        snapshot.accounts['a-food'].activeMonths = [];
        // As busy as each other, they keep Book order.
        expect(order(['g-revenue', 'g-net'])).toEqual([
            'Revenue by month this year',
            'Net income this year',
        ]);
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

    it('leaves out roots without movements and the net result without both sides', async () => {
        // Card has no movements; Expenses alone has nothing to net against.
        expect(buildSuggestions(await withRoots('g-card', 'g-assets', 'g-expenses'), 'en')).toEqual(
            [
                {
                    text: 'Expenses by month this year',
                    intent: { root: 'g-expenses', period: 'this_year', monthly: true },
                },
                {
                    text: 'Assets today',
                    intent: { root: 'g-assets', period: 'today', monthly: false },
                },
            ]
        );
        expect(buildSuggestions(await withRoots('g-card'), 'en')).toEqual([]);
    });
});
