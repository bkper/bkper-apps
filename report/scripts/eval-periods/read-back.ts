/**
 * Checks that the text a report stands for reads back as its period, against the real decision
 * model: a person may edit that text and ask again, so it must say the same months.
 *
 *     npx tsx scripts/eval-periods/read-back.ts [--languages=en,pt,es,ja,ar] [--today=2026-11-09]
 *         [--set=combinations|cases] [--only=<n>,...] [--concurrency=4] [--mismatched]
 *         [--cases=<run.json>] [--dry-run]
 *
 * It writes the request text (`requestText`) of every combination of period parts the query
 * builder accepts on `today` (`server/test/fixtures/period-combinations.ts`), keeps those a
 * reader that answered every part exactly would read back (`readPeriod` may read some parts in
 * other ways, such as a relative year with the last 12 months, which no wording changes), and
 * one combination per kind of English text (written years, months and quarters stand for any);
 * `--set=cases` asks instead each period the period evaluation's requests mean (`cases.ts`).
 * Each text is asked in each language as the app asks (`modes.ts`), on Personal finances, with
 * the Book's today replaced by `today`, and scored as the period evaluation scores (`score.ts`):
 * the months of the period and of its comparison read back, or the same reason for none.
 * `--dry-run` lists the texts and calls nothing; `--mismatched` also asks texts that compare
 * with another kind of period, which the report answers with the previous period instead. Each
 * run is written to a JSON file in `/tmp`; `--cases` asks the combinations of such a run again,
 * so two wordings can be compared on the same ones.
 *
 * The snapshot is read once, read-only, with your `bkper auth token`; model calls use
 * `BKPER_AI_TOKEN` when set, else the same token, labelled `bkper-ai-source: report-eval-periods`.
 * Bkper AI caches identical requests for 15 minutes. Tune the wording, never the expectations.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Bkper } from 'bkper-js';
import { addAllLocales } from 'report-shared/locales';
import { withoutIsolates } from 'report-shared/bidi';
import { BkperAiError, createDecisionClient } from '../../server/src/services/decision-client.ts';
import {
    readPeriod,
    type PeriodAnswers,
    type PeriodQuestionId,
} from '../../server/src/services/period-questions.ts';
import type {
    ComparedParts,
    MonthPart,
    PeriodRequest,
    QuarterPart,
    YearPart,
} from '../../server/src/services/period-query.ts';
import type { IsoDate, ReportNature } from '../../server/src/services/periods.ts';
import { requestText } from '../../server/src/services/request-text.ts';
import type { NodeType, Snapshot } from '../../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../../server/src/services/timing.ts';
import { periodCombinations } from '../../server/test/fixtures/period-combinations.ts';
import { BOOKS, CASES, NOV, expectations } from './cases.ts';
import { readByAtomicParts, type PeriodAsk, type PeriodReading } from './modes.ts';
import { describeMeaning, meaningOf, sameComparison, samePeriod, type Meaning } from './score.ts';

const ATTEMPTS = 4;
const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

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

/** A balance now is a position; every other period is read as activity. */
function natureOf(request: PeriodRequest): ReportNature {
    return request.period.span === 'now' ? 'position' : 'activity';
}

function yearLabel(year: YearPart | undefined): string {
    switch (year) {
        case undefined:
            return 'unspecified';
        case 'current':
            return 'this_year';
        case 'previous':
            return 'last_year';
        case 'before_previous':
            return 'year_before_last';
        default:
            return String(year);
    }
}

function monthLabel(month: MonthPart | undefined): string {
    return month === undefined
        ? 'unspecified'
        : month === 'current'
          ? 'this_month'
          : month === 'previous'
            ? 'last_month'
            : MONTH_NAMES[month - 1];
}

function quarterLabel(quarter: QuarterPart | undefined): string {
    return quarter === undefined
        ? 'unspecified'
        : quarter === 'current'
          ? 'this_quarter'
          : quarter === 'previous'
            ? 'last_quarter'
            : `Q${quarter}`;
}

/** The answers of a reader sure of exactly the parts of `request`. */
function exactAnswers(request: PeriodRequest): PeriodAnswers {
    const sure = (choice: string) => ({ choice, confidence: 1 });
    const compared: ComparedParts = request.compared ?? {};
    const answers: Record<PeriodQuestionId, { choice: string; confidence: number }> = {
        span: sure(request.period.span ?? 'unspecified'),
        year: sure(yearLabel(request.period.year)),
        month: sure(monthLabel(request.period.month)),
        quarter: sure(quarterLabel(request.period.quarter)),
        compared_year: sure(yearLabel(compared.year)),
        compared_month: sure(monthLabel(compared.month)),
        compared_quarter: sure(quarterLabel(compared.quarter)),
    };
    return { ...answers, year_earlier: { noul: request.compareWith === 'year_earlier' ? 1 : 0 } };
}

function sameMeaning(a: Meaning, b: Meaning): boolean {
    return samePeriod(a, b) && sameComparison(a, b);
}

/**
 * The kind of an English text: written years, months and quarters stand for any, and so does
 * whatever all time is compared with, which it never is.
 */
function kindOfText(text: string): string {
    return text
        .replace(/all time vs\. .*/, 'all time vs. ANY')
        .replace(/\b\d{4}\b/g, 'YYYY')
        .replace(new RegExp(`\\b(${MONTH_NAMES.join('|')})\\b`, 'g'), 'MONTH')
        .replace(/\bQ\d\b/g, 'QN');
}

interface ReadBackCase {
    number: number;
    request: PeriodRequest;
    nature: ReportNature;
    english: string;
}

/**
 * The requests to ask, of those the builder reads a period of and an exact reader reads back:
 * every combination, one per kind of English text, or each period the evaluation's cases mean.
 */
function readBackCases(
    today: IsoDate,
    set: 'combinations' | 'cases',
    mismatched: boolean
): { cases: ReadBackCase[]; unreadable: number } {
    const requests =
        set === 'cases'
            ? [
                  ...new Map(
                      CASES.flatMap(expectations).map(request => [JSON.stringify(request), request])
                  ).values(),
              ]
            : periodCombinations(today);
    const kinds = new Set<string>();
    const cases: ReadBackCase[] = [];
    let unreadable = 0;
    for (const request of requests) {
        const nature = natureOf(request);
        const meaning = meaningOf({ request }, today, nature);
        if (meaning.reason !== undefined) {
            continue;
        }
        const exact = readPeriod(exactAnswers(request));
        const read = exact.request
            ? meaningOf({ request: exact.request }, today, nature)
            : { reason: exact.reason ?? 'unspecified_period' };
        if (!sameMeaning(meaning, read)) {
            unreadable++;
            continue;
        }
        if (!mismatched && meaning.comparisonError === 'comparison_kind_mismatch') {
            continue;
        }
        const english = withoutIsolates(requestText(request, 'Title', 'en'));
        const kind = set === 'cases' ? JSON.stringify(request) : kindOfText(english);
        if (!kinds.has(kind)) {
            kinds.add(kind);
            cases.push({ number: cases.length + 1, request, nature, english });
        }
    }
    return { cases, unreadable };
}

/** The cases of an earlier run, to ask them again in other words. */
function casesOf(path: string): { cases: ReadBackCase[]; unreadable: number } {
    const run = JSON.parse(readFileSync(path, 'utf8')) as { test: ReadBackCase }[];
    const cases = new Map(run.map(({ test }) => [test.number, test]));
    return { cases: [...cases.values()], unreadable: 0 };
}

/** Bkper AI failures worth asking again: its server, a timeout or the connection. */
function transient(error: unknown): boolean {
    return (
        error instanceof BkperAiError &&
        (error.status >= 500 || (error.status === 429 && error.code !== 'usage_limit_exceeded'))
    );
}

async function readWithRetries(ask: PeriodAsk): Promise<PeriodReading> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await readByAtomicParts(ask);
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

/** A root group of the Book of a type, whose name titles the texts. */
function titleOf(snapshot: Snapshot, types: readonly NodeType[]): string {
    const root = snapshot.roots.map(id => snapshot.groups[id]).find(g => types.includes(g.type));
    if (!root) {
        throw new Error(`No root group of type ${types.join(' or ')}`);
    }
    return root.name;
}

interface Tally {
    hits: number;
    total: number;
}

function percent({ hits, total }: Tally): string {
    return `${hits}/${total} (${total === 0 ? '-' : ((hits / total) * 100).toFixed(1)}%)`;
}

async function main(): Promise<void> {
    const today = (option('today') ?? NOV) as IsoDate;
    const languages = list('languages');
    if (languages.length === 0) {
        languages.push('en', 'pt', 'es', 'ja', 'ar');
    }
    const only = list('only').map(Number);
    const concurrency = Number(option('concurrency') ?? 4);
    addAllLocales();
    const from = option('cases');
    const { cases: all, unreadable } = from
        ? casesOf(from)
        : readBackCases(
              today,
              option('set') === 'cases' ? 'cases' : 'combinations',
              process.argv.includes('--mismatched')
          );
    const cases = all.filter(test => only.length === 0 || only.includes(test.number));
    console.log(
        `${all.length} requests; ${unreadable} left out, which an exact reader reads otherwise`
    );
    if (process.argv.includes('--dry-run')) {
        for (const test of cases) {
            console.log(`#${test.number} ${test.english}  ${JSON.stringify(test.request)}`);
        }
        return;
    }

    const bkperToken = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => bkperToken });
    const userId = await currentUserId(bkper, new ServerTiming());
    const snapshot = await loadSnapshot(BOOKS.personal, {
        userId,
        bkper,
        kv: new MemoryStore(),
        timing: new ServerTiming(),
    });
    const titles: Record<ReportNature, string> = {
        activity: titleOf(snapshot, ['OUTGOING']),
        position: titleOf(snapshot, ['ASSET']),
    };
    const client = createDecisionClient({
        apiKey: process.env.BKPER_AI_TOKEN || bkperToken,
        headers: { 'bkper-ai-source': 'report-eval-periods' },
    });

    const asks = cases.flatMap(test => languages.map(language => ({ test, language })));
    let done = 0;
    const results = await pool(asks, concurrency, async ({ test, language }) => {
        const prompt = withoutIsolates(requestText(test.request, titles[test.nature], language));
        const expected = meaningOf({ request: test.request }, today, test.nature);
        let actual: Meaning;
        let judgments: Record<string, string> = {};
        let error: string | undefined;
        try {
            const reading = await readWithRetries({ prompt, snapshot, today, client });
            actual = meaningOf(reading.answer, today, test.nature);
            judgments = reading.judgments;
        } catch (failure) {
            actual = { reason: 'mode_error' };
            error = failure instanceof Error ? failure.message : String(failure);
        }
        done++;
        if (done % 50 === 0 || done === asks.length) {
            console.error(`${done}/${asks.length}`);
        }
        return {
            test,
            language,
            prompt,
            expected,
            actual,
            period: samePeriod(expected, actual),
            comparison: sameComparison(expected, actual),
            judgments,
            error,
        };
    });

    const byLanguage = new Map(languages.map(language => [language, { hits: 0, total: 0 }]));
    const total: Tally = { hits: 0, total: 0 };
    for (const result of results) {
        const hit = result.period && result.comparison;
        for (const tally of [total, byLanguage.get(result.language) ?? total]) {
            tally.total++;
            tally.hits += hit ? 1 : 0;
        }
        if (hit) {
            continue;
        }
        const judgments = Object.entries(result.judgments)
            .map(([name, value]) => `${name}=${value}`)
            .join(' ');
        console.log(
            `MISS #${result.test.number} [${result.language}] "${result.prompt}"` +
                `\n       parts    ${JSON.stringify(result.test.request)}` +
                `\n       expected ${describeMeaning(result.expected)}` +
                `\n       read     ${describeMeaning(result.actual)}` +
                (judgments ? `\n       ${judgments}` : '') +
                (result.error ? `\n       error: ${result.error}` : '')
        );
    }
    console.log(`\nRead back (period and comparison): ${percent(total)}`);
    console.log(
        `period ${percent({ hits: results.filter(r => r.period).length, total: results.length })}, ` +
            `comparison ${percent({ hits: results.filter(r => r.comparison).length, total: results.length })}`
    );
    for (const [language, tally] of byLanguage) {
        console.log(`  ${language.padEnd(6)} ${percent(tally)}`);
    }
    const out = `/tmp/report-read-back-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`\nWrote ${out}`);
}

await main();
