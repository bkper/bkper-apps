import { describe, expect, it } from 'bun:test';
import { Account, Book, Transaction } from 'bkper-js';

import {
    ACCOUNT_CHOICE_QUESTION,
    buildAccountChoiceRequest,
    collectAccountOptions,
    decideAccountOption,
} from '../../src/services/AccountChoice.js';

const book = new Book({ id: 'book_1' });
const BANK: bkper.Account = { id: 'bank', name: 'Bank', type: 'ASSET' };
const OWNER: bkper.Account = { id: 'owner', name: 'Owner Contribution', type: 'LIABILITY', groups: [{ name: 'Equity' }, { name: 'Internal', hidden: true }] };
const CLIENT: bkper.Account = { id: 'client', name: 'Client Receivable', type: 'ASSET' };
const CARD: bkper.Account = { id: 'card', name: 'Card', type: 'LIABILITY' };
const FUEL: bkper.Account = { id: 'fuel', name: 'Fuel', type: 'OUTGOING' };

function posted(id: string, creditAccount: bkper.Account, debitAccount: bkper.Account, extra: bkper.Transaction = {}): Transaction {
    return new Transaction(book, { id, creditAccount, debitAccount, description: 'DEPOSIT', amount: '100.00', date: '2026-02-01', posted: true, ...extra });
}

function draft(payload: bkper.Transaction): Transaction {
    return new Transaction(book, { description: 'DEPOSIT', amount: '5000.00', date: '2026-03-01', ...payload });
}

describe('collectAccountOptions', () => {
    it('groups history by the Account for the empty side, in order of first appearance', () => {
        const options = collectAccountOptions(draft({ debitAccount: { id: BANK.id } }), [
            posted('t1', CLIENT, BANK),
            posted('t2', OWNER, BANK),
            posted('t3', CLIENT, BANK),
        ]);

        expect(options.map(option => option.label)).toEqual(['From: Client Receivable', 'From: Owner Contribution']);
        expect(options[0].transactions.map(transaction => transaction.getId())).toEqual(['t1', 't3']);
        expect(options[0].creditAccount?.id).toBe(CLIENT.id);
        expect(options[0].debitAccount).toBeUndefined();
    });

    it('fills the To side when the From side is known', () => {
        const options = collectAccountOptions(draft({ creditAccount: { id: CARD.id } }), [posted('t1', CARD, FUEL), posted('t2', BANK, FUEL)]);

        expect(options.map(option => option.label)).toEqual(['To: Fuel']);
        expect(options[0].transactions).toHaveLength(2);
    });

    it('leaves out an Account already on the other side, such as history in the opposite direction', () => {
        const options = collectAccountOptions(draft({ creditAccount: { id: BANK.id } }), [posted('t1', CLIENT, BANK), posted('t2', BANK, FUEL)]);

        expect(options.map(option => option.label)).toEqual(['To: Fuel']);
    });

    it('leaves out the Account Bookbot suggested before on that side, under either property name', () => {
        const history = [posted('t1', CLIENT, BANK), posted('t2', OWNER, BANK)];

        for (const key of ['bookbot_credit_account_id_', 'agent_credit_account_id_']) {
            const options = collectAccountOptions(draft({ debitAccount: { id: BANK.id }, properties: { [key]: CLIENT.id! } }), history);
            expect(options.map(option => option.label)).toEqual(['From: Owner Contribution']);
        }
    });

    it('offers whole movements when both sides are empty, without blocked sides', () => {
        const options = collectAccountOptions(draft({ properties: { bookbot_debit_account_id_: BANK.id! } }), [
            posted('t1', CARD, FUEL),
            posted('t2', CLIENT, BANK),
            posted('t3', CARD, FUEL),
        ]);

        expect(options.map(option => option.label)).toEqual(['Card → Fuel']);
        expect(options[0].creditAccount?.id).toBe(CARD.id);
        expect(options[0].debitAccount?.id).toBe(FUEL.id);
    });

    it('offers nothing when both sides are known', () => {
        expect(collectAccountOptions(draft({ creditAccount: { id: BANK.id }, debitAccount: { id: FUEL.id } }), [posted('t1', BANK, CLIENT)])).toEqual([]);
    });
});

describe('buildAccountChoiceRequest', () => {
    it('puts the draft and each option\'s history in the state, with date facts computed by code', () => {
        const subject = draft({
            debitAccount: { id: BANK.id },
            tags: ['owner'],
            properties: { project: 'Alpha', bookbot_confidence_: '0.95', agent_note: 'x', extractor_file_id_: 'f', hidden_: 'h' },
        });
        const options = collectAccountOptions(subject, [posted('t1', OWNER, BANK, { amount: '5000.00', properties: { project: 'Alpha' } })]);
        const known = new Account(book, BANK);

        const request = buildAccountChoiceRequest(subject, options, known);

        expect(request.state).toEqual({
            draft: {
                description: 'DEPOSIT',
                amount: 5000,
                date: '2026-03-01',
                day_of_month: 1,
                weekday: 'Sunday',
                month: 'March',
                to: 'Bank',
                hashtags: ['owner'],
                properties: { project: 'Alpha' },
            },
            history: {
                'From: Owner Contribution': {
                    facts: { past_transactions: 1, amount_min: 5000, amount_max: 5000, with_same_amount: 1, with_day_of_month_within_3_days: 1 },
                    transactions: [{
                        description: 'DEPOSIT',
                        amount: 5000,
                        date: '2026-02-01',
                        day_of_month: 1,
                        weekday: 'Sunday',
                        month: 'February',
                        from: 'Owner Contribution',
                        to: 'Bank',
                        properties: { project: 'Alpha' },
                    }],
                },
            },
        });
        const question = request.questions[ACCOUNT_CHOICE_QUESTION];
        expect(question.type).toBe('choice');
        expect(Object.keys(question.criteria)).toEqual(['From: Owner Contribution']);
        expect(question.criteria['From: Owner Contribution']).toBe('From Owner Contribution (Liability; groups: Equity)');
    });

    it('compares each option\'s past amounts and days of month with the draft, with days up to 3 apart as the same', () => {
        const subject = draft({ debitAccount: { id: BANK.id }, amount: '5000.00', date: '2026-03-01' });
        const options = collectAccountOptions(subject, [
            posted('t1', CLIENT, BANK, { amount: '1200.00', date: '2026-02-17' }),
            posted('t2', CLIENT, BANK, { amount: '5000.00', date: '2026-02-09' }),
            posted('t3', CLIENT, BANK, { amount: '860.50', date: '2026-01-04' }),
            posted('t4', CLIENT, BANK, { amount: '860.50', date: '2026-01-05' }),
        ]);
        const history = buildAccountChoiceRequest(subject, options).state.history as Record<string, { facts: unknown }>;

        expect(history['From: Client Receivable'].facts).toEqual({
            past_transactions: 4, amount_min: 860.5, amount_max: 5000, with_same_amount: 1, with_day_of_month_within_3_days: 1,
        });
    });

    it('leaves unknown sides out of the state instead of sending null', () => {
        const subject = draft({});
        const request = buildAccountChoiceRequest(subject, collectAccountOptions(subject, [posted('t1', CARD, FUEL)]));

        expect(JSON.stringify(request)).not.toContain('null');
        expect(request.questions[ACCOUNT_CHOICE_QUESTION].criteria['Card → Fuel']).toBe('From Card (Liability) to Fuel (Outgoing)');
    });

    it('trims long descriptions and property values', () => {
        const subject = draft({ debitAccount: { id: BANK.id }, description: 'x'.repeat(300), properties: { note: 'y'.repeat(300) } });
        const request = buildAccountChoiceRequest(subject, collectAccountOptions(subject, [posted('t1', OWNER, BANK)]));
        const facts = request.state.draft as { description: string; properties: { note: string } };

        expect(facts.description.length).toBe(201);
        expect(facts.properties.note.length).toBe(257);
    });
});

describe('decideAccountOption', () => {
    const subject = draft({ debitAccount: { id: BANK.id } });
    const options = collectAccountOptions(subject, [posted('t1', OWNER, BANK), posted('t2', CLIENT, BANK)]);

    it('returns the chosen option with its confidence, however low', () => {
        expect(decideAccountOption(options, { choice: 'From: Owner Contribution', confidence: 0.3 })).toEqual({ option: options[0], confidence: 0.3 });
    });

    it('returns nothing for a label that was not offered', () => {
        expect(decideAccountOption(options, { choice: 'From: Loans', confidence: 0.99 })).toBeUndefined();
    });
});
