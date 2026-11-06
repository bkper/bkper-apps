import { describe, expect, it } from 'vitest';
import { judgePlan, shellWords } from '../scripts/agent-docs/plan';

const BOOK = 'abc123';
const REQUEST = 'quanto gastei por mês no ano passado?';

function plan(command: string, publish = ['report.html']) {
    return { commands: [command], publish };
}

describe('shellWords', () => {
    it('splits words with quotes and escapes as a POSIX shell does', () => {
        expect(shellWords(`a 'b c' "d \\"e\\"" f\\ g 'it'\\''s' > out.html`)).toEqual([
            'a',
            'b c',
            'd "e"',
            'f g',
            "it's",
            '>',
            'out.html',
        ]);
    });
});

describe('judgePlan', () => {
    it('passes the report call with the request verbatim, as html, saved and published', () => {
        const body = JSON.stringify({ prompt: REQUEST, format: 'html' });
        const command = `bkper app api request report /api/v1/books/${BOOK}/report -d '${body}' > relatorio.html`;
        expect(judgePlan(plan(command, ['relatorio.html']), BOOK, REQUEST)).toEqual([]);
    });

    it('accepts the output file published by another path to it', () => {
        const command = `bkper app api request report /api/v1/books/${BOOK}/report --data '{"prompt":"${REQUEST}","format":"html"}' >/tmp/r.html`;
        expect(judgePlan(plan(command, ['/tmp/r.html']), BOOK, REQUEST)).toEqual([]);
    });

    it('accepts the request shortened to its own words', () => {
        const request = 'can you make me a chart of revenue vs expenses for 2024?';
        const command = `bkper app api request report /api/v1/books/${BOOK}/report -d '{"prompt":"revenue vs expenses for 2024","format":"html"}' > r.html`;
        expect(judgePlan(plan(command, ['r.html']), BOOK, request)).toEqual([]);
    });

    it('fails without the report call on the Book', () => {
        expect(judgePlan(plan('bkper balance list -b abc123'), BOOK, REQUEST)).toContain(
            'no `bkper app api request report /api/v1/books/abc123/report` command'
        );
    });

    it('fails a body that is not html or rewrites the request', () => {
        const spec = `bkper app api request report /api/v1/books/${BOOK}/report -d '{"prompt":"${REQUEST}"}' > r.html`;
        expect(judgePlan(plan(spec, ['r.html']), BOOK, REQUEST)).toContain(
            'the body asks for format undefined, not html'
        );
        const translated = `bkper app api request report /api/v1/books/${BOOK}/report -d '{"prompt":"expenses by month last year","format":"html"}' > r.html`;
        expect(judgePlan(plan(translated, ['r.html']), BOOK, REQUEST)).toContain(
            'the prompt is not the request in its own words: "expenses by month last year"'
        );
    });

    it('fails when the file is not saved and published', () => {
        const command = `bkper app api request report /api/v1/books/${BOOK}/report -d '{"prompt":"${REQUEST}","format":"html"}'`;
        expect(judgePlan(plan(command, []), BOOK, REQUEST)).toEqual([
            'the response is not saved to an .html file',
            'publishes no .html file',
        ]);
        const saved = `${command} > r.html`;
        expect(judgePlan(plan(saved, ['other.html']), BOOK, REQUEST)).toEqual([
            'does not publish r.html',
        ]);
    });

    it('fails a plan that changes the Book', () => {
        const command = `bkper app api request report /api/v1/books/${BOOK}/report -d '{"prompt":"${REQUEST}","format":"html"}' > r.html`;
        const result = judgePlan(
            { commands: ['bkper transaction create -b abc123 x', command], publish: ['r.html'] },
            BOOK,
            REQUEST
        );
        expect(result).toEqual(['changes the Book: bkper transaction create -b abc123 x']);
    });
});
