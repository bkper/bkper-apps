/**
 * Evaluates how requests' periods are read, against the real decision model.
 *
 *     npx tsx scripts/eval-periods/run.ts [--mode=list] [--only=<n>,...] [--category=<c>,...]
 *         [--language=<code>,...] [--concurrency=4] [--out=<file.json>]
 *     npx tsx scripts/eval-periods/run.ts --compare=<a.json>,<b.json>
 *
 * Each case of `cases.ts` is a request, the today it is asked on and the period a person means.
 * The mode (`modes.ts`) reads its period; scoring (`score.ts`) builds the queries of the expected
 * and of the read parts and compares the months they read. It prints accuracy per part, per
 * whole request, per category and per language, consistency across paraphrases, latency and
 * input tokens, and every miss, and writes the run to a JSON file in `/tmp` that `--compare`
 * sets beside another.
 *
 * Snapshots are read once, read-only, with your `bkper auth token`; each request is asked with
 * the snapshot's `today` replaced by the case's. Model calls use `BKPER_AI_TOKEN` when set,
 * else the same token, labelled `bkper-ai-source: report-eval-periods`. Bkper AI caches
 * identical requests for 15 minutes, so a rerun within them measures the cache, not latency.
 * Tune the questions, never the expected answers.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Bkper } from 'bkper-js';
import { BkperAiError, createDecisionClient } from '../../server/src/services/decision-client.ts';
import type { Snapshot } from '../../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../../server/src/services/timing.ts';
import { BOOKS, CASES, caseKey, expectations, type BookKey, type PeriodCase } from './cases.ts';
import { MODES, type PeriodAsk, type PeriodMode, type PeriodReading } from './modes.ts';
import {
    PARTS,
    compareRuns,
    describeMeaning,
    meaningOf,
    percent,
    scoreCase,
    summarize,
    type CaseResult,
    type Percentiles,
    type RunFile,
    type Summary,
    type Tally,
} from './score.ts';

const ATTEMPTS = 4;

class MemoryStore implements SnapshotStore {
    private readonly values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async put(key: string, value: string) {
        this.values.set(key, value);
    }
}

function option(name: string): string | undefined {
    const prefix = `--${name}=`;
    return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function list(name: string): string[] {
    return (option(name) ?? '').split(',').filter(Boolean);
}

/** Bkper AI failures worth asking again: its server, a timeout or the connection. */
function transient(error: unknown): boolean {
    return (
        error instanceof BkperAiError &&
        (error.status >= 500 || (error.status === 429 && error.code !== 'usage_limit_exceeded'))
    );
}

async function readWithRetries(mode: PeriodMode, ask: PeriodAsk): Promise<PeriodReading> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await mode(ask);
        } catch (error) {
            if (attempt >= ATTEMPTS || !transient(error)) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
        }
    }
}

async function evaluate(
    test: PeriodCase,
    number: number,
    mode: PeriodMode,
    snapshot: Snapshot,
    client: PeriodAsk['client']
): Promise<{ result: CaseResult; model?: string }> {
    const expected = expectations(test).map(request =>
        meaningOf({ request }, test.today, test.nature)
    );
    const base = {
        number,
        key: caseKey(test),
        prompt: test.prompt,
        language: test.language,
        category: test.category,
        today: test.today,
        ...(test.group === undefined ? {} : { group: test.group }),
    };
    try {
        const reading = await readWithRetries(mode, {
            prompt: test.prompt,
            snapshot,
            today: test.today,
            client,
        });
        const actual = meaningOf(reading.answer, test.today, test.nature);
        const { against, ...score } = scoreCase(expected, actual);
        return {
            result: {
                ...base,
                expected: against,
                answer: reading.answer,
                actual,
                score,
                judgments: reading.judgments,
                latencyMs: Math.round(reading.latencyMs),
                ...(reading.inputTokens === undefined ? {} : { inputTokens: reading.inputTokens }),
                requestCharacters: reading.requestCharacters,
            },
            model: reading.model,
        };
    } catch (error) {
        const actual = { reason: 'mode_error' as const };
        const { against, ...score } = scoreCase(expected, actual);
        return {
            result: {
                ...base,
                expected: against,
                actual,
                score,
                judgments: {},
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
}

/** Runs `work` over `items` with at most `limit` at once, keeping their order. */
async function pool<T, R>(
    items: readonly T[],
    limit: number,
    work: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await work(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

function printMiss(result: CaseResult): void {
    const wrong = Object.entries(result.score.parts)
        .filter(([, ok]) => !ok)
        .map(([part]) => part);
    const judgments = Object.entries(result.judgments)
        .map(([name, value]) => `${name}=${value}`)
        .join(' ');
    console.log(
        `MISS #${result.number} [${result.category}, ${result.language}, ${result.today}] "${result.prompt}"` +
            `\n       expected ${describeMeaning(result.expected)}` +
            `\n       read     ${describeMeaning(result.actual)}` +
            (wrong.length > 0 ? `\n       wrong: ${wrong.join(', ')}` : '') +
            (judgments ? `\n       ${judgments}` : '') +
            (result.error ? `\n       error: ${result.error}` : '')
    );
}

function line(name: string, value: Tally | undefined): string {
    return `${name.padEnd(22)} ${percent(value)}`;
}

function stats(name: string, value: Percentiles | undefined, unit: string): string {
    return value
        ? `${name.padEnd(22)} p50 ${value.p50}${unit}, p95 ${value.p95}${unit}, max ${value.max}${unit}`
        : `${name.padEnd(22)} -`;
}

function printSummary(summary: Summary): void {
    console.log(`\n${summary.cases} requests, ${summary.errors} errors`);
    console.log(line('whole request', summary.whole));
    console.log(line('period', summary.period));
    for (const part of PARTS) {
        console.log(line(`part ${part}`, summary.parts[part]));
    }
    console.log('\nBy category (whole request):');
    for (const [category, value] of Object.entries(summary.byCategory)) {
        console.log(line(`  ${category}`, value));
    }
    console.log('\nBy language (whole request):');
    const languages = Object.entries(summary.byLanguage).sort((a, b) => b[1].total - a[1].total);
    for (const [language, value] of languages) {
        console.log(line(`  ${language}`, value));
    }
    const { consistency } = summary;
    console.log(
        `\n${line('consistency', { hits: consistency.consistent, total: consistency.groups })} of paraphrase groups read alike`
    );
    for (const { group, members } of consistency.disagreeing) {
        console.log(`  ${group}:`);
        for (const member of members) {
            console.log(`    ${member.reads.padEnd(44)} "${member.prompt}"`);
        }
    }
    console.log('');
    console.log(stats('latency', summary.latencyMs, ' ms'));
    console.log(stats('input tokens', summary.inputTokens, ''));
    console.log(stats('request characters', summary.requestCharacters, ''));
}

function printComparison(aPath: string, bPath: string): void {
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as RunFile;
    const a = read(aPath);
    const b = read(bPath);
    const { rows, better, worse } = compareRuns(a, b);
    console.log(`A: ${a.mode} ${a.startedAt} (${aPath})\nB: ${b.mode} ${b.startedAt} (${bPath})\n`);
    console.log(`${''.padEnd(32)} ${'A'.padEnd(20)} B`);
    for (const row of rows) {
        console.log(`${row.name.padEnd(32)} ${percent(row.a).padEnd(20)} ${percent(row.b)}`);
    }
    const show = (title: string, results: CaseResult[]) => {
        console.log(`\n${title}: ${results.length}`);
        for (const result of results) {
            console.log(
                `  #${result.number} [${result.category}, ${result.today}] "${result.prompt}" → ${describeMeaning(result.actual)}`
            );
        }
    };
    show('Better in B', better);
    show('Worse in B', worse);
}

async function main(): Promise<void> {
    const compare = list('compare');
    if (compare.length > 0) {
        if (compare.length !== 2) {
            throw new Error('--compare needs two run files: --compare=<a.json>,<b.json>');
        }
        printComparison(compare[0], compare[1]);
        return;
    }
    const modeName = option('mode') ?? 'list';
    const mode = MODES[modeName];
    if (!mode) {
        throw new Error(`Unknown mode ${modeName}; modes: ${Object.keys(MODES).join(', ')}`);
    }
    const only = list('only').map(Number);
    const categories = list('category');
    const languages = list('language');
    const concurrency = Number(option('concurrency') ?? 4);
    const selected = CASES.map((test, index) => ({ test, number: index + 1 })).filter(
        ({ test, number }) =>
            (only.length === 0 || only.includes(number)) &&
            (categories.length === 0 || categories.includes(test.category)) &&
            (languages.length === 0 || languages.includes(test.language))
    );

    const bkperToken = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => bkperToken });
    const kv = new MemoryStore();
    const userId = await currentUserId(bkper, new ServerTiming());
    const snapshots = {} as Record<BookKey, Snapshot>;
    for (const key of Object.keys(BOOKS) as BookKey[]) {
        snapshots[key] = await loadSnapshot(BOOKS[key], {
            userId,
            bkper,
            kv,
            timing: new ServerTiming(),
        });
    }
    const client = createDecisionClient({
        apiKey: process.env.BKPER_AI_TOKEN || bkperToken,
        headers: { 'bkper-ai-source': 'report-eval-periods' },
    });

    const startedAt = new Date().toISOString();
    let done = 0;
    const evaluated = await pool(selected, concurrency, async ({ test, number }) => {
        const result = await evaluate(test, number, mode, snapshots[test.book], client);
        done++;
        if (done % 25 === 0 || done === selected.length) {
            console.error(`${done}/${selected.length}`);
        }
        return result;
    });
    const models = [...new Set(evaluated.flatMap(({ model }) => (model ? [model] : [])))];
    const results = evaluated.map(({ result }) => result);
    for (const result of results) {
        if (!result.score.whole) {
            printMiss(result);
        }
    }
    const summary = summarize(results);
    console.log(`\nMode: ${modeName}; model: ${models.join(', ') || '-'}`);
    printSummary(summary);
    const out =
        option('out') ??
        `/tmp/report-eval-periods-${modeName}-${startedAt.replace(/[:.]/g, '-')}.json`;
    const file: RunFile = { mode: modeName, models, startedAt, results, summary };
    writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`\nWrote ${out}`);
}

await main();
