import { describe, expect, it } from 'bun:test';

import { draftFrom, parseSearch, type BookSnapshot, type EvalCase, type JevAnswer } from '../../eval/discovery-books/frozen.js';
import { readOnlyFetch } from '../../eval/discovery-books/readOnly.js';
import { replayCase } from '../../eval/discovery-books/replay.js';
import { checkProductionTarget, compare, exactMcNemar, tally, tallyOutcomes, verdictOf, type CaseResult, type Verdict } from '../../eval/discovery-books/score.js';

function result(caseId: string, verdict: Verdict, book = 'Book'): CaseResult {
    return { book, caseId, expectedAccountId: 'right', verdict, ...(verdict === 'none' ? {} : { suggestedAccountId: verdict === 'right' ? 'right' : 'other' }) };
}

function results(counts: { right: number; wrong: number; none: number }, offset = 0): CaseResult[] {
    const verdicts: Verdict[] = [
        ...Array<Verdict>(counts.right).fill('right'),
        ...Array<Verdict>(counts.wrong).fill('wrong'),
        ...Array<Verdict>(counts.none).fill('none'),
    ];
    return verdicts.map((verdict, index) => result(String(index + offset), verdict));
}

describe('scoring', () => {
    it('scores a suggestion against the Account people posted', () => {
        expect(verdictOf('a', 'a')).toBe('right');
        expect(verdictOf('a', 'b')).toBe('wrong');
        expect(verdictOf('a', undefined)).toBe('none');
        expect(tally([result('1', 'right'), result('2', 'wrong'), result('3', 'none')])).toEqual({ cases: 3, right: 1, wrong: 1, none: 1, errors: 0 });
    });

    it('computes the exact two-sided McNemar test, even for many discordant cases', () => {
        expect(exactMcNemar(10, 0)).toBeCloseTo(2 / 1024, 10);
        expect(exactMcNemar(5, 5)).toBe(1);
        expect(exactMcNemar(0, 0)).toBe(1);
        expect(exactMcNemar(600, 500)).toBeGreaterThan(0);
        expect(exactMcNemar(600, 500)).toBeLessThan(0.01);
    });

    it('meets the target with a quarter fewer wrong suggestions and right answers kept', () => {
        const baseline = results({ right: 100, wrong: 40, none: 0 });
        // Of the 40 wrong suggestions, 15 become no guess.
        const variant = baseline.map((item, index) => (index >= 100 && index < 115 ? result(item.caseId, 'none') : item));
        const comparison = compare(baseline, variant);

        expect(comparison.wrongRemoved).toBe(15);
        expect(comparison.meetsTarget).toBe(true);
    });

    it('misses the target when right answers fall by more than 1%', () => {
        const baseline = results({ right: 100, wrong: 40, none: 0 });
        const variant = baseline.map((item, index) => (index < 2 || (index >= 100 && index < 115) ? result(item.caseId, 'none') : item));

        expect(compare(baseline, variant).meetsTarget).toBe(false);
    });

    it('misses the target when wrong suggestions fall by less than a quarter', () => {
        const baseline = results({ right: 100, wrong: 40, none: 0 });
        const variant = baseline.map((item, index) => (index >= 100 && index < 109 ? result(item.caseId, 'none') : item));

        expect(compare(baseline, variant).meetsTarget).toBe(false);
    });

    it('refuses to compare runs over different cases', () => {
        expect(() => compare(results({ right: 2, wrong: 0, none: 0 }), results({ right: 2, wrong: 0, none: 0 }, 1))).toThrow();
    });
});

describe('read-only guard', () => {
    const calls: string[] = [];
    const fetcher = Object.assign(async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response('{}');
    }, { preconnect: () => {} }) as typeof fetch;
    const guarded = readOnlyFetch(fetcher);

    it('lets Book reads and Bkper AI calls through', async () => {
        await guarded('https://api.bkper.app/v5/books/b/transactions?query=x');
        await guarded('https://ai.bkper.app/v1/systemone', { method: 'POST' });
        expect(calls).toHaveLength(2);
    });

    it('refuses any write to a Book before it is sent', async () => {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            await expect(guarded('https://api.bkper.app/v5/books/b/transactions', { method })).rejects.toThrow();
        }
        await expect(guarded(new Request('https://api.bkper.app/v5/books/b/transactions/post', { method: 'PUT' }))).rejects.toThrow();
        expect(calls).toHaveLength(2);
    });
});

const BANK = { id: 'bank', name: 'Bank', type: 'ASSET' as const };
const HOSTING = { id: 'hosting', name: 'Hosting', type: 'OUTGOING' as const };
const RENT = { id: 'rent', name: 'Rent', type: 'OUTGOING' as const };

function posted(id: string, to: bkper.Account, date: string): bkper.Transaction {
    return { id, date, description: 'ACME HOSTING 123', amount: '10', creditAccount: { id: BANK.id }, debitAccount: { id: to.id } };
}

function snapshotWith(searches: EvalCase['searches']): { snapshot: BookSnapshot; evalCase: EvalCase } {
    const evalCase: EvalCase = {
        id: 'case',
        draft: draftFrom({ ...posted('case', HOSTING, '2026-05-10'), properties: { invoice: '7', bookbot_debit_account_id_: 'rent', bank_id_: 'x' } }, 'credit'),
        expectedAccountId: HOSTING.id,
        searches,
    };
    return {
        evalCase,
        snapshot: {
            version: 1, bookId: 'book', label: 'Book', takenAt: '2026-11-14', searchLimit: 15,
            accounts: { bank: BANK, hosting: HOSTING, rent: RENT },
            transactions: { t1: posted('t1', HOSTING, '2026-04-10'), t2: posted('t2', HOSTING, '2026-03-10'), t3: posted('t3', RENT, '2026-02-10') },
            descriptionParts: { 'ACME HOSTING 123': ['ACME HOSTING'] },
            cases: [evalCase],
        },
    };
}

/** A recording that holds the same answer for every request. */
class AnswerEveryRequest extends Map<string, JevAnswer> {
    constructor(private readonly answer: JevAnswer) {
        super();
    }

    override get(): JevAnswer {
        return this.answer;
    }
}

const FIRST_SEARCH = 'account: \'Bank\' "ACME HOSTING 123" is:posted';

describe('replaying a frozen case', () => {
    it('keeps only the bank side and the operation\'s own properties in the draft', () => {
        const { evalCase } = snapshotWith({});
        expect(evalCase.draft.debitAccount).toBeUndefined();
        expect(evalCase.draft.properties).toEqual({ invoice: '7' });
    });

    it('fills the only option without Jev and scores it', async () => {
        const { snapshot, evalCase } = snapshotWith({ [FIRST_SEARCH]: ['t1', 't2'] });
        const replayed = await replayCase(snapshot, evalCase, { recording: new Map() });

        expect(replayed.verdict).toBe('right');
        expect(replayed.decision).toEqual({ level: 'known account', term: 'description', options: 1, confidence: 1 });
    });

    it('uses Jev\'s recorded answer when the search found several options', async () => {
        const { snapshot, evalCase } = snapshotWith({ [FIRST_SEARCH]: ['t1', 't3'] });
        const replayed = await replayCase(snapshot, evalCase, { recording: new AnswerEveryRequest({ choice: 'To: Rent', confidence: 0.97 }) });

        expect(replayed.verdict).toBe('wrong');
        expect(replayed.suggestedAccountId).toBe(RENT.id);
        expect(replayed.decision?.options).toBe(2);
    });

    it('reports a missing Jev answer instead of calling Jev offline', async () => {
        const { snapshot, evalCase } = snapshotWith({ [FIRST_SEARCH]: ['t1', 't3'] });
        const replayed = await replayCase(snapshot, evalCase, { recording: new Map() });

        expect(replayed.verdict).toBe('none');
        expect(replayed.missing).toBe(true);
    });

    it('replays a failed search as no history, without an error', async () => {
        const failure = { error: 'Unable to parse query' };
        const { snapshot, evalCase } = snapshotWith({
            [FIRST_SEARCH]: failure,
            'account: \'Bank\' "ACME HOSTING" is:posted': [],
            '"ACME HOSTING 123" is:posted': failure,
            '"ACME HOSTING" is:posted': [],
        });
        const replayed = await replayCase(snapshot, evalCase, { recording: new Map() });

        expect(replayed).toMatchObject({ verdict: 'none' });
        expect(replayed.error).toBeUndefined();
        expect(replayed.missing).toBeUndefined();
    });

    it('classifies the deciding search', () => {
        const draft = { description: 'ACME HOSTING 123', tags: ['#fees'] };
        expect(parseSearch('account: \'Bank\' "ACME" createdBy:ana is:posted', draft)).toEqual({ level: 'known account and creator', term: 'description part' });
        expect(parseSearch('"fees" is:posted', draft)).toEqual({ level: 'whole Book', term: 'hashtag' });
    });
});

describe('production outcomes', () => {
    const at = (iso: string) => String(Date.parse(iso));
    const period = { from: Date.parse('2026-11-01T00:00:00Z'), to: Date.parse('2026-11-08T00:00:00Z') };

    it('counts a suggestion kept only when every suggested side was posted, and leaves drafts and older names apart', () => {
        const transactions: bkper.Transaction[] = [
            { createdAt: at('2026-11-02T00:00:00Z'), posted: true, debitAccount: { id: 'rent' }, properties: { bookbot_debit_account_id_: 'rent' } },
            { createdAt: at('2026-11-02T00:00:00Z'), posted: true, creditAccount: { id: 'bank' }, debitAccount: { id: 'food' }, properties: { agent_debit_account_id_: 'rent', agent_credit_account_id_: 'bank' } },
            { createdAt: at('2026-11-03T00:00:00Z'), posted: false, properties: { bookbot_credit_account_id_: 'bank' } },
            { createdAt: at('2026-11-04T00:00:00Z'), posted: true },
            { createdAt: at('2026-11-09T00:00:00Z'), posted: true, debitAccount: { id: 'rent' }, properties: { bookbot_debit_account_id_: 'rent' } },
        ];
        expect(tallyOutcomes('Book', transactions, period)).toEqual({ book: 'Book', created: 4, suggestions: 3, kept: 1, changed: 1, drafts: 1 });
    });

    it('meets the target only when the changed share halves, falls in most active Books, and coverage holds', () => {
        const row = (book: string, created: number, kept: number, changed: number) => ({ book, created, suggestions: kept + changed, kept, changed, drafts: 0 });
        const before = [row('A', 100, 30, 10), row('B', 100, 30, 10), row('C', 100, 30, 10)];
        expect(checkProductionTarget(before, [row('A', 100, 36, 2), row('B', 100, 36, 2), row('C', 100, 30, 6)]).meetsTarget).toBe(true);
        // Fewer suggestions hide wrong ones: coverage falls below 75%.
        expect(checkProductionTarget(before, [row('A', 100, 20, 0), row('B', 100, 20, 0), row('C', 100, 20, 0)]).meetsTarget).toBe(false);
        // The fall is carried by one Book.
        expect(checkProductionTarget(before, [row('A', 100, 120, 0), row('B', 100, 30, 10), row('C', 100, 30, 10)]).meetsTarget).toBe(false);
        // Fewer than 3 Books active in both periods.
        expect(checkProductionTarget(before.slice(0, 2), [row('A', 100, 40, 0), row('B', 100, 40, 0)]).inconclusive).toBe(true);
    });
});
