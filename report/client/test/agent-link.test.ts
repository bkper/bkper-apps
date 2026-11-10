import { describe, expect, it } from 'vitest';
import type { BookProblem } from '../src/api/app-api';
import { t } from 'report-shared/strings';
import { agentPrompt, agentUrl, customReportPrompt, MAX_AGENT_PROMPT } from '../src/agent-link';

const BASE = { bookName: 'Acme Ltd', canOrganize: true };

/** The request a link holds, read as the Agent reads it. */
function promptOf(url: string): string | null {
    return new URL(url).searchParams.get('q');
}

describe('agentUrl', () => {
    it('opens the Agent in the Book’s transactions, with the request in `q`', () => {
        const url = agentUrl('https://bkper.app', 'book 1', 'Help me & "you" + 50%?');
        const parsed = new URL(url);
        expect(parsed.origin).toBe('https://bkper.app');
        expect(parsed.pathname).toBe('/books/book%201/transactions');
        expect(parsed.searchParams.get('app')).toBe('bkper-agent');
        expect(promptOf(url)).toBe('Help me & "you" + 50%?');
    });

    it('opens the Agent with no request when given none', () => {
        const url = agentUrl('https://dev.bkper.app', 'b1');
        expect(url).toBe('https://dev.bkper.app/books/b1/transactions?app=bkper-agent');
    });
});

describe('customReportPrompt', () => {
    it('starts a request for a report built without Report, ready for the person to finish', () => {
        expect(customReportPrompt('en')).toBe(
            'Create a custom report, without using the Report app, that '
        );
    });

    it('is written in the interface language, ending with a space for the person to go on', () => {
        const prompt = customReportPrompt('fr');
        expect(prompt).toBe(`${t('agent_prompt_custom_report', 'fr')} `);
        expect(prompt.length).toBeLessThanOrEqual(MAX_AGENT_PROMPT);
    });
});

describe('agentPrompt', () => {
    it('writes no request for an empty Book, so the Agent starts its onboarding', () => {
        expect(agentPrompt({ ...BASE, code: 'empty_book' }, 'en')).toBeUndefined();
    });

    it('asks to organize accounts in no group into groups', () => {
        const problem: BookProblem = {
            ...BASE,
            code: 'nothing_to_report',
            ungrouped: 1200,
            total: 1500,
        };
        expect(agentPrompt(problem, 'en')).toBe(
            'My Book "Acme Ltd" has nothing to report on: 1,200 of its 1,500 accounts with transactions are in no group. Help me organize them into groups for reports, such as a balance sheet and an income statement. Change groups only, not transactions.'
        );
    });

    it('names the income and expense groups no group combines', () => {
        const problem: BookProblem = {
            ...BASE,
            code: 'no_net_result',
            incoming: ['Revenue', 'Other income'],
            outgoing: ['Expenses'],
            shared: [],
        };
        expect(agentPrompt(problem, 'en')).toBe(
            'My Book "Acme Ltd" has no net result: no group combines Revenue and Other income and Expenses. Help me organize its groups so income and expenses meet in one group. Change groups only, not transactions.'
        );
    });

    it('names the groups that share accounts, before anything else', () => {
        const problem: BookProblem = {
            ...BASE,
            code: 'no_net_result',
            incoming: ['Revenue'],
            outgoing: ['Expenses', 'Costs'],
            shared: ['Expenses', 'Costs'],
        };
        expect(agentPrompt(problem, 'en')).toBe(
            'My Book "Acme Ltd" has no net result: its groups Expenses and Costs share accounts. Help me organize its groups so income and expenses meet in one group. Change groups only, not transactions.'
        );
    });

    it('speaks of income and expenses when the Book lacks either kind of group', () => {
        for (const [incoming, outgoing] of [
            [[], ['Expenses']],
            [['Revenue'], []],
            [[], []],
        ]) {
            const problem: BookProblem = {
                ...BASE,
                code: 'no_net_result',
                incoming,
                outgoing,
                shared: [],
            };
            expect(agentPrompt(problem, 'en')).toBe(
                'My Book "Acme Ltd" has no net result: no group combines its income and expenses. Help me organize its groups so income and expenses meet in one group. Change groups only, not transactions.'
            );
        }
    });

    it('names the group that mixes balances and activity', () => {
        const problem: BookProblem = { ...BASE, code: 'mixed_group', group: 'Everything' };
        expect(agentPrompt(problem, 'en')).toBe(
            'In my Book "Acme Ltd", the group Everything combines balances (Asset, Liability) with activity (Incoming, Outgoing). Help me separate them into their own groups. Change groups only, not transactions.'
        );
    });

    it('writes no request the Agent would ignore for its length', () => {
        const problem: BookProblem = {
            ...BASE,
            bookName: 'B'.repeat(MAX_AGENT_PROMPT),
            code: 'mixed_group',
            group: 'Everything',
        };
        expect(agentPrompt(problem, 'en')).toBeUndefined();
    });
});
