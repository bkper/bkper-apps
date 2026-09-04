import { describe, expect, test } from 'bun:test';
import { Summary, SummaryState } from '../../../src/api/services/summary.js';

describe('operation Summary', () => {
    test('exposes typed states and UI messages', () => {
        const empty = new Summary();
        expect(empty.getState()).toBe(SummaryState.EMPTY);
        expect(empty.getMessage()).toBe('');

        const cases: Array<[Summary, SummaryState, string]> = [
            [new Summary().done(), SummaryState.DONE, 'Done!'],
            [new Summary().done('Complete'), SummaryState.DONE, 'Complete'],
            [
                new Summary().rebuild(),
                SummaryState.REBUILD,
                'Account needs rebuild: reseting async...',
            ],
            [new Summary().resetingAsync(), SummaryState.RESETTING, 'Reseting async...'],
            [new Summary().calculatingAsync(), SummaryState.CALCULATING, 'Calculating async...'],
            [
                new Summary().lockError(),
                SummaryState.LOCKED,
                'Cannot proceed: collection has locked/closed book(s)',
            ],
            [
                new Summary().forwardError('Forward failed'),
                SummaryState.FORWARD_ERROR,
                'Forward failed',
            ],
        ];

        for (const [summary, state, message] of cases) {
            expect(summary.getState()).toBe(state);
            expect(summary.getMessage()).toBe(message);
        }
    });
});
