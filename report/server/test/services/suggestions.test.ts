import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/services/report';
import type { Snapshot } from '../../src/services/snapshot';
import { buildSuggestions } from '../../src/services/suggestions';
import { fixtureSnapshot } from '../fixtures/snapshot-book';

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

    it('suggests only reports every suggestion can build from the snapshot', async () => {
        for (const snapshot of [await fixtureSnapshot(), await laterSnapshot()]) {
            for (const { intent } of buildSuggestions(snapshot, 'en')) {
                expect(buildReport(intent, snapshot)).toHaveProperty('report');
            }
        }
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
