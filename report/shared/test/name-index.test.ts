import { describe, expect, it } from 'vitest';
import { MAX_COMPLETIONS, NameIndex, type BookName } from '../src/name-index';

let id = 0;
const group = (name: string, root?: string): BookName => {
    const own = `g${++id}`;
    return { id: own, name, kind: 'group', root: root ?? own };
};
const account = (name: string, root = 'g-root'): BookName => ({
    id: `a${++id}`,
    name,
    kind: 'account',
    root,
});

/** The names completing the text before `|` (the caret), and the text each replaces. */
function complete(index: NameIndex, marked: string): string[] {
    const caret = marked.indexOf('|');
    const text = marked.replace('|', '');
    return index
        .complete(text, caret === -1 ? text.length : caret)
        .map(({ name, from, to }) => `${name.name} ← ${text.slice(from, to)}`);
}

const BOOK = new NameIndex([
    group('Despesas'),
    group('Dívidas'),
    account('Refeições'),
    account('Credit Card'),
    account('Cash'),
    account('Car'),
    account('Conta corrente'),
    account('Net income'),
]);

describe('NameIndex', () => {
    it('completes the start of a name, ignoring case and accents, from two characters', () => {
        expect(complete(BOOK, 'despesas com REFEI')).toEqual(['Refeições ← REFEI']);
        expect(complete(BOOK, 'dividas')).toEqual(['Dívidas ← dividas']);
        expect(complete(BOOK, 'refeic\u0327o\u0303')).toEqual(['Refeições ← refeic\u0327o\u0303']);
        expect(complete(BOOK, 'ｒｅｆ')).toEqual(['Refeições ← ｒｅｆ']);
        expect(complete(BOOK, 'expenses r')).toEqual([]);
        expect(complete(BOOK, 're')).toEqual(['Refeições ← re']);
    });

    it('completes multiword names from their first word, whatever the whitespace', () => {
        expect(complete(BOOK, 'show credit ca')[0]).toBe('Credit Card ← credit ca');
        expect(complete(BOOK, 'credit\u00a0 ca')[0]).toBe('Credit Card ← credit\u00a0 ca');
        expect(complete(BOOK, 'net in')).toEqual(['Net income ← net in']);
    });

    it('ranks the most of the text completed, then names it starts, then the shortest, then Book order', () => {
        // "credit ca" completes more than "ca"; Car and Cash start with "ca"; Credit Card has a
        // word that does.
        expect(complete(BOOK, 'credit ca')).toEqual([
            'Credit Card ← credit ca',
            'Car ← ca',
            'Cash ← ca',
        ]);
        expect(complete(BOOK, 'ca')).toEqual(['Car ← ca', 'Cash ← ca', 'Credit Card ← ca']);
        expect(complete(BOOK, 'corr')).toEqual(['Conta corrente ← corr']);
        const tied = new NameIndex([account('Bank B'), account('Bank A')]);
        expect(complete(tied, 'ban')).toEqual(['Bank B ← ban', 'Bank A ← ban']);
    });

    it('matches only the start of a name or of one of its words, never inside a word', () => {
        expect(complete(BOOK, 'ash')).toEqual([]);
        expect(complete(BOOK, 'orrente')).toEqual([]);
        const dashed = new NameIndex([account('Despesas-fixas'), account('(Old) supplier')]);
        expect(complete(dashed, 'fix')).toEqual(['Despesas-fixas ← fix']);
        expect(complete(dashed, 'old')).toEqual(['(Old) supplier ← old']);
        expect(complete(dashed, '(ol')).toEqual(['(Old) supplier ← (ol']);
    });

    it('gives at most five', () => {
        const many = new NameIndex(
            Array.from({ length: 12 }, (_, n) => account(`Fee ${String(n).padStart(2, '0')}`))
        );
        const found = complete(many, 'fee');
        expect(found).toHaveLength(MAX_COMPLETIONS);
        expect(found[0]).toBe('Fee 00 ← fee');
    });

    it('completes only at the end of a word the caret ends, outside hashtags', () => {
        expect(complete(BOOK, 'ca|sh')).toEqual([]);
        expect(complete(BOOK, 'ca| in 2026')).toEqual([
            'Car ← ca',
            'Cash ← ca',
            'Credit Card ← ca',
        ]);
        expect(complete(BOOK, 'ca |')).toEqual([]);
        expect(complete(BOOK, '#ca')).toEqual([]);
        expect(complete(BOOK, '#travel ca')).toEqual(['Car ← ca', 'Cash ← ca', 'Credit Card ← ca']);
        expect(BOOK.complete('ca', -1)).toEqual([]);
        expect(BOOK.complete('ca', 3)).toEqual([]);
    });

    it('leaves out a name already written exactly, but offers it written another way', () => {
        expect(complete(BOOK, 'Credit Card')).toEqual([]);
        expect(complete(BOOK, 'Cash')).toEqual([]);
        expect(complete(BOOK, 'credit card')).toEqual(['Credit Card ← credit card']);
        // Car is written; a word of Credit Card starts with it.
        expect(complete(BOOK, 'Car')).toEqual(['Credit Card ← Car']);
    });

    it('offers each of names alike once folded, and one of names written alike: a group, then Book order', () => {
        const book = new NameIndex([
            account('Food'),
            group('Food'),
            account('Café'),
            group('Cafe'),
            account('Food '),
        ]);
        const found = book.complete('foo', 3);
        expect(found.map(({ name }) => `${name.kind} ${name.name}`)).toEqual(['group Food']);
        expect(complete(book, 'caf')).toEqual(['Café ← caf', 'Cafe ← caf']);
    });

    it('offers only names the request then reads as themselves', () => {
        const book = new NameIndex([group('Card'), account('Credit Card'), account('Cash')]);
        // "credit Card" reads as Credit Card, the longer name.
        expect(complete(book, 'credit ca')).toEqual(['Credit Card ← credit ca', 'Cash ← ca']);
        expect(complete(book, 'my ca')).toEqual(['Card ← ca', 'Cash ← ca', 'Credit Card ← ca']);
        const even = new NameIndex([account('red car'), account('car fee'), account('Fees')]);
        // "red car fee" reads as red car, which starts first.
        expect(complete(even, 'red car fe')).toEqual(['Fees ← fe']);
    });

    it('inserts the name with its whitespace collapsed, as the Worker reads it exactly', () => {
        const [completion] = new NameIndex([account('  Credit \t Card ')]).complete('cre', 3);
        expect(completion).toEqual({
            name: expect.objectContaining({ name: '  Credit \t Card ' }),
            text: 'Credit Card',
            from: 0,
            to: 3,
        });
    });

    it('never offers names of one character', () => {
        const book = new NameIndex([group('E'), account('Ex'), account('Ｅ')]);
        expect(book.size).toBe(1);
        expect(complete(book, 'ex')).toEqual(['Ex ← ex']);
        expect(complete(book, 'e x')).toEqual([]);
    });

    it('completes names in languages written without spaces and from right to left', () => {
        const book = new NameIndex([group('工资收入'), group('المصروفات'), account('食費')]);
        expect(complete(book, '2015年的工资')).toEqual(['工资收入 ← 工资']);
        expect(complete(book, 'تقرير المص')).toEqual(['المصروفات ← المص']);
        expect(complete(book, '2026年の食費')).toEqual([]);
    });

    it('completes each keystroke well within 50 ms with 25,000 names, all alike', () => {
        const book = new NameIndex(
            Array.from({ length: 25_000 }, (_, n) => account(`Conta corrente ${n}`))
        );
        const request = 'despesas da conta corrente 1234 em 2026';
        const times: number[] = [];
        for (let caret = 1; caret <= request.length; caret++) {
            const started = Date.now();
            book.complete(request.slice(0, caret), caret);
            times.push(Date.now() - started);
        }
        times.sort((a, b) => a - b);
        expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(50);
        expect(complete(book, 'conta corrente 123')).toEqual([
            'Conta corrente 123 ← conta corrente 123',
            'Conta corrente 1230 ← conta corrente 123',
            'Conta corrente 1231 ← conta corrente 123',
            'Conta corrente 1232 ← conta corrente 123',
            'Conta corrente 1233 ← conta corrente 123',
        ]);
    });
});
