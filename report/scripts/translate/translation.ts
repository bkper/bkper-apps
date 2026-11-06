/**
 * Translation of the catalog's strings, one key at a time, and the checks every text passes
 * before it is written to `shared/locales/{lang}.json`. Pure: the CLI (`scripts/translate.ts`)
 * does the calls and the files.
 *
 * `scripts/translate/sources.json` holds, for each language and key, a hash of what its text
 * was translated from: the English, its role, context and placeholders, the glossary words the
 * text uses in that language, and the language's tone. A text is translated again when it is
 * missing or its source changes, so hand edits to a text survive until then.
 */
import { createHash } from 'node:crypto';
import type { GlossaryTerm } from './glossary.ts';

export interface CatalogEntry {
    text: string;
    role: string;
    context: string;
    placeholders?: Record<string, string>;
}

export type Catalog = Record<string, CatalogEntry>;
export type Glossary = Readonly<Record<string, GlossaryTerm>>;

/** Key → text, as the app reads it. */
export type Locale = Record<string, string>;
/** Key → hash of the source its text was translated from. */
export type Sources = Record<string, string>;

export interface TargetLanguage {
    code: string;
    /** Native name. */
    name: string;
    /** English name, so the model knows exactly which language and script is meant. */
    english: string;
    /** How the interface addresses people in the language. */
    tone: string;
}

export interface TranslateTask {
    key: string;
    text: string;
    role: string;
    context: string;
    placeholders?: Record<string, string>;
    terms: { term: string; definition: string; translations: Record<string, string> }[];
    languages: TargetLanguage[];
}

export interface TranslationResult {
    /** Valid texts by language code. */
    translations: Record<string, string>;
    /** Why each other requested language was rejected; those stay pending. */
    rejected: Record<string, string>;
}

/** More calls at once only trade throttling for speed. */
export const MAX_IN_FLIGHT = 8;

const PRODUCT_NAME = 'Bkper';
const PLACEHOLDER = /\{[^{}]*\}/g;
const QUOTES = new Set([
    '"',
    "'",
    '“',
    '”',
    '„',
    '‘',
    '’',
    '‚',
    '«',
    '»',
    '‹',
    '›',
    '「',
    '」',
    '『',
    '』',
]);

/** Glossary terms a text uses, by whole-word form outside its placeholders, ignoring case; sorted. */
export function termsIn(text: string, glossary: Glossary): string[] {
    const words = text.replace(PLACEHOLDER, ' ');
    return Object.keys(glossary)
        .filter(term => formPattern(glossary[term]).test(words))
        .sort();
}

/** Hash of what a language's text of a catalog entry is translated from. */
export function sourceHash(
    entry: CatalogEntry,
    glossary: Glossary,
    language: TargetLanguage
): string {
    const words = termsIn(entry.text, glossary).map(term => [
        term,
        glossary[term].translations[language.code] ?? null,
    ]);
    const source = [
        entry.text,
        entry.role,
        entry.context,
        entry.placeholders ?? null,
        words,
        language.tone,
    ];
    return createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 12);
}

/** The languages whose text of a key is missing or blank, or was translated from another source. */
export function pendingLanguages(
    key: string,
    entry: CatalogEntry,
    locales: Record<string, Locale>,
    sources: Record<string, Sources>,
    languages: TargetLanguage[],
    glossary: Glossary
): TargetLanguage[] {
    return languages.filter(
        language =>
            !locales[language.code]?.[key]?.trim() ||
            sources[language.code]?.[key] !== sourceHash(entry, glossary, language)
    );
}

/**
 * One task per key and batch of at most `batchSize` of its pending languages: an answer for
 * every language at once would be too large for one structured answer.
 */
export function buildTasks(
    catalog: Catalog,
    pending: { key: string; languages: TargetLanguage[] }[],
    glossary: Glossary,
    batchSize: number
): TranslateTask[] {
    return pending.flatMap(({ key, languages }) =>
        chunks(languages, batchSize).map(batch => buildTask(key, catalog[key], glossary, batch))
    );
}

function buildTask(
    key: string,
    entry: CatalogEntry,
    glossary: Glossary,
    languages: TargetLanguage[]
): TranslateTask {
    const terms = termsIn(entry.text, glossary).map(term => ({
        term,
        definition: glossary[term].definition,
        translations: Object.fromEntries(
            languages
                .filter(language => glossary[term].translations[language.code])
                .map(language => [language.code, glossary[term].translations[language.code]])
        ),
    }));
    return { key, ...entry, terms, languages };
}

/** The Bkper AI `POST /v1/responses` body of a task: one strict JSON object, a text per language. */
export function requestBody(task: TranslateTask, model: string, instructions: string) {
    const codes = task.languages.map(language => language.code);
    return {
        model,
        store: false,
        input: [
            { role: 'system', content: instructions },
            { role: 'user', content: JSON.stringify(task) },
        ],
        text: {
            format: {
                type: 'json_schema',
                name: 'translations',
                strict: true,
                schema: {
                    type: 'object',
                    properties: Object.fromEntries(codes.map(code => [code, { type: 'string' }])),
                    required: codes,
                    additionalProperties: false,
                },
            },
        },
    };
}

/** The assistant's output text of a response resource. */
export function answerText(response: unknown): string | undefined {
    if (!isRecord(response) || !Array.isArray(response.output)) return undefined;
    for (const item of response.output) {
        if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
        for (const part of item.content) {
            if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
                return part.text;
            }
        }
    }
    return undefined;
}

export function parseAnswer(text: string, task: TranslateTask): TranslationResult {
    const codes = task.languages.map(language => language.code);
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        value = undefined;
    }
    if (!isRecord(value)) {
        return {
            translations: {},
            rejected: Object.fromEntries(codes.map(code => [code, 'no JSON object'])),
        };
    }
    const result: TranslationResult = { translations: {}, rejected: {} };
    for (const code of codes) {
        const translated = value[code];
        const error =
            typeof translated === 'string'
                ? translationError(task.text, translated)
                : 'missing from the answer';
        if (error) result.rejected[code] = error;
        else result.translations[code] = String(translated).trim();
    }
    return result;
}

/**
 * What is wrong with a translation of `english`, if anything: an empty value, placeholders
 * other than the English ones, the product name changed, quotes around the whole text, a line
 * break, or a length that only an explanation or alternatives would reach.
 */
export function translationError(english: string, translated: string): string | undefined {
    const text = translated.trim();
    if (!text) return 'empty';
    if (placeholders(english) !== placeholders(text)) return 'placeholders differ from the English';
    if (english.includes(PRODUCT_NAME) && !text.includes(PRODUCT_NAME)) {
        return `"${PRODUCT_NAME}" was changed`;
    }
    if (quoted(text) && !quoted(english)) return 'quotes around the text';
    if (/[\r\n]/.test(text)) return 'line break';
    if ([...text].length > maxLength(english)) return 'too long for the English';
    return undefined;
}

/** The longest a translation of `english` may be, in code points. */
export function maxLength(english: string): number {
    return 3 * [...english].length + 20;
}

/** Status codes and Bkper AI error codes worth another try after a pause. */
export function retryable(status: number, code?: string): boolean {
    if (code === 'usage_limit_exceeded') return false;
    return status === 429 || status >= 500;
}

/** Runs `work` on every item, at most `limit` at once. */
export async function runPool<T>(
    items: readonly T[],
    limit: number,
    work: (item: T) => Promise<void>
): Promise<void> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_IN_FLIGHT) {
        throw new Error(`Concurrency must be from 1 to ${MAX_IN_FLIGHT}`);
    }
    let next = 0;
    const lane = async () => {
        while (next < items.length) await work(items[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** `shared/locales/en.json`: the catalog English, so English reads like every other language. */
export function englishLocale(catalog: Catalog): Locale {
    return sortedByKey(
        Object.fromEntries(Object.entries(catalog).map(([key, entry]) => [key, entry.text]))
    );
}

export function sortedByKey<T>(values: Record<string, T>): Record<string, T> {
    return Object.fromEntries(
        Object.keys(values)
            .sort()
            .map(key => [key, values[key]])
    );
}

const GENERATED = '// Generated by `npm run translate` (scripts/translate.ts): do not edit.';

/** `shared/src/locales.ts`: every language imported statically, for the Worker. */
export function staticLocalesModule(codes: readonly string[]): string {
    return [
        GENERATED,
        "import { addLocale, type Messages } from './strings';",
        ...codes.map(code => `import ${identifier(code)} from '../locales/${code}.json';`),
        '',
        '/** The strings of every Bkper language but English, which is the catalog itself. */',
        'export const LOCALES: Readonly<Record<string, Messages>> = {',
        ...codes.map(code => `    ${property(code, identifier(code))},`),
        '};',
        '',
        '/** Makes the strings of every language available to `t`. */',
        'export function addAllLocales(): void {',
        '    for (const [lang, messages] of Object.entries(LOCALES)) {',
        '        addLocale(lang, messages);',
        '    }',
        '}',
        '',
    ].join('\n');
}

/** `shared/src/locale-loader.ts`: each language in a chunk of its own, for the browser. */
export function localeLoaderModule(codes: readonly string[]): string {
    return [
        GENERATED,
        "import { addLocale, type Messages } from './strings';",
        '',
        'const LOADERS: Readonly<Record<string, () => Promise<{ default: Messages }>>> = {',
        ...codes.map(code => `    ${propertyKey(code)}: () => import('../locales/${code}.json'),`),
        '};',
        '',
        '/**',
        ' * Loads the strings of one Bkper language, a code of `LANGUAGES`, and makes them available',
        ' * to `t`. English is the catalog itself, so it, like any other code, loads nothing.',
        ' */',
        'export async function loadLocale(lang: string): Promise<void> {',
        '    const load = LOADERS[lang];',
        '    if (load) {',
        '        addLocale(lang, (await load()).default);',
        '    }',
        '}',
        '',
    ].join('\n');
}

function identifier(code: string): string {
    return code.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
}

function propertyKey(code: string): string {
    return /^[a-z]+$/i.test(code) ? code : `'${code}'`;
}

function property(code: string, name: string): string {
    return code === name ? code : `${propertyKey(code)}: ${name}`;
}

/** Starts and ends with quotes; a quoted name inside a sentence may end it, as in Russian. */
function quoted(text: string): boolean {
    const characters = [...text];
    return QUOTES.has(characters[0]) && QUOTES.has(characters.at(-1) ?? '');
}

function placeholders(text: string): string {
    return [...text.matchAll(PLACEHOLDER)]
        .map(match => match[0])
        .sort()
        .join(' ');
}

function formPattern(term: GlossaryTerm): RegExp {
    const forms = term.forms.map(form => form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`\\b(${forms.join('|')})\\b`, 'i');
}

function chunks<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
