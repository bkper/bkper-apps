/**
 * Scores period readings by meaning: the parts expected and the parts read are each built into
 * a query with `buildPeriodQuery` at the case's today, the query's dates are resolved with
 * `resolveQueryDates`, and the months they read (of the period and of its comparison), or the
 * reasons there are none, are compared. Two readings written differently that read the same
 * months are the same reading.
 */
import {
    buildPeriodQuery,
    resolveQueryDates,
    type ComparisonError,
    type PeriodError,
    type PeriodRequest,
    type PeriodSpan,
    type QueryDates,
} from '../../server/src/services/period-query.ts';
import type { IsoDate, ReportNature } from '../../server/src/services/periods.ts';

/** What a mode answers: the parts of a period, or why it read none. */
export type PeriodAnswer = { request: PeriodRequest } | { reason: PeriodError };

/** Why a reading has no period: the builder's reasons, parts it rejects, or a failed call. */
export type MeaningReason = PeriodError | 'invalid_parts' | 'mode_error';

/** What a reading means: the months its query reads, or why it has none. */
export interface Meaning {
    reason?: MeaningReason;
    period?: QueryDates & { kind: PeriodSpan; dates: string };
    comparison?: QueryDates & { dates: string };
    comparisonError?: ComparisonError;
}

export function meaningOf(answer: PeriodAnswer, today: IsoDate, nature: ReportNature): Meaning {
    if ('reason' in answer) {
        return { reason: answer.reason };
    }
    let built: ReturnType<typeof buildPeriodQuery>;
    try {
        built = buildPeriodQuery(answer.request, { today, nature });
    } catch {
        return { reason: 'invalid_parts' };
    }
    if (!built.ok) {
        return { reason: built.reason };
    }
    const { period, comparison, comparisonError } = built;
    return {
        period: {
            kind: period.kind,
            dates: period.dates,
            ...resolveQueryDates(period.dates, today),
        },
        ...(comparison
            ? {
                  comparison: {
                      dates: comparison.dates,
                      ...resolveQueryDates(comparison.dates, today),
                  },
              }
            : {}),
        ...(comparisonError ? { comparisonError } : {}),
    };
}

function sameDates(a: QueryDates | undefined, b: QueryDates | undefined): boolean {
    return a?.first === b?.first && a?.last === b?.last && a?.beforeDay === b?.beforeDay;
}

/** The same period read, or the same reason for none. */
export function samePeriod(a: Meaning, b: Meaning): boolean {
    return a.reason === b.reason && sameDates(a.period, b.period);
}

/** The same comparison read, the same reason it cannot be, or none in both. */
export function sameComparison(a: Meaning, b: Meaning): boolean {
    return a.comparisonError === b.comparisonError && sameDates(a.comparison, b.comparison);
}

export function sameMeaning(a: Meaning, b: Meaning): boolean {
    return samePeriod(a, b) && sameComparison(a, b);
}

/** The parts of a reading scored on their own, each by the months it reads. */
export const PARTS = ['span', 'year', 'month', 'quarter', 'comparison'] as const;

export type Part = (typeof PARTS)[number];

export interface CaseScore {
    /** The period read, or the reason for none, is the one expected. */
    period: boolean;
    /** Period and comparison both right. */
    whole: boolean;
    /** Each part that applies to the expected reading. */
    parts: Partial<Record<Part, boolean>>;
}

/**
 * The kind of a period for scoring its span: a month and now read one month, and a year and the
 * year to date are both a calendar year read to date.
 */
function spanClass(kind: PeriodSpan): string {
    switch (kind) {
        case 'now':
            return 'month';
        case 'year_to_date':
            return 'year';
        default:
            return kind;
    }
}

function scoreOne(expected: Meaning, actual: Meaning): CaseScore {
    const period = samePeriod(expected, actual);
    const parts: Partial<Record<Part, boolean>> = {};
    const want = expected.period;
    if (want) {
        const got = actual.period;
        const kind = spanClass(want.kind);
        parts.span = got !== undefined && spanClass(got.kind) === kind;
        parts.comparison = got !== undefined && sameComparison(expected, actual);
        // The last month names the period's year, month and quarter, also for a position,
        // which is read at its end; all time has no year.
        const last = want.last;
        if (want.kind !== 'all_time' && last !== undefined) {
            const read = got?.kind === 'all_time' ? undefined : got?.last;
            parts.year = read?.slice(0, 4) === last.slice(0, 4);
            if (kind === 'month') {
                parts.month = read?.slice(5) === last.slice(5);
            }
            if (kind === 'quarter') {
                parts.quarter = read !== undefined && quarterOf(read) === quarterOf(last);
            }
        }
    }
    return { period, whole: period && sameComparison(expected, actual), parts };
}

function quarterOf(month: string): number {
    return Math.floor((Number(month.slice(5, 7)) - 1) / 3);
}

/**
 * Scores a reading against the readings a case accepts: the first it matches whole, else the
 * one it matches best, with the expected meaning it was scored against.
 */
export function scoreCase(
    expected: readonly Meaning[],
    actual: Meaning
): CaseScore & { against: Meaning } {
    let best: (CaseScore & { against: Meaning }) | undefined;
    for (const meaning of expected) {
        const score = { ...scoreOne(meaning, actual), against: meaning };
        if (score.whole) {
            return score;
        }
        if (!best || rank(score) > rank(best)) {
            best = score;
        }
    }
    if (!best) {
        throw new Error('A case needs an expected reading');
    }
    return best;
}

function rank(score: CaseScore): number {
    return (score.period ? 100 : 0) + Object.values(score.parts).filter(Boolean).length;
}

/** One case of a run, as written to its JSON file. */
export interface CaseResult {
    /** 1-based, in the order of the cases. */
    number: number;
    /** The case's identity across runs: its today and its request. */
    key: string;
    prompt: string;
    language: string;
    category: string;
    today: IsoDate;
    group?: string;
    expected: Meaning;
    /** The parts the mode read, or why it read none. */
    answer?: PeriodAnswer;
    actual: Meaning;
    score: CaseScore;
    /** The model's judgments, as text, for misses. */
    judgments: Record<string, string>;
    latencyMs?: number;
    inputTokens?: number;
    requestCharacters?: number;
    error?: string;
}

export interface Tally {
    hits: number;
    total: number;
}

export interface Summary {
    cases: number;
    whole: Tally;
    period: Tally;
    parts: Record<Part, Tally>;
    byCategory: Record<string, Tally>;
    byLanguage: Record<string, Tally>;
    consistency: {
        groups: number;
        consistent: number;
        disagreeing: { group: string; members: { prompt: string; reads: string }[] }[];
    };
    latencyMs?: Percentiles;
    inputTokens?: Percentiles;
    requestCharacters?: Percentiles;
    errors: number;
}

export interface Percentiles {
    p50: number;
    p95: number;
    max: number;
}

function tally(): Tally {
    return { hits: 0, total: 0 };
}

function count(target: Tally, ok: boolean): void {
    target.total++;
    target.hits += ok ? 1 : 0;
}

export function percentile(values: readonly number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[
        Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))
    ];
}

function percentiles(values: readonly (number | undefined)[]): Percentiles | undefined {
    const known = values.filter((value): value is number => value !== undefined);
    if (known.length === 0) {
        return undefined;
    }
    return {
        p50: percentile(known, 50),
        p95: percentile(known, 95),
        max: Math.max(...known),
    };
}

/**
 * Accuracy per part, per whole request, per category and per language; consistency, the share
 * of paraphrase groups whose members all read the same thing; and latency and request size.
 */
export function summarize(results: readonly CaseResult[]): Summary {
    const parts = Object.fromEntries(PARTS.map(part => [part, tally()])) as Record<Part, Tally>;
    const summary: Summary = {
        cases: results.length,
        whole: tally(),
        period: tally(),
        parts,
        byCategory: {},
        byLanguage: {},
        consistency: { groups: 0, consistent: 0, disagreeing: [] },
        errors: results.filter(result => result.error !== undefined).length,
    };
    const groups = new Map<string, CaseResult[]>();
    for (const result of results) {
        count(summary.whole, result.score.whole);
        count(summary.period, result.score.period);
        for (const part of PARTS) {
            const ok = result.score.parts[part];
            if (ok !== undefined) {
                count(parts[part], ok);
            }
        }
        count((summary.byCategory[result.category] ??= tally()), result.score.whole);
        count((summary.byLanguage[result.language] ??= tally()), result.score.whole);
        if (result.group !== undefined) {
            groups.set(result.group, [...(groups.get(result.group) ?? []), result]);
        }
    }
    for (const [group, members] of groups) {
        if (members.length < 2) {
            continue;
        }
        summary.consistency.groups++;
        if (members.every(member => sameMeaning(member.actual, members[0].actual))) {
            summary.consistency.consistent++;
        } else {
            summary.consistency.disagreeing.push({
                group,
                members: members.map(member => ({
                    prompt: member.prompt,
                    reads: describeMeaning(member.actual),
                })),
            });
        }
    }
    const latency = percentiles(results.map(result => result.latencyMs));
    const tokens = percentiles(results.map(result => result.inputTokens));
    const characters = percentiles(results.map(result => result.requestCharacters));
    return {
        ...summary,
        ...(latency ? { latencyMs: latency } : {}),
        ...(tokens ? { inputTokens: tokens } : {}),
        ...(characters ? { requestCharacters: characters } : {}),
    };
}

function describeDates(dates: QueryDates): string {
    const to = dates.beforeDay ? `${dates.last} (before ${dates.beforeDay})` : dates.last;
    if (dates.first === undefined) {
        return `…${to}`;
    }
    return dates.first === dates.last && !dates.beforeDay ? dates.first : `${dates.first}…${to}`;
}

/** The months a reading reads, for people: `2026-01…2026-11 vs 2025-01…2025-11`. */
export function describeMeaning(meaning: Meaning): string {
    if (meaning.reason) {
        return meaning.reason;
    }
    const period = meaning.period ? describeDates(meaning.period) : '?';
    const comparison = meaning.comparison
        ? describeDates(meaning.comparison)
        : (meaning.comparisonError ?? 'nothing');
    return `${period} vs ${comparison}`;
}

/** A run as written to its JSON file. */
export interface RunFile {
    mode: string;
    models: string[];
    startedAt: string;
    results: CaseResult[];
    summary: Summary;
}

export interface RunComparison {
    rows: { name: string; a?: Tally; b?: Tally }[];
    better: CaseResult[];
    worse: CaseResult[];
}

/**
 * Two runs side by side: whole accuracy overall, per part, per category and per language, and
 * consistency; and the requests (by today and request) that one got right and the other wrong.
 */
export function compareRuns(a: RunFile, b: RunFile): RunComparison {
    const categories = [
        ...new Set([...Object.keys(a.summary.byCategory), ...Object.keys(b.summary.byCategory)]),
    ];
    const languages = [
        ...new Set([...Object.keys(a.summary.byLanguage), ...Object.keys(b.summary.byLanguage)]),
    ];
    const rows = [
        { name: 'whole', a: a.summary.whole, b: b.summary.whole },
        { name: 'period', a: a.summary.period, b: b.summary.period },
        ...PARTS.map(part => ({ name: part, a: a.summary.parts[part], b: b.summary.parts[part] })),
        ...categories.map(category => ({
            name: `category ${category}`,
            a: a.summary.byCategory[category],
            b: b.summary.byCategory[category],
        })),
        ...languages.map(language => ({
            name: `language ${language}`,
            a: a.summary.byLanguage[language],
            b: b.summary.byLanguage[language],
        })),
        {
            name: 'consistency',
            a: { hits: a.summary.consistency.consistent, total: a.summary.consistency.groups },
            b: { hits: b.summary.consistency.consistent, total: b.summary.consistency.groups },
        },
    ];
    const before = new Map(a.results.map(result => [result.key, result]));
    const better: CaseResult[] = [];
    const worse: CaseResult[] = [];
    for (const result of b.results) {
        const earlier = before.get(result.key);
        if (!earlier || earlier.score.whole === result.score.whole) {
            continue;
        }
        (result.score.whole ? better : worse).push(result);
    }
    return { rows, better, worse };
}

export function percent(value: Tally | undefined): string {
    if (!value || value.total === 0) {
        return '-';
    }
    return `${((100 * value.hits) / value.total).toFixed(1)}% (${value.hits}/${value.total})`;
}
