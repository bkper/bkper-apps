/**
 * Translates the app's strings (`shared/catalog/en.json`) into every Bkper language with a Bkper
 * AI language model, and writes `shared/locales/{lang}.json` with the modules that load them.
 *
 *     npm run translate -- [--keys=a,b] [--languages=pt,es] [--force] [--dry-run]
 *                          [--model=claude-sonnet] [--batch=44] [--concurrency=8]
 *
 * One call per key and batch of up to `--batch` languages (a strict JSON answer for all 132 at
 * once is more than the model accepts), with the key's text, role, context and placeholders,
 * each language's native name and tone (`translate/tones.ts`), and the Bkper words the text uses
 * (`translate/glossary.ts`); the instructions are `translate/prompt.md`. Every text is checked
 * (`translation.ts`) before it is written. Only texts that are missing or whose source changed
 * are translated (`translate/sources.json`); `--force` translates the selected ones again.
 *
 * Up to `--concurrency` calls (at most 8) run at once; throttled or failed calls and rejected
 * texts are retried. Calls use your `bkper auth token` and are labelled
 * `bkper-ai-source: report-translate`. Every run also writes `shared/locales/en.json` from the
 * catalog and `shared/src/locales.ts` and `shared/src/locale-loader.ts` from the languages.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LANGUAGES } from '../shared/src/languages.ts';
import { GLOSSARY } from './translate/glossary.ts';
import { TONES } from './translate/tones.ts';
import {
    MAX_IN_FLIGHT,
    answerText,
    buildTasks,
    englishLocale,
    localeLoaderModule,
    parseAnswer,
    pendingLanguages,
    requestBody,
    retryable,
    runPool,
    sortedByKey,
    sourceHash,
    staticLocalesModule,
    type Catalog,
    type Locale,
    type Sources,
    type TargetLanguage,
    type TranslateTask,
} from './translate/translation.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = {
    catalog: join(ROOT, 'shared', 'catalog', 'en.json'),
    locales: join(ROOT, 'shared', 'locales'),
    sources: join(ROOT, 'scripts', 'translate', 'sources.json'),
    prompt: join(ROOT, 'scripts', 'translate', 'prompt.md'),
    staticModule: join(ROOT, 'shared', 'src', 'locales.ts'),
    loaderModule: join(ROOT, 'shared', 'src', 'locale-loader.ts'),
};
const ENDPOINT = 'https://ai.bkper.app/v1/responses';
const SOURCE_HEADER = 'report-translate';
const ATTEMPTS = 3;
const TIMEOUT_MS = 240_000;

const { values: args } = parseArgs({
    options: {
        keys: { type: 'string' },
        languages: { type: 'string' },
        force: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        model: { type: 'string', default: 'claude-sonnet' },
        batch: { type: 'string', default: '44' },
        concurrency: { type: 'string', default: String(MAX_IN_FLIGHT) },
    },
});

const catalog = readJson<Catalog>(PATHS.catalog);
const instructions = readFileSync(PATHS.prompt, 'utf8');
const targets: TargetLanguage[] = LANGUAGES.filter(language => language.code !== 'en').map(
    language => {
        const tone = TONES[language.code];
        if (!tone) throw new Error(`No tone for ${language.code} in translate/tones.ts`);
        return { ...language, tone };
    }
);
const keys = selected(args.keys, Object.keys(catalog), 'key');
const chosenCodes = selected(
    args.languages,
    targets.map(target => target.code),
    'language'
);
const languages = targets.filter(language => chosenCodes.includes(language.code));

// The catalog decides which keys exist: texts of removed keys go.
const locales: Record<string, Locale> = {};
const allSources: Record<string, Sources> = existsSync(PATHS.sources)
    ? readJson<Record<string, Sources>>(PATHS.sources)
    : {};
for (const { code } of targets) {
    const file = localePath(code);
    locales[code] = onlyCatalogKeys(existsSync(file) ? readJson<Locale>(file) : {});
    allSources[code] = onlyCatalogKeys(allSources[code] ?? {});
}
writeJson(localePath('en'), englishLocale(catalog));
const codes = targets.map(target => target.code);
writeFileSync(PATHS.staticModule, staticLocalesModule(codes));
writeFileSync(PATHS.loaderModule, localeLoaderModule(codes));
saveAll();

const pending = keys
    .map(key => ({
        key,
        languages: args.force
            ? languages
            : pendingLanguages(key, catalog[key], locales, allSources, languages, GLOSSARY),
    }))
    .filter(entry => entry.languages.length > 0);
const tasks = buildTasks(catalog, pending, GLOSSARY, positive(args.batch, 'batch'));
const texts = pending.reduce((sum, entry) => sum + entry.languages.length, 0);
console.log(`${texts} texts to translate: ${pending.length} keys, ${tasks.length} calls.`);
if (args['dry-run'] || tasks.length === 0) process.exit(0);

let token = bkperToken();
let stopped: string | undefined;
let calls = 0;
let failedCalls = 0;
const started = Date.now();

await runPool(tasks, positive(args.concurrency, 'concurrency'), async task => {
    let remaining = task;
    for (let attempt = 1; attempt <= ATTEMPTS && remaining.languages.length > 0; attempt++) {
        if (stopped) return;
        const callStart = Date.now();
        calls++;
        const outcome = await translate(remaining);
        const seconds = ((Date.now() - callStart) / 1000).toFixed(1);
        if ('error' in outcome) {
            failedCalls++;
            console.log(
                `✗ ${task.key} ×${remaining.languages.length} ${seconds}s ${outcome.error}`
            );
            if (!outcome.retry) {
                stopped = outcome.error;
                return;
            }
            await pause(outcome.waitMs ?? 2_000 * 4 ** (attempt - 1));
            continue;
        }
        for (const [code, text] of Object.entries(outcome.translations)) {
            locales[code][task.key] = text;
            const language = remaining.languages.find(candidate => candidate.code === code);
            if (language)
                allSources[code][task.key] = sourceHash(catalog[task.key], GLOSSARY, language);
        }
        saveAll(Object.keys(outcome.translations));
        const rejected = Object.entries(outcome.rejected);
        console.log(
            `✓ ${task.key} ×${Object.keys(outcome.translations).length} ${seconds}s` +
                (rejected.length
                    ? `, rejected ${rejected.map(([c, e]) => `${c} (${e})`).join(', ')}`
                    : '')
        );
        remaining = {
            ...remaining,
            languages: remaining.languages.filter(language => language.code in outcome.rejected),
        };
    }
});

const left = keys.flatMap(key =>
    pendingLanguages(key, catalog[key], locales, allSources, languages, GLOSSARY).map(
        language => `${key}/${language.code}`
    )
);
console.log(
    `${calls} calls (${failedCalls} failed) in ${((Date.now() - started) / 1000).toFixed(0)} s` +
        ` with ${args.model}.` +
        (left.length ? ` Still pending: ${left.join(', ')}.` : ' Nothing pending.')
);
if (stopped) console.error(`Stopped: ${stopped}`);
process.exit(left.length || stopped ? 1 : 0);

type Outcome =
    | { translations: Record<string, string>; rejected: Record<string, string> }
    | { error: string; retry: boolean; waitMs?: number };

async function translate(task: TranslateTask, renewed = false): Promise<Outcome> {
    let response: Response;
    try {
        response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'bkper-ai-source': SOURCE_HEADER,
            },
            body: JSON.stringify(requestBody(task, args.model, instructions)),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (error) {
        return { error: `request failed: ${String(error)}`, retry: true };
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (response.status === 401 && !renewed) {
        token = bkperToken();
        return translate(task, true);
    }
    if (!response.ok) {
        const code = errorCode(body);
        const retryAfter = Number(response.headers.get('retry-after'));
        return {
            error: `${response.status} ${code ?? ''}`.trim(),
            retry: retryable(response.status, code),
            ...(retryAfter > 0 ? { waitMs: retryAfter * 1000 } : {}),
        };
    }
    const text = answerText(body);
    if (text === undefined) return { error: 'no output text', retry: true };
    return parseAnswer(text, task);
}

function errorCode(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
    const error = body.error;
    return typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : undefined;
}

/** Writes the sources and the locales of `changed` languages (all by default). */
function saveAll(changed: string[] = codes): void {
    for (const code of changed) writeJson(localePath(code), sortedByKey(locales[code]));
    writeJson(
        PATHS.sources,
        Object.fromEntries(codes.map(code => [code, sortedByKey(allSources[code])]))
    );
}

function onlyCatalogKeys<T>(values: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(values).filter(([key]) => key in catalog));
}

function selected(list: string | undefined, all: string[], what: string): string[] {
    if (!list) return all;
    const chosen = list.split(',').map(item => item.trim());
    const unknown = chosen.filter(item => !all.includes(item));
    if (unknown.length) throw new Error(`Unknown ${what}: ${unknown.join(', ')}`);
    return chosen;
}

function positive(value: string | undefined, name: string): number {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1)
        throw new Error(`--${name} must be a positive integer`);
    return number;
}

function localePath(code: string): string {
    return join(PATHS.locales, `${code}.json`);
}

function bkperToken(): string {
    return execFileSync('bkper', ['auth', 'token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
}

function pause(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown): void {
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}
