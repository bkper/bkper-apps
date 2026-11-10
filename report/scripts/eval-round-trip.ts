/**
 * Checks that a report's own text asks for the same report: the text a report answers with
 * (`text`, its request text) is sent back as a prompt, read by the real decision model, and the
 * report it gives must be the same report (`eval-round-trip/identity.ts`).
 *
 *     npx tsx scripts/eval-round-trip.ts [--books=nimbus,personal,rosalia,aqua]
 *         [--languages=en,pt,es,ja,ar] [--only=<case>,...] [--concurrency=4] [--dry-run]
 *
 * For each Book it builds, from the Book's map, reports by intent as the app builds them
 * (`createReport`, no AI): the Book's suggestions; an activity root in many periods (relative
 * and written, months, quarters, year to date, the last 12 months, all time) and compared with
 * named periods and a year earlier, by month, and with a hashtag; a position root now and at
 * the ends of past periods; a subgroup and accounts as targets; targets side by side; and the
 * net result when the Book has one. Each is built in each language, and its text is sent back
 * as the only thing in the request (no language), so the language is read from the text too.
 * A report is the same when it reads the same groups and accounts, hashtag, months of its period
 * and of its comparison, by month or not, and view, in the same language; the chart is a
 * request option and left out. Each miss prints both reports and the model's judgments.
 * `--dry-run` prints the texts and sends none back (Jev still ranks the suggestions).
 *
 * Read-only: the maps and balances are read with your `bkper auth token`, with the app's
 * balances loader and a cache of this run; model calls use `BKPER_AI_TOKEN` when set, else the
 * same token, labelled `bkper-ai-source: report-eval-round-trip`. Bkper AI caches identical
 * requests for 15 minutes. Write texts more clearly, never the expectations.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Bkper, type Book } from 'bkper-js';
import { addAllLocales } from 'report-shared/locales';
import { loadBalances } from '../server/src/services/balances-loader.ts';
import { mixedGroupProblem } from '../server/src/services/book-problems.ts';
import {
    BkperAiError,
    createDecisionClient,
    type DecisionClient,
} from '../server/src/services/decision-client.ts';
import type { IntentTrace } from '../server/src/services/intent-resolver.ts';
import type { PeriodParts } from '../server/src/services/period-query.ts';
import type { ReportNature } from '../server/src/services/periods.ts';
import { netResultOf } from '../server/src/services/report.ts';
import { NET_RESULT_ROOT, type ReportIntent } from '../server/src/services/report-intent.ts';
import {
    createReport,
    type ReportResult,
    type ReportServiceOptions,
} from '../server/src/services/report-service.ts';
import type { Snapshot, SnapshotAccount, SnapshotGroup } from '../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../server/src/services/snapshot-loader.ts';
import { readSuggestions } from '../server/src/services/suggestions.ts';
import { ServerTiming } from '../server/src/services/timing.ts';
import {
    IDENTITY_PARTS,
    describeIdentity,
    differences,
    identityOf,
    type IdentityPart,
    type ReportIdentity,
} from './eval-round-trip/identity.ts';

const BOOKS = {
    nimbus: 'agtzfmJrcGVyLWhyZHINCxIGTGVkZ2VyGNEPDA',
    personal: 'agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICAgIOLzLQKDA',
    rosalia: 'agtzfmJrcGVyLWhyZHIOCxIGTGVkZ2VyGKnDAQw',
    aqua: 'agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICAwIjLlYgLDA',
} as const;

type BookKey = keyof typeof BOOKS;

/** A hashtag each Book's transactions use; any hashtag reads the same way. */
const HASHTAGS: Record<BookKey, string> = {
    nimbus: 'aluguel',
    personal: 'travel',
    rosalia: 'supermercado',
    aqua: 'projeto',
};

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

interface RoundTripCase {
    number: number;
    book: BookKey;
    label: string;
    intent: ReportIntent;
    nature: ReportNature;
}

/** Names alike once folded, as requests write them: case and accents aside. */
function fold(name: string): string {
    return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The accounts under a group, at any depth, in the map's order. */
function accountsUnder(snapshot: Snapshot, group: SnapshotGroup): SnapshotAccount[] {
    return [
        ...group.accounts.map(id => snapshot.accounts[id]),
        ...group.groups.flatMap(id => accountsUnder(snapshot, snapshot.groups[id])),
    ];
}

/**
 * The parts of a Book a case reads: activity and position roots, subgroups and accounts with
 * transactions posted, none mixed, none hidden, each with a name no other name of the Book
 * folds to, so the text names exactly it.
 */
function bookParts(snapshot: Snapshot) {
    const names = new Map<string, number>();
    for (const node of [
        ...Object.values(snapshot.groups),
        ...Object.values(snapshot.accounts),
        ...Object.values(snapshot.ungrouped),
    ]) {
        names.set(fold(node.name), (names.get(fold(node.name)) ?? 0) + 1);
    }
    const unique = (name: string) => names.get(fold(name)) === 1 && [...name].length > 1;
    const posted = (group: SnapshotGroup) =>
        accountsUnder(snapshot, group).some(account => account.posted && !account.archived);
    const usable = (group: SnapshotGroup) =>
        !group.hidden &&
        group.type !== 'MIXED' &&
        unique(group.name) &&
        posted(group) &&
        mixedGroupProblem(snapshot, group.id) === undefined;
    const roots = snapshot.roots.map(id => snapshot.groups[id]).filter(usable);
    const size = (group: SnapshotGroup) => accountsUnder(snapshot, group).length;
    const activity = roots.filter(group => !group.permanent).sort((a, b) => size(b) - size(a));
    const positions = roots.filter(group => group.permanent).sort((a, b) => size(b) - size(a));
    const account = (group: SnapshotGroup | undefined) =>
        group &&
        accountsUnder(snapshot, group).find(
            account => account.posted && !account.archived && unique(account.name)
        );
    const main = activity[0];
    return {
        main,
        other: activity[1],
        position: positions[0],
        subgroup: snapshot.roots
            .map(id => snapshot.groups[id])
            .filter(root => !root.hidden)
            .flatMap(root => root.groups.map(id => ({ root, group: snapshot.groups[id] })))
            .find(({ group }) => usable(group)),
        account: account(main),
        positionAccount: account(positions[0]),
    };
}

/** The reports by intent to send back: the Book's suggestions, then reports of its parts. */
function bookCases(
    book: BookKey,
    snapshot: Snapshot,
    suggestions: ReportIntent[]
): Omit<RoundTripCase, 'number'>[] {
    const parts = bookParts(snapshot);
    const cases: Omit<RoundTripCase, 'number'>[] = [];
    const add = (label: string, intent: ReportIntent, nature: ReportNature) =>
        cases.push({ book, label, intent, nature });
    suggestions.forEach((intent, i) =>
        add(`suggestion ${i + 1}`, intent, natureOf(snapshot, intent))
    );
    const { main, other, position, subgroup, account, positionAccount } = parts;
    if (main) {
        const activity = (label: string, period: PeriodParts, more: Partial<ReportIntent> = {}) =>
            add(label, { root: main.id, period, monthly: false, ...more }, 'activity');
        activity('this year', { span: 'year', year: 'current' });
        activity('last year', { span: 'year', year: 'previous' });
        activity('last month', { span: 'month', month: 'previous' });
        activity('this quarter', { span: 'quarter', quarter: 'current' });
        activity('Q3 2024', { span: 'quarter', year: 2024, quarter: 3 });
        activity('year to date', { span: 'year_to_date' });
        activity('all time', { span: 'all_time' });
        activity('January last year', { span: 'month', year: 'previous', month: 1 });
        activity('2018', { span: 'year', year: 2018 });
        activity(
            'last year vs 2023',
            { span: 'year', year: 'previous' },
            { compared: { year: 2023 } }
        );
        activity('Q3 vs Q1', { span: 'quarter', quarter: 3 }, { compared: { quarter: 1 } });
        activity(
            'this quarter a year earlier',
            { span: 'quarter', quarter: 'current' },
            { compareWith: 'year_earlier' }
        );
        activity(
            'last month a year earlier',
            { span: 'month', month: 'previous' },
            { compareWith: 'year_earlier' }
        );
        activity(
            'by month this year',
            { span: 'year', year: 'current' },
            { monthly: true, view: 'trend' }
        );
        activity(
            'by month last 12 months',
            { span: 'last_12_months' },
            { monthly: true, view: 'trend' }
        );
        activity(
            'hashtag this year',
            { span: 'year', year: 'current' },
            { hashtags: [HASHTAGS[book]] }
        );
        activity(
            'hashtag by month last year',
            { span: 'year', year: 'previous' },
            { hashtags: [HASHTAGS[book]], monthly: true, view: 'trend' }
        );
        if (account) {
            activity(
                'account this year',
                { span: 'year', year: 'current' },
                { target: account.id }
            );
        }
        if (other) {
            activity(
                'two roots side by side',
                { span: 'year', year: 'current' },
                {
                    alongside: [{ root: other.id }],
                }
            );
        }
        if (
            subgroup &&
            !subgroup.group.permanent &&
            account &&
            !subgroup.group.accounts.includes(account.id)
        ) {
            activity(
                'subgroup and account side by side, by month',
                { span: 'year', year: 'previous' },
                {
                    root: subgroup.root.id,
                    target: subgroup.group.id,
                    alongside: [{ root: main.id, target: account.id }],
                    monthly: true,
                    view: 'trend',
                }
            );
        }
    }
    if (subgroup) {
        const { root, group } = subgroup;
        add(
            'subgroup last month',
            {
                root: root.id,
                target: group.id,
                period: { span: 'month', month: 'previous' },
                monthly: false,
            },
            group.permanent ? 'position' : 'activity'
        );
    }
    if (position) {
        const balance = (label: string, period: PeriodParts, more: Partial<ReportIntent> = {}) =>
            add(label, { root: position.id, period, monthly: false, ...more }, 'position');
        balance('now', { span: 'now' });
        balance('end of last year', { span: 'year', year: 'previous' });
        balance('end of last month', { span: 'month', month: 'previous' });
        balance('now a year earlier', { span: 'now' }, { compareWith: 'year_earlier' });
        if (positionAccount) {
            balance('account now', { span: 'now' }, { target: positionAccount.id });
        }
    }
    if (netResultOf(snapshot).kind !== 'none') {
        add(
            'net result last year',
            { root: NET_RESULT_ROOT, period: { span: 'year', year: 'previous' }, monthly: false },
            'activity'
        );
    }
    return cases;
}

/** A suggestion's nature: a position of a permanent group, else activity. */
function natureOf(snapshot: Snapshot, intent: ReportIntent): ReportNature {
    const group = snapshot.groups[intent.target ?? intent.root];
    return group?.permanent ? 'position' : 'activity';
}

/** Bkper AI failures worth asking again: its server, a timeout or the connection. */
function transient(error: unknown): boolean {
    return (
        error instanceof BkperAiError &&
        (error.status >= 500 || (error.status === 429 && error.code !== 'usage_limit_exceeded'))
    );
}

async function withRetries<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await work();
        } catch (error) {
            if (attempt >= ATTEMPTS || !transient(error)) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
        }
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

/** A report by intent and, unless a dry run, the report its text gave back as a prompt. */
interface RoundTrip {
    test: RoundTripCase;
    language: string;
    /** The report's text; none when the report by intent could not be built. */
    text?: string;
    error?: string;
    back?: {
        ms: number;
        expected: ReportIdentity;
        actual?: ReportIdentity;
        differ: IdentityPart[];
        judgments?: IntentTrace['judgments'];
    };
}

interface BookRun {
    snapshot: Snapshot;
    options: () => ReportServiceOptions;
}

function percent(hits: number, total: number): string {
    return `${hits}/${total} (${total === 0 ? '-' : ((hits / total) * 100).toFixed(1)}%)`;
}

function errorText(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function main(): Promise<void> {
    addAllLocales();
    const books = (list('books').length > 0 ? list('books') : Object.keys(BOOKS)).filter(
        (key): key is BookKey => Object.hasOwn(BOOKS, key)
    );
    const languages =
        list('languages').length > 0 ? list('languages') : ['en', 'pt', 'es', 'ja', 'ar'];
    const only = list('only').map(Number);
    const concurrency = Number(option('concurrency') ?? 4);
    const dryRun = process.argv.includes('--dry-run');

    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    const userId = await currentUserId(bkper, new ServerTiming());
    const decisions: DecisionClient = createDecisionClient({
        apiKey: process.env.BKPER_AI_TOKEN || token,
        headers: { 'bkper-ai-source': 'report-eval-round-trip' },
    });

    const runs = new Map<BookKey, BookRun>();
    const cases: RoundTripCase[] = [];
    for (const key of books) {
        const snapshot = await loadSnapshot(BOOKS[key], {
            userId,
            bkper,
            kv: new MemoryStore(),
            timing: new ServerTiming(),
        });
        const book: Book = await bkper.getBook(BOOKS[key]);
        const kv = new MemoryStore();
        const options = (): ReportServiceOptions => {
            const timing = new ServerTiming();
            return {
                decisions,
                timing,
                cache: kv,
                // The app's loader, with a cache of this run.
                loadBalances: queries =>
                    loadBalances(queries, {
                        userId,
                        bookId: book.getId(),
                        today: snapshot.today,
                        kv,
                        timing,
                        read: query => book.getBalancesReport(query),
                    }),
            };
        };
        runs.set(key, { snapshot, options });
        const suggestions = await readSuggestions(snapshot, 'en', options());
        for (const test of bookCases(
            key,
            snapshot,
            suggestions.map(suggestion => suggestion.intent)
        )) {
            cases.push({ ...test, number: cases.length + 1 });
        }
        console.log(`${key}: ${snapshot.book.name}, today ${snapshot.today}`);
    }
    const selected = cases.filter(test => only.length === 0 || only.includes(test.number));
    const asks = selected.flatMap(test => languages.map(language => ({ test, language })));
    console.log(`${selected.length} reports × ${languages.length} languages = ${asks.length}`);

    let done = 0;
    const results = await pool(
        asks,
        concurrency,
        async ({ test, language }): Promise<RoundTrip> => {
            const run = runs.get(test.book);
            if (!run) {
                throw new Error(`No Book ${test.book}`);
            }
            const { snapshot } = run;
            let original: ReportResult;
            try {
                original = await createReport(
                    snapshot,
                    { intent: test.intent },
                    { requested: language },
                    run.options()
                );
            } catch (error) {
                return { test, language, error: errorText(error) };
            }
            const text = original.text;
            if (dryRun) {
                return { test, language, text };
            }
            const started = performance.now();
            let back: ReportResult | undefined;
            let error: string | undefined;
            try {
                back = await withRetries(() =>
                    createReport(snapshot, { prompt: text }, {}, run.options())
                );
            } catch (caught) {
                error = errorText(caught);
            }
            const ms = performance.now() - started;
            done++;
            if (done % 50 === 0) {
                console.error(`${done}/${asks.length}`);
            }
            const expected = identityOf(original, snapshot.today, test.nature);
            const actual = back ? identityOf(back, snapshot.today, test.nature) : undefined;
            return {
                test,
                language,
                text,
                ...(error ? { error } : {}),
                back: {
                    ms,
                    expected,
                    actual,
                    differ: actual ? differences(expected, actual) : [...IDENTITY_PARTS],
                    judgments: back?.trace.judgments,
                },
            };
        }
    );

    const where = ({ test, language }: RoundTrip) =>
        `#${test.number} [${test.book}, ${test.label}, ${language}]`;
    const unbuilt = results.filter(result => result.text === undefined);
    for (const result of unbuilt) {
        console.log(`not built ${where(result)}: ${result.error ?? ''}`);
    }
    if (dryRun) {
        for (const result of results) {
            if (result.text !== undefined) {
                console.log(`${where(result)} ${result.text}`);
            }
        }
        return;
    }

    const scored = results.flatMap(result => (result.back ? [{ ...result, ...result.back }] : []));
    for (const result of scored) {
        if (result.differ.length === 0) {
            continue;
        }
        const judgments = Object.entries(result.judgments ?? {})
            .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
            .join(' ');
        console.log(
            `MISS ${where(result)} "${result.text}"` +
                `\n       differs  ${result.differ.join(', ')}` +
                `\n       report   ${describeIdentity(result.expected)}` +
                `\n       back     ${result.actual ? describeIdentity(result.actual) : 'none'}` +
                (judgments ? `\n       ${judgments}` : '') +
                (result.error ? `\n       error: ${result.error}` : '')
        );
    }

    const same = (parts: readonly IdentityPart[]) => (result: (typeof scored)[number]) =>
        result.differ.every(part => !parts.includes(part));
    const report = IDENTITY_PARTS.filter(part => part !== 'language');
    console.log(
        `\nSame report (language aside): ${percent(scored.filter(same(report)).length, scored.length)}`
    );
    console.log(
        `Same report and language:     ${percent(scored.filter(same(IDENTITY_PARTS)).length, scored.length)}`
    );
    for (const part of IDENTITY_PARTS) {
        console.log(
            `  ${part.padEnd(11)} ${percent(scored.filter(same([part])).length, scored.length)}`
        );
    }
    for (const language of languages) {
        const of = scored.filter(result => result.language === language);
        console.log(
            `  ${language.padEnd(11)} ${percent(of.filter(same(report)).length, of.length)} (language aside)`
        );
    }
    for (const key of books) {
        const of = scored.filter(result => result.test.book === key);
        console.log(
            `  ${key.padEnd(11)} ${percent(of.filter(same(report)).length, of.length)} (language aside)`
        );
    }
    const times = scored.map(result => result.ms).sort((a, b) => a - b);
    const at = (q: number) =>
        Math.round(times.at(Math.min(times.length - 1, Math.floor(q * times.length))) ?? 0);
    console.log(`prompt p50/p95 ${at(0.5)}/${at(0.95)} ms; ${unbuilt.length} not built`);
    const out = `/tmp/report-round-trip-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`Wrote ${out}`);
}

await main();
