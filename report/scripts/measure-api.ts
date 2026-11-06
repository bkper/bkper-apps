/**
 * Measures the report API of a running Report app from its `Server-Timing` header, read-only.
 *
 *     npx tsx scripts/measure-api.ts [--base=<url>] [--runs=<n>] [--cold=<n>] [--hashtag=<tag>] <bookId>...
 *
 * `--base` is the app (default the local `bkper app dev` Worker, `http://localhost:8809`). For
 * each Book it asks for the suggestions, then times three paths, `--runs` times each (default 10):
 * a report by each suggestion's intent (no AI), by a prompt (one Jev decision), and by a prompt
 * with `#<hashtag>` (default `trip`; one live balances query in parallel with Jev). Prompts are
 * variations of the suggestion texts, each sent once: Bkper AI caches identical requests for
 * 15 minutes, so a rerun within that time measures the cache. With `--cold`, it then waits for
 * the snapshot cache to expire before each of that many rounds, alternating the intent and
 * prompt paths. Uses your `bkper auth token`; the app never writes to a Book.
 */
import { execFileSync } from 'node:child_process';

interface Suggestion {
    text: string;
    intent: unknown;
}

type Path = 'suggestions' | 'intent' | 'prompt' | 'hashtag';

interface Sample {
    path: Path;
    cold: boolean;
    status: number;
    /** Milliseconds by `Server-Timing` metric. */
    metrics: Record<string, number>;
}

/** How long the app caches a snapshot, and a little longer, to be sure it expired. */
const SNAPSHOT_TTL_MS = 60_000;
const SNAPSHOT_EXPIRY_MS = 65_000;

const PROMPT_VARIANTS = [
    (text: string) => text,
    (text: string) => `show ${text}`,
    (text: string) => `${text}?`,
    (text: string) => `report: ${text}`,
    (text: string) => `${text} please`,
    (text: string) => `I need ${text}`,
    (text: string) => `${text}, thanks`,
];

function option(name: string, fallback: string): string {
    const prefix = `--${name}=`;
    return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function readTiming(header: string | null): Record<string, number> {
    const metrics: Record<string, number> = {};
    for (const entry of (header ?? '').split(',')) {
        const [name, ...params] = entry.trim().split(';');
        const duration = params
            .map(param => /^dur=([\d.]+)$/.exec(param.trim())?.[1])
            .find(Boolean);
        if (name && duration) {
            metrics[name] = Number(duration);
        }
    }
    return metrics;
}

function percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
    const base = option('base', 'http://localhost:8809');
    const runs = Number(option('runs', '10'));
    const coldRounds = Number(option('cold', '0'));
    const hashtag = option('hashtag', 'trip');
    const books = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
    if (books.length === 0) {
        throw new Error(
            'Usage: npx tsx scripts/measure-api.ts [--base=<url>] [--runs=<n>] [--cold=<n>] [--hashtag=<tag>] <bookId>...'
        );
    }
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const samples: Sample[] = [];
    const loadedAt = new Map<string, number>();

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
        // Outside the hashtag path, `balances` is only measured when the snapshot is read from
        // Bkper. The hashtag path always reads balances live, so it is cold when the cached
        // snapshot has expired since this script last saw it loaded.
        const cold =
            path === 'hashtag'
                ? Date.now() - (loadedAt.get(book) ?? 0) > SNAPSHOT_TTL_MS
                : 'balances' in metrics;
        if (cold) {
            loadedAt.set(book, Date.now());
        }
        samples.push({ path, cold, status: response.status, metrics });
        const json: unknown = await response.json();
        if (!response.ok) {
            console.log(`${path} ${response.status} ${JSON.stringify(json)}`);
        }
        return json;
    }

    const suggestions = new Map<string, Suggestion[]>();
    for (const book of books) {
        const body = (await call('suggestions', book)) as { suggestions?: Suggestion[] };
        suggestions.set(book, body.suggestions ?? []);
        console.log(`${book}: ${(body.suggestions ?? []).map(s => s.text).join(' | ')}`);
    }
    const prompts = (book: string, round: number, suffix = '') => {
        const list = suggestions.get(book) ?? [];
        const text = list[round % list.length]?.text ?? 'expenses';
        const variant = PROMPT_VARIANTS[Math.floor(round / list.length) % PROMPT_VARIANTS.length];
        return `${variant(text)}${suffix}`;
    };

    for (const book of books) {
        const list = suggestions.get(book) ?? [];
        for (let run = 0; run < runs; run++) {
            for (const { intent } of list) {
                await call('intent', book, { intent });
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
                return (round + index) % 2 === 0
                    ? call('intent', book, { intent: list[round % list.length]?.intent })
                    : call('prompt', book, { prompt: prompts(book, runs + round, ' (cold)') });
            })
        );
    }

    const groups = new Map<string, Sample[]>();
    for (const sample of samples) {
        const key = `${sample.path} ${sample.cold ? 'cold' : 'warm'}`;
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
