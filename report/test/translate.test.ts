import { describe, expect, it } from 'vitest';
import type { GlossaryTerm } from '../scripts/translate/glossary';
import {
    MAX_IN_FLIGHT,
    answerText,
    buildTasks,
    englishLocale,
    localeLoaderModule,
    parseAnswer,
    pendingLanguages,
    recordTexts,
    requestBody,
    retryable,
    runPool,
    sourceHash,
    staticLocalesModule,
    termsIn,
    translationError,
    type Catalog,
    type TargetLanguage,
} from '../scripts/translate/translation';

const GLOSSARY: Record<string, GlossaryTerm> = {
    Book: {
        definition: 'A ledger.',
        forms: ['book', 'books'],
        translations: { pt: 'Livro', ja: '帳簿' },
    },
    Group: { definition: 'A set of Accounts.', forms: ['group'], translations: { pt: 'Grupo' } },
};

const PT: TargetLanguage = { code: 'pt', name: 'Português', english: 'Portuguese', tone: 'você' };
const JA: TargetLanguage = { code: 'ja', name: '日本語', english: 'Japanese', tone: 'です・ます' };
const AR: TargetLanguage = { code: 'ar', name: 'العربية', english: 'Arabic', tone: 'MSA' };

const CATALOG: Catalog = {
    books_back: { text: 'Books', role: 'button', context: 'Goes back to the list of Books.' },
    source_footer: {
        text: 'Computed from the balances of {book}',
        role: 'message',
        context: 'Footer of the report source.',
        placeholders: { book: 'name of the Book, verbatim' },
    },
};

describe('termsIn', () => {
    it('finds glossary terms by whole-word form, ignoring case', () => {
        expect(termsIn('Choose a Book from your books', GLOSSARY)).toEqual(['Book']);
        expect(termsIn('Bookkeeping groups', GLOSSARY)).toEqual([]);
        expect(termsIn('Name a group of this Book', GLOSSARY)).toEqual(['Book', 'Group']);
    });

    it('ignores placeholders, which are never translated', () => {
        expect(termsIn('{report} · {book}', GLOSSARY)).toEqual([]);
    });
});

describe('sourceHash', () => {
    const entry = CATALOG.books_back;

    it('is stable for the same source', () => {
        expect(sourceHash(entry, GLOSSARY, PT)).toBe(sourceHash({ ...entry }, GLOSSARY, PT));
    });

    it('changes with the text, role, context, placeholders, tone or glossary word', () => {
        const hash = sourceHash(entry, GLOSSARY, PT);
        expect(sourceHash({ ...entry, text: 'Book list' }, GLOSSARY, PT)).not.toBe(hash);
        expect(sourceHash({ ...entry, role: 'link' }, GLOSSARY, PT)).not.toBe(hash);
        expect(sourceHash({ ...entry, context: 'Other context.' }, GLOSSARY, PT)).not.toBe(hash);
        expect(sourceHash({ ...entry, placeholders: { a: 'b' } }, GLOSSARY, PT)).not.toBe(hash);
        expect(sourceHash(entry, GLOSSARY, { ...PT, tone: 'tu' })).not.toBe(hash);
        const renamed = {
            ...GLOSSARY,
            Book: { ...GLOSSARY.Book, translations: { pt: 'Caderno' } },
        };
        expect(sourceHash(entry, renamed, PT)).not.toBe(hash);
    });

    it('ignores glossary words of other languages', () => {
        const other = { ...GLOSSARY, Book: { ...GLOSSARY.Book, translations: { pt: 'Livro' } } };
        expect(sourceHash(CATALOG.books_back, other, PT)).toBe(
            sourceHash(CATALOG.books_back, GLOSSARY, PT)
        );
    });
});

describe('pendingLanguages', () => {
    it('is the languages whose text is missing, blank or translated from another source', () => {
        const entry = CATALOG.books_back;
        const locales = { pt: { books_back: 'Livros' }, ja: { books_back: ' ' }, ar: {} };
        const sources = {
            pt: { books_back: sourceHash(entry, GLOSSARY, PT) },
            ja: { books_back: sourceHash(entry, GLOSSARY, JA) },
        };
        expect(
            pendingLanguages('books_back', entry, locales, sources, [PT, JA, AR], GLOSSARY)
        ).toEqual([JA, AR]);
        const stale = { ...sources, pt: { books_back: 'old' } };
        expect(
            pendingLanguages('books_back', entry, locales, stale, [PT], GLOSSARY).map(l => l.code)
        ).toEqual(['pt']);
    });
});

describe('recordTexts', () => {
    const footer = CATALOG.source_footer;

    it('records the source hash of every pending text that passes the checks, trimmed', () => {
        const locales = {
            pt: { books_back: ' Livros ', source_footer: 'Calculado dos saldos de {book}' },
            ja: { books_back: '帳簿', source_footer: '{book}の残高から計算' },
        };
        const sources = { ja: { books_back: sourceHash(CATALOG.books_back, GLOSSARY, JA) } };
        const result = recordTexts(
            CATALOG,
            Object.keys(CATALOG),
            locales,
            sources,
            [PT, JA],
            GLOSSARY
        );
        expect(result.problems).toEqual([]);
        expect(result.recorded).toEqual([
            {
                key: 'books_back',
                code: 'pt',
                text: 'Livros',
                hash: sourceHash(CATALOG.books_back, GLOSSARY, PT),
            },
            {
                key: 'source_footer',
                code: 'pt',
                text: 'Calculado dos saldos de {book}',
                hash: sourceHash(footer, GLOSSARY, PT),
            },
            {
                key: 'source_footer',
                code: 'ja',
                text: '{book}の残高から計算',
                hash: sourceHash(footer, GLOSSARY, JA),
            },
        ]);
    });

    it('fails every selected text that is missing or invalid, even one already recorded', () => {
        const locales = {
            pt: { books_back: 'Livros', source_footer: 'Calculado dos saldos de {livro}' },
            ja: { source_footer: ' ' },
        };
        const sources = { pt: { source_footer: sourceHash(footer, GLOSSARY, PT) } };
        const result = recordTexts(
            CATALOG,
            Object.keys(CATALOG),
            locales,
            sources,
            [PT, JA],
            GLOSSARY
        );
        expect(result.problems).toEqual([
            'source_footer/pt: placeholders differ from the English',
            'books_back/ja: missing',
            'source_footer/ja: empty',
        ]);
    });

    it('checks only the selected keys and languages', () => {
        const locales = { pt: { books_back: 'Livros' }, ja: {} };
        const result = recordTexts(CATALOG, ['books_back'], locales, {}, [PT], GLOSSARY);
        expect(result.problems).toEqual([]);
        expect(result.recorded.map(text => `${text.key}/${text.code}`)).toEqual(['books_back/pt']);
    });
});

describe('buildTasks', () => {
    it('makes one task per key and batch of languages, with the glossary words of its languages', () => {
        const tasks = buildTasks(
            CATALOG,
            [
                { key: 'books_back', languages: [PT, JA, AR] },
                { key: 'source_footer', languages: [JA] },
            ],
            GLOSSARY,
            2
        );
        expect(tasks.map(task => [task.key, task.languages.map(l => l.code)])).toEqual([
            ['books_back', ['pt', 'ja']],
            ['books_back', ['ar']],
            ['source_footer', ['ja']],
        ]);
        expect(tasks[0]).toMatchObject({
            text: 'Books',
            role: 'button',
            terms: [{ term: 'Book', translations: { pt: 'Livro', ja: '帳簿' } }],
        });
        expect(tasks[1].terms).toEqual([
            { term: 'Book', definition: 'A ledger.', translations: {} },
        ]);
        expect(tasks[2].placeholders).toEqual({ book: 'name of the Book, verbatim' });
    });
});

describe('requestBody', () => {
    it('asks for a strict JSON object with every language of the task', () => {
        const [task] = buildTasks(
            CATALOG,
            [{ key: 'books_back', languages: [PT, JA] }],
            GLOSSARY,
            10
        );
        const body = requestBody(task, 'claude-sonnet', 'Translate.');
        expect(body).toMatchObject({
            model: 'claude-sonnet',
            store: false,
            text: {
                format: {
                    type: 'json_schema',
                    strict: true,
                    schema: {
                        type: 'object',
                        required: ['pt', 'ja'],
                        additionalProperties: false,
                        properties: { pt: { type: 'string' }, ja: { type: 'string' } },
                    },
                },
            },
        });
        expect(body.input[0]).toEqual({ role: 'system', content: 'Translate.' });
        expect(JSON.parse(body.input[1].content)).toMatchObject({ key: 'books_back' });
    });
});

describe('answerText', () => {
    it('reads the output text of a response', () => {
        const response = {
            output: [
                { type: 'reasoning', content: [] },
                { type: 'message', content: [{ type: 'output_text', text: '{"pt":"Livros"}' }] },
            ],
        };
        expect(answerText(response)).toBe('{"pt":"Livros"}');
        expect(answerText({ output: [] })).toBeUndefined();
        expect(answerText(null)).toBeUndefined();
    });
});

describe('translationError', () => {
    it('accepts a translation that keeps every placeholder, wherever it is', () => {
        expect(translationError('Q{quarter} {year}', '{year}年第{quarter}四半期')).toBeUndefined();
    });

    it('rejects changed, missing or extra placeholders', () => {
        expect(translationError('In {year}', 'Em {ano}')).toMatch(/placeholders/);
        expect(translationError('In {year}', 'Em')).toMatch(/placeholders/);
        expect(translationError('In {year}', 'Em {year} {year}')).toMatch(/placeholders/);
    });

    it('rejects empty values, quotes around the text, line breaks and explanations', () => {
        expect(translationError('Books', ' ')).toMatch(/empty/);
        expect(translationError('Books', '"Livros"')).toMatch(/quote/);
        expect(translationError('Books', '«Livros»')).toMatch(/quote/);
        expect(translationError('Open in Report', 'Открыть в «Отчёте»')).toBeUndefined();
        expect(translationError('Books', 'Livros\n(plural)')).toMatch(/line break/);
        expect(
            translationError('Books', `Livros — ${'a translation of Books, '.repeat(3)}`)
        ).toMatch(/long/);
    });

    it('rejects a translation without the product name', () => {
        expect(translationError('Open in Bkper', 'Abrir no Bkpr')).toMatch(/Bkper/);
    });
});

describe('parseAnswer', () => {
    const [task] = buildTasks(
        CATALOG,
        [{ key: 'source_footer', languages: [PT, JA, AR] }],
        GLOSSARY,
        10
    );

    it('keeps valid translations, trimmed, and rejects the others with the reason', () => {
        const answer = JSON.stringify({
            pt: ' Calculado a partir dos saldos de {book} ',
            ja: '{book}の残高から計算',
            ar: 'محسوب من أرصدة',
            de: 'Berechnet aus {book}',
        });
        const result = parseAnswer(answer, task);
        expect(result.translations).toEqual({
            pt: 'Calculado a partir dos saldos de {book}',
            ja: '{book}の残高から計算',
        });
        expect(Object.keys(result.rejected)).toEqual(['ar']);
    });

    it('rejects every language of an answer that is not a JSON object', () => {
        expect(parseAnswer('Here you go', task)).toEqual({
            translations: {},
            rejected: { pt: 'no JSON object', ja: 'no JSON object', ar: 'no JSON object' },
        });
    });
});

describe('retryable', () => {
    it('retries throttling, overload and provider failures, never allowance or request errors', () => {
        expect(retryable(429, 'provider_rate_limited')).toBe(true);
        expect(retryable(503, 'provider_overloaded')).toBe(true);
        expect(retryable(502, 'provider_error')).toBe(true);
        expect(retryable(429, 'usage_limit_exceeded')).toBe(false);
        expect(retryable(400, 'invalid_request')).toBe(false);
        expect(retryable(401, 'unauthorized')).toBe(false);
    });
});

describe('runPool', () => {
    it('runs every item with at most the limit in flight', async () => {
        let inFlight = 0;
        let most = 0;
        const done: number[] = [];
        await runPool([1, 2, 3, 4, 5, 6, 7], 3, async item => {
            inFlight++;
            most = Math.max(most, inFlight);
            await new Promise(resolve => setTimeout(resolve, 5));
            inFlight--;
            done.push(item);
        });
        expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(most).toBe(3);
    });

    it(`refuses more than ${MAX_IN_FLIGHT} in flight`, async () => {
        await expect(runPool([1], MAX_IN_FLIGHT + 1, async () => undefined)).rejects.toThrow();
    });
});

describe('englishLocale', () => {
    it('is the catalog text of every key, sorted by key', () => {
        expect(Object.entries(englishLocale(CATALOG))).toEqual([
            ['books_back', 'Books'],
            ['source_footer', 'Computed from the balances of {book}'],
        ]);
    });
});

describe('locale modules', () => {
    it('import every language statically for the server', () => {
        const source = staticLocalesModule(['ar', 'zh-CN']);
        expect(source).toContain("import ar from '../locales/ar.json';");
        expect(source).toContain("import zhCN from '../locales/zh-CN.json';");
        expect(source).toContain("'zh-CN': zhCN,");
    });

    it('import each language on its own for the client', () => {
        const source = localeLoaderModule(['ar', 'zh-CN']);
        expect(source).toContain("ar: () => import('../locales/ar.json'),");
        expect(source).toContain("'zh-CN': () => import('../locales/zh-CN.json'),");
    });
});
