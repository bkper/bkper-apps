import { describe, expect, it } from 'vitest';
import {
    choosePrompts,
    FLOW_PERIODS,
    PLAIN_PHRASES,
    type BookName,
} from '../scripts/measure-api/flow';
import { percentile, readTiming } from '../scripts/measure-api/timing';

function names(...list: [string, BookName['kind']][]): BookName[] {
    return list.map(([name, kind], i) => ({ id: String(i), name, kind, root: '0' }));
}

const BOOK = names(
    ['Despesas', 'group'],
    ['Aluguel', 'account'],
    ['Credit Card', 'account'],
    ['Card', 'account'],
    ['X', 'account'],
    ['Money', 'account']
);

describe('readTiming', () => {
    it('reads each metric with a duration, in milliseconds', () => {
        expect(readTiming('user;dur=130, kv;desc="KV";dur=4.5, cache, total;dur=412')).toEqual({
            user: 130,
            kv: 4.5,
            total: 412,
        });
        expect(readTiming(null)).toEqual({});
    });
});

describe('percentile', () => {
    it('takes the nearest rank, whatever the order', () => {
        expect(percentile([30, 10, 20, 40], 50)).toBe(20);
        expect(percentile([30, 10, 20, 40], 95)).toBe(40);
        expect(percentile([7], 95)).toBe(7);
        expect(percentile([], 50)).toBeNaN();
    });
});

describe('choosePrompts', () => {
    it('names exactly one of the Book names, and the plain prompt none', () => {
        for (let round = 0; round < 20; round++) {
            const { named, plain } = choosePrompts(BOOK, [], round);
            const period = FLOW_PERIODS[round % FLOW_PERIODS.length];
            expect(named).toMatch(new RegExp(` ${period}$`));
            const name = named!.slice(0, -period.length - 1);
            expect(BOOK.map(n => n.name)).toContain(name);
            expect(name).not.toBe('X');
            expect(plain).toMatch(new RegExp(` ${period}$`));
            expect(plain!.toLowerCase()).not.toContain('money');
        }
    });

    it('is deterministic, varies by round and spreads over the names', () => {
        expect(choosePrompts(BOOK, [], 3)).toEqual(choosePrompts(BOOK, [], 3));
        const prompts = Array.from({ length: FLOW_PERIODS.length }, (_, round) =>
            choosePrompts(BOOK, [], round)
        );
        expect(new Set(prompts.map(p => p.named)).size).toBe(FLOW_PERIODS.length);
        expect(new Set(prompts.map(p => p.plain)).size).toBe(FLOW_PERIODS.length);
        expect(new Set(prompts.map(p => p.named!.split(' ')[0])).size).toBeGreaterThan(2);
    });

    it('never asks a suggestion text, which the client shows from memory', () => {
        const period = FLOW_PERIODS[0];
        const everyName = BOOK.map(n => `${n.name}  ${period}`);
        const everyPhrase = PLAIN_PHRASES.map(phrase => `${phrase} ${period}`);
        expect(choosePrompts(BOOK, [...everyName, ...everyPhrase], 0)).toEqual({});
    });
});
