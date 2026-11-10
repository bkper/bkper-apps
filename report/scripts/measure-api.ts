/**
 * Measures the report API of a running Report app from its `Server-Timing` header, read-only.
 *
 *     npx tsx scripts/measure-api.ts [--base=<url>] [--runs=<n>] [--cold=<n>] [--hashtag=<tag>] <bookId>...
 *     npx tsx scripts/measure-api.ts --flow [--base=<url>] [--cold=<n>] [--runs=<n>] [--offset=<n>] <bookId>...
 *
 * `--base` is the app (default the local `bkper app dev` Worker, `http://localhost:8809`). For
 * each Book it asks for the suggestions, then times three paths, `--runs` times each (default
 * 10): a report by each suggestion's text (no AI), by a prompt (one Jev decision, then the
 * report's balances queries), and by a prompt with `#<hashtag>` (default `trip`). Prompts name a
 * root group with a period, so each run reads balances of other periods: the app caches each
 * exact query for 60 seconds, so a suggestion asked again within it reads none. Prompts are each
 * sent once: Bkper AI caches identical requests for 15 minutes, so a rerun within that time
 * measures the cache.
 *
 * Samples are `cold` when the snapshot (the Book's map, also cached for 60 seconds) had expired
 * and was loaded from Bkper (`book` in `Server-Timing`), `warm` when it was cached and the
 * report's balances were read from Bkper (`balances`), and `cached` when they were too. With
 * `--cold`, it then waits for the caches to expire before each of that many rounds, alternating
 * the suggestion and prompt paths. Uses your `bkper auth token`; the app never
 * writes to a Book.
 *
 * `--flow` measures instead what a person experiences (`measure-api/flow.ts`): opening each Book
 * as the web client does, `--cold` times (default 2) after its caches expired, each followed by
 * `--runs` warm opens (default 2), each open followed by two typed prompts, one naming a group or
 * account of the Book and one naming none. `--offset` shifts the prompts chosen, for a rerun
 * within Bkper AI's 15-minute cache.
 */
import { execFileSync } from 'node:child_process';
import { measureFlow } from './measure-api/flow';
import { percentile, readTiming } from './measure-api/timing';

type Path = 'suggestions' | 'suggestion' | 'prompt' | 'hashtag';

/** The caches a request found: none, the snapshot only, or the snapshot and every balance. */
type Cache = 'cold' | 'warm' | 'cached';

interface Sample {
    path: Path;
    cache: Cache;
    status: number;
    /** Milliseconds by `Server-Timing` metric. */
    metrics: Record<string, number>;
}

/** A little longer than the app caches a snapshot and balances (60 s), to be sure they expired. */
const SNAPSHOT_EXPIRY_MS = 65_000;

/** The periods prompts name, after a root group's name. */
const PROMPT_PERIODS = [
    'last month',
    'this year',
    'last quarter',
    'last year',
    'this month',
    'year to date',
    'by month in the last 12 months',
    'this quarter',
    'today',
    'all time',
];

function option(name: string, fallback: string): string {
    const prefix = `--${name}=`;
    return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
    const flow = process.argv.includes('--flow');
    const base = option('base', 'http://localhost:8809');
    const runs = Number(option('runs', flow ? '2' : '10'));
    const coldRounds = Number(option('cold', flow ? '2' : '0'));
    const hashtag = option('hashtag', 'trip');
    const books = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
    if (books.length === 0) {
        throw new Error(
            'Usage: npx tsx scripts/measure-api.ts [--flow] [--base=<url>] [--runs=<n>] [--cold=<n>] [--hashtag=<tag>] [--offset=<n>] <bookId>...'
        );
    }
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    if (flow) {
        const offset = Number(option('offset', '0'));
        await measureFlow({ base, token, books, cold: coldRounds, warm: runs, offset });
        return;
    }
    const roots = new Map(
        books.map(book => {
            const { items } = JSON.parse(
                execFileSync('bkper', ['group', 'list', '-b', book], { encoding: 'utf8' })
            ) as { items: { name: string; parent?: unknown }[] };
            return [book, items.filter(group => !group.parent).map(group => group.name)];
        })
    );
    const samples: Sample[] = [];

    async function call(path: Path, book: string, body?: unknown): Promise<unknown> {
        const url = `${base}/api/v1/books/${book}/${path === 'suggestions' ? 'suggestions' : 'report'}`;
        const response = await fetch(url, {
            method: body ? 'POST' : 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const metrics = readTiming(response.headers.get('Server-Timing'));
        // `book` is the snapshot loaded from Bkper, `balances` the report's own queries.
        const cold = 'book' in metrics;
        const cache: Cache = cold ? 'cold' : 'balances' in metrics ? 'warm' : 'cached';
        samples.push({ path, cache, status: response.status, metrics });
        const json: unknown = await response.json();
        if (!response.ok) {
            console.log(`${path} ${response.status} ${JSON.stringify(json)}`);
        }
        return json;
    }

    const suggestions = new Map<string, string[]>();
    for (const book of books) {
        const body = (await call('suggestions', book)) as { suggestions?: string[] };
        suggestions.set(book, body.suggestions ?? []);
        console.log(`${book}: ${(body.suggestions ?? []).join(' | ')}`);
    }
    const prompts = (book: string, round: number, suffix = '') => {
        const names = roots.get(book) ?? [];
        const root = names[round % names.length] ?? 'expenses';
        const period = PROMPT_PERIODS[Math.floor(round / names.length) % PROMPT_PERIODS.length];
        return `${root} ${period}${suffix}`;
    };
    for (const book of books) {
        const list = suggestions.get(book) ?? [];
        for (let run = 0; run < runs; run++) {
            for (const suggestion of list) {
                await call('suggestion', book, { prompt: suggestion });
            }
            await call('prompt', book, { prompt: prompts(book, run) });
            await call('hashtag', book, { prompt: prompts(book, run, ` #${hashtag}`) });
        }
    }

    for (let round = 0; round < coldRounds; round++) {
        console.log(`Waiting ${SNAPSHOT_EXPIRY_MS / 1000}s for the snapshot cache to expire…`);
        await sleep(SNAPSHOT_EXPIRY_MS);
        await Promise.all(
            books.map((book, index) => {
                const list = suggestions.get(book) ?? [];
                return (round + index) % 2 === 0 && list.length > 0
                    ? call('suggestion', book, { prompt: list[round % list.length] })
                    : call('prompt', book, { prompt: prompts(book, runs + round, ' (cold)') });
            })
        );
    }

    const groups = new Map<string, Sample[]>();
    for (const sample of samples) {
        const key = `${sample.path} ${sample.cache}`;
        groups.set(key, [...(groups.get(key) ?? []), sample]);
    }
    console.log('\npath            n  total p50/p95 ms   metric p50/p95 ms');
    for (const [key, group] of [...groups].sort()) {
        const totals = group.map(sample => sample.metrics.total ?? NaN);
        const names = [...new Set(group.flatMap(sample => Object.keys(sample.metrics)))].filter(
            name => name !== 'total'
        );
        const metrics = names
            .map(name => {
                const values = group.map(s => s.metrics[name] ?? 0);
                return `${name} ${Math.round(percentile(values, 50))}/${Math.round(percentile(values, 95))}`;
            })
            .join(', ');
        const failed = group.filter(sample => sample.status !== 200).length;
        console.log(
            `${key.padEnd(15)} ${String(group.length).padStart(2)}  ` +
                `${Math.round(percentile(totals, 50))} / ${Math.round(percentile(totals, 95))}`.padEnd(
                    17
                ) +
                `  ${metrics}${failed ? `  (${failed} failed)` : ''}`
        );
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
