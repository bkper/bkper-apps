/**
 * Measures opening a Book in the Report app as the web client does it, then the person's first
 * typed prompts, against a running app, read-only (`measure-api.ts --flow`).
 *
 * The client, once signed in (`AppState`), sends at once and in parallel: the saved-prompt shelf
 * (`GET /prompts`), the Book's names (`GET /names`) and the suggestions (`GET /suggestions`);
 * when the suggestions arrive, it fetches each one's report by intent, in parallel (no AI). The
 * Book's name comes from Bkper directly (bkper-js), not through the app, so it is not measured.
 * A typed prompt is one `POST /report` with `{ prompt }` only, after the 250 ms debounce, which is
 * not included here.
 */
import { isWritable, matchNames, nameKey } from 'report-shared/names';
import { percentile, readTiming } from './timing';

export interface BookName {
    id: string;
    name: string;
    kind: 'group' | 'account';
    root: string;
}

interface Suggestion {
    text: string;
    intent: unknown;
}

/** The periods the prompts name, one per open; their own list, so no earlier measure repeats. */
export const FLOW_PERIODS = [
    'last quarter',
    'this year',
    'last month',
    'last year',
    'year to date',
    'by month this year',
    'the last 12 months',
    'this quarter',
    'by month last year',
    'all time',
];

/** Requests that name no group or account, so Jev chooses the root. */
export const PLAIN_PHRASES = [
    'how much did we spend',
    'how much came in',
    'where the money went',
    'what we earned and spent',
    'what we own and owe',
];

/** Golden-ratio steps spread the opens over the whole list of names, not only its start. */
const GOLDEN = 0.6180339887;

/** The language the client sends with the suggestions and their reports (the browser's). */
const LANGUAGE = 'en';

/** How long the app caches a snapshot and balances, and a little longer, to be sure they expired. */
const CACHE_EXPIRY_MS = 65_000;

/** A request as the client keys its memory: whitespace runs as one space, case kept. */
function requestKey(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
}

/** The names of a Book by folded name, as the Worker finds them in a request. */
function indexNames(names: readonly BookName[]): {
    names: Map<string, BookName[]>;
    longest: number;
} {
    const index = new Map<string, BookName[]>();
    let longest = 0;
    for (const name of names) {
        const { key } = nameKey(name.name);
        if (!isWritable(key)) continue;
        index.set(key, [...(index.get(key) ?? []), name]);
        longest = Math.max(longest, key.length);
    }
    return { names: index, longest };
}

/**
 * The prompts of the `round`-th open of a Book: one that writes exactly one of its names (the
 * report is of it, whatever Jev answers), and one that writes none (Jev chooses the root), each
 * with a period of its own per round. Neither is a suggestion's text, which the client shows
 * from memory without asking. `undefined` when the Book has no such prompt.
 */
export function choosePrompts(
    names: readonly BookName[],
    suggestions: readonly string[],
    round: number
): { named?: string; plain?: string } {
    const index = indexNames(names);
    const suggested = new Set(suggestions.map(requestKey));
    const period = FLOW_PERIODS[round % FLOW_PERIODS.length];
    const usable = (prompt: string) => !suggested.has(requestKey(prompt));

    const named = names
        .map(name => nameKey(name.name).written)
        .filter((written, i, all) => all.indexOf(written) === i)
        .map(written => ({ written, prompt: `${written} ${period}` }))
        .filter(({ written, prompt }) => {
            const matches = matchNames(prompt, index.names, index.longest);
            return (
                usable(prompt) &&
                matches.length === 1 &&
                matches[0].start === 0 &&
                matches[0].end === written.length
            );
        });
    const pick = named[Math.floor(((round * GOLDEN) % 1) * named.length)];

    let plain: string | undefined;
    for (let i = 0; i < PLAIN_PHRASES.length && !plain; i++) {
        const prompt = `${PLAIN_PHRASES[(round + i) % PLAIN_PHRASES.length]} ${period}`;
        if (usable(prompt) && matchNames(prompt, index.names, index.longest).length === 0) {
            plain = prompt;
        }
    }
    return { named: pick?.prompt, plain };
}

type Cache = 'cold' | 'warm';

/** The steps of an open, in the order they are reported. */
const STEPS = [
    'shelf',
    'names',
    'suggestions',
    'prefetch 1',
    'prefetch 2',
    'prefetch 3',
    'open ready',
    'prompt named',
    'prompt plain',
] as const;
type Step = (typeof STEPS)[number];

interface FlowSample {
    book: string;
    cache: Cache;
    step: Step;
    /** Milliseconds from the open's first request to this answer, read whole. */
    sinceOpen?: number;
    /** Milliseconds of this request, from sending it to its body read whole. */
    request: number;
    /** 0 when the request failed without an answer. */
    status: number;
    /** Milliseconds by `Server-Timing` metric. */
    metrics: Record<string, number>;
}

interface Answer {
    status: number;
    json: unknown;
    request: number;
    end: number;
    metrics: Record<string, number>;
}

export interface FlowOptions {
    base: string;
    token: string;
    books: string[];
    /** Opens after the caches expired, per Book. */
    cold: number;
    /** Warm opens right after each cold one. */
    warm: number;
    /** Shifts the prompts chosen, so a rerun within Bkper AI's 15-minute cache asks others. */
    offset: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function listOf<T>(json: unknown, key: string): T[] {
    return isRecord(json) && Array.isArray(json[key]) ? (json[key] as T[]) : [];
}

/** Opens each Book `cold` times after its caches expired, each followed by `warm` opens. */
export async function measureFlow(options: FlowOptions): Promise<void> {
    const { base, token, books } = options;
    const samples: FlowSample[] = [];
    const started = performance.now();
    const lastSeen = new Map(books.map(book => [book, started]));
    const opens = new Map(books.map(book => [book, 0]));

    async function send(book: string, path: string, body?: unknown): Promise<Answer> {
        const start = performance.now();
        try {
            const response = await fetch(`${base}/api/v1/books/${book}/${path}`, {
                method: body ? 'POST' : 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Accept-Language': LANGUAGE,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            const json: unknown = await response.json().catch(() => undefined);
            const end = performance.now();
            if (!response.ok) console.log(`  ${path} ${response.status} ${JSON.stringify(json)}`);
            return {
                status: response.status,
                json,
                request: end - start,
                end,
                metrics: readTiming(response.headers.get('Server-Timing')),
            };
        } catch (error) {
            const end = performance.now();
            console.log(`  ${path} failed: ${error instanceof Error ? error.message : error}`);
            return { status: 0, json: undefined, request: end - start, end, metrics: {} };
        }
    }

    async function open(book: string, cache: Cache): Promise<void> {
        const round = options.offset + (opens.get(book) ?? 0);
        opens.set(book, round - options.offset + 1);
        const opened = performance.now();
        const loaded: string[] = [];
        const record = (step: Step, answer: Answer, sinceOpen?: number) => {
            samples.push({ book, cache, step, sinceOpen, ...answer });
            if (sinceOpen !== undefined) loaded.push(`${step} ${Math.round(sinceOpen)}`);
        };

        const shelf = send(book, 'prompts').then(answer =>
            record('shelf', answer, answer.end - opened)
        );
        const names = send(book, 'names').then(answer => {
            record('names', answer, answer.end - opened);
            return listOf<BookName>(answer.json, 'names');
        });
        const suggestions = send(book, `suggestions?language=${LANGUAGE}`).then(async answer => {
            record('suggestions', answer, answer.end - opened);
            const list = listOf<Suggestion>(answer.json, 'suggestions').slice(0, 3);
            await Promise.all(
                list.map((suggestion, i) =>
                    send(book, 'report', { intent: suggestion.intent, language: LANGUAGE }).then(
                        prefetch => record(STEPS[3 + i], prefetch, prefetch.end - opened)
                    )
                )
            );
            return list;
        });
        const [, bookNames, list] = await Promise.all([shelf, names, suggestions]);
        const ready = performance.now() - opened;
        samples.push({
            book,
            cache,
            step: 'open ready',
            sinceOpen: ready,
            request: ready,
            status: 200,
            metrics: {},
        });
        console.log(`${book} ${cache} open: ready ${Math.round(ready)} ms (${loaded.join(', ')})`);

        const prompts = choosePrompts(
            bookNames,
            list.map(suggestion => suggestion.text),
            round
        );
        const kinds: ['named' | 'plain', string | undefined][] = [
            ['named', prompts.named],
            ['plain', prompts.plain],
        ];
        // Alternate which comes first, so neither always finds Jev or the balances warmer.
        if (round % 2 === 1) kinds.reverse();
        for (const [kind, prompt] of kinds) {
            if (!prompt) {
                console.log(`  prompt ${kind}: none for this Book`);
                continue;
            }
            const answer = await send(book, 'report', { prompt });
            record(`prompt ${kind}`, answer);
            const trace =
                isRecord(answer.json) && isRecord(answer.json.trace) ? answer.json.trace : {};
            const intent =
                isRecord(answer.json) && isRecord(answer.json.intent) ? answer.json.intent : {};
            const found = Array.isArray(trace.names) ? trace.names.join(', ') : '';
            console.log(
                `  prompt ${kind} "${prompt}": ${answer.status} ${Math.round(answer.request)} ms, ` +
                    (found ? `names ${found}` : `root ${String(intent.root ?? '-')}`)
            );
        }
        lastSeen.set(book, performance.now());
    }

    for (let round = 0; round < options.cold; round++) {
        for (const book of books) {
            const wait = (lastSeen.get(book) ?? 0) + CACHE_EXPIRY_MS - performance.now();
            if (wait > 0) {
                console.log(`Waiting ${Math.ceil(wait / 1000)} s for ${book}'s caches to expire…`);
                await sleep(wait);
            }
            await open(book, 'cold');
            for (let run = 0; run < options.warm; run++) await open(book, 'warm');
        }
    }
    printFlow(samples, books);
}

function cell(values: number[]): string {
    return values.length
        ? `${Math.round(percentile(values, 50))}/${Math.round(percentile(values, 95))}`
        : '-';
}

function printFlow(samples: FlowSample[], books: string[]): void {
    for (const book of books) {
        console.log(`\n${book}`);
        console.log('cache step             n  since open  request    Server-Timing p50/p95 ms');
        for (const cache of ['cold', 'warm'] as const) {
            for (const step of STEPS) {
                const group = samples.filter(
                    s => s.book === book && s.cache === cache && s.step === step
                );
                if (!group.length) continue;
                const metrics = [...new Set(group.flatMap(s => Object.keys(s.metrics)))]
                    .map(name => `${name} ${cell(group.map(s => s.metrics[name] ?? 0))}`)
                    .join(', ');
                const failed = group.filter(s => s.status !== 200).length;
                const since = group.flatMap(s => (s.sinceOpen === undefined ? [] : [s.sinceOpen]));
                console.log(
                    `${cache.padEnd(5)} ${step.padEnd(15)} ${String(group.length).padStart(2)}  ` +
                        `${cell(since).padEnd(10)}  ${cell(group.map(s => s.request)).padEnd(9)}  ` +
                        `${metrics}${failed ? `  (${failed} failed)` : ''}`
                );
            }
        }
    }
}
