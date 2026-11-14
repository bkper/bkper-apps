/**
 * Scores Bookbot's account discovery on frozen cases from real Books, and compares a variant with a
 * baseline against the agreed target. Pure: no I/O, no Book or model calls.
 */

export type Verdict = 'right' | 'wrong' | 'none';
/** Where in the search ladder the deciding search ran, from the closest history to the whole Book. */
export type SearchLevel = 'known account and creator' | 'known account' | 'whole Book';
/** What the deciding search looked for. */
export type SearchTerm = 'description' | 'description part' | 'hashtag';

/** How a suggestion was made: the deciding search, and whether Jev ranked several options. */
export interface Decision {
    level: SearchLevel;
    term: SearchTerm;
    /** Options the deciding search found; 1 means filled without Jev. */
    options: number;
    confidence: number;
}

export interface CaseResult {
    /** The Book's label in the private dataset. */
    book: string;
    caseId: string;
    expectedAccountId: string;
    suggestedAccountId?: string;
    verdict: Verdict;
    decision?: Decision;
    error?: string;
}

export interface Tally {
    cases: number;
    right: number;
    wrong: number;
    none: number;
    errors: number;
}

/**
 * The agreed target for a change: at least a quarter fewer wrong suggestions, at most 1% fewer
 * right answers, and fewer wrong suggestions that are not chance (exact McNemar, p < 0.01).
 */
export const TARGET = { wrongReduction: 0.25, maxRightLoss: 0.01, maxPValue: 0.01 } as const;

export function verdictOf(expectedAccountId: string, suggestedAccountId: string | undefined): Verdict {
    if (!suggestedAccountId) return 'none';
    return suggestedAccountId === expectedAccountId ? 'right' : 'wrong';
}

export function tally(results: CaseResult[]): Tally {
    return {
        cases: results.length,
        right: results.filter(result => result.verdict === 'right').length,
        wrong: results.filter(result => result.verdict === 'wrong').length,
        none: results.filter(result => result.verdict === 'none').length,
        errors: results.filter(result => result.error).length,
    };
}

/** Share of suggestions that were wrong; no-guess cases are not suggestions. */
export function wrongShare(counts: Pick<Tally, 'right' | 'wrong'>): number {
    const suggestions = counts.right + counts.wrong;
    return suggestions === 0 ? 0 : counts.wrong / suggestions;
}

function logChoose(n: number, k: number): number {
    let sum = 0;
    for (let i = 1; i <= k; i++) sum += Math.log(n - k + i) - Math.log(i);
    return sum;
}

/**
 * Exact two-sided McNemar test: `improved` cases changed one way and `worsened` the other way.
 * Computed in log space so a thousand discordant cases do not overflow.
 */
export function exactMcNemar(improved: number, worsened: number): number {
    const n = improved + worsened;
    if (n === 0) return 1;
    const k = Math.max(improved, worsened);
    let tail = 0;
    for (let i = k; i <= n; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
    return Math.min(1, 2 * tail);
}

export interface Comparison {
    baseline: Tally;
    variant: Tally;
    /** Cases wrong in the baseline and not wrong in the variant, and the reverse. */
    wrongRemoved: number;
    wrongAdded: number;
    rightGained: number;
    rightLost: number;
    pWrong: number;
    meetsTarget: boolean;
    checks: { label: string; passed: boolean }[];
}

function caseKey(result: CaseResult): string {
    return `${result.book}\u0000${result.caseId}`;
}

/** Pairs results case by case; both runs must cover exactly the same cases. */
export function compare(baselineResults: CaseResult[], variantResults: CaseResult[]): Comparison {
    const baselineByCase = new Map(baselineResults.map(result => [caseKey(result), result]));
    if (baselineByCase.size !== variantResults.length || variantResults.some(result => !baselineByCase.has(caseKey(result)))) {
        throw new Error('The baseline and the variant must cover the same cases.');
    }
    let wrongRemoved = 0, wrongAdded = 0, rightGained = 0, rightLost = 0;
    for (const variantResult of variantResults) {
        const baselineResult = baselineByCase.get(caseKey(variantResult))!;
        if (baselineResult.verdict === 'wrong' && variantResult.verdict !== 'wrong') wrongRemoved++;
        if (baselineResult.verdict !== 'wrong' && variantResult.verdict === 'wrong') wrongAdded++;
        if (baselineResult.verdict !== 'right' && variantResult.verdict === 'right') rightGained++;
        if (baselineResult.verdict === 'right' && variantResult.verdict !== 'right') rightLost++;
    }
    const baseline = tally(baselineResults);
    const variant = tally(variantResults);
    const pWrong = exactMcNemar(wrongRemoved, wrongAdded);
    const checks = [
        { label: `Wrong suggestions at most ${Math.floor(baseline.wrong * (1 - TARGET.wrongReduction))} (a quarter fewer than ${baseline.wrong})`, passed: variant.wrong <= baseline.wrong * (1 - TARGET.wrongReduction) },
        { label: `Right answers at least ${Math.ceil(baseline.right * (1 - TARGET.maxRightLoss))} (at most 1% fewer than ${baseline.right})`, passed: variant.right >= baseline.right * (1 - TARGET.maxRightLoss) },
        { label: `Fewer wrong suggestions with p < ${TARGET.maxPValue}`, passed: wrongRemoved > wrongAdded && pWrong < TARGET.maxPValue },
        { label: 'No errors in either run', passed: baseline.errors === 0 && variant.errors === 0 },
    ];
    return { baseline, variant, wrongRemoved, wrongAdded, rightGained, rightLost, pWrong, meetsTarget: checks.every(check => check.passed), checks };
}

const CONFIDENCE_BANDS = [
    { label: 'below 0.10 (about a coin flip)', below: 0.1 },
    { label: '0.10 to 0.30', below: 0.3 },
    { label: '0.30 to 0.60', below: 0.6 },
    { label: '0.60 and above', below: Infinity },
];

function percent(value: number): string {
    return `${(100 * value).toFixed(1)}%`;
}

function pValue(value: number): string {
    return value < 1e-4 ? value.toExponential(1) : value.toFixed(4);
}

function table(header: string[], rows: (string | number)[][]): string[] {
    return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)];
}

function tallyRow(label: string, counts: Tally): (string | number)[] {
    return [label, counts.cases, counts.right, counts.wrong, counts.none, percent(wrongShare(counts)), counts.errors];
}

/** Right and wrong suggestions per way of deciding, so the largest source of wrong suggestions is visible. */
function sourceRows(results: CaseResult[]): (string | number)[][] {
    const groups = new Map<string, { right: number; wrong: number }>();
    for (const result of results) {
        if (!result.decision || result.verdict === 'none') continue;
        const { decision } = result;
        const key = `${decision.options === 1 ? 'One option, filled without Jev' : 'Several options, ranked by Jev'} · ${decision.level} · ${decision.term}`;
        const group = groups.get(key) ?? { right: 0, wrong: 0 };
        group[result.verdict]++;
        groups.set(key, group);
    }
    return [...groups.entries()]
        .sort(([, left], [, right]) => right.wrong - left.wrong)
        .map(([key, counts]) => [key, counts.right, counts.wrong, percent(wrongShare(counts))]);
}

function confidenceRows(results: CaseResult[]): (string | number)[][] {
    const ranked = results.filter(result => result.decision && result.decision.options > 1 && result.verdict !== 'none');
    return CONFIDENCE_BANDS.map((band, index) => {
        const above = index === 0 ? -Infinity : CONFIDENCE_BANDS[index - 1].below;
        const inBand = ranked.filter(result => result.decision!.confidence >= above && result.decision!.confidence < band.below);
        const counts = { right: inBand.filter(result => result.verdict === 'right').length, wrong: inBand.filter(result => result.verdict === 'wrong').length };
        return [band.label, counts.right, counts.wrong, percent(wrongShare(counts))];
    });
}

/** The run's results as Markdown: totals per Book, where wrong suggestions come from, and the target check. */
export function renderReport(label: string, results: CaseResult[], baseline?: { label: string; results: CaseResult[] }): string {
    const books = [...new Set(results.map(result => result.book))];
    const lines = [
        `# Bookbot discovery on frozen Books: ${label}`,
        '',
        'Right, wrong and no guess against the Account people posted; the wrong share is wrong suggestions over all suggestions.',
        '',
        ...table(['Book', 'Cases', 'Right', 'Wrong', 'No guess', 'Wrong share', 'Errors'], [
            ...books.map(book => tallyRow(book, tally(results.filter(result => result.book === book)))),
            tallyRow('**All**', tally(results)),
        ]),
        '',
        '## Where suggestions come from',
        '',
        ...table(['Deciding search', 'Right', 'Wrong', 'Wrong share'], sourceRows(results)),
        '',
        '## Jev\'s confidence when it ranked several options',
        '',
        ...table(['Confidence', 'Right', 'Wrong', 'Wrong share'], confidenceRows(results)),
    ];
    if (baseline) {
        const comparison = compare(baseline.results, results);
        lines.push(
            '',
            `## Compared with ${baseline.label}`,
            '',
            ...table(['Run', 'Right', 'Wrong', 'No guess', 'Errors'], [
                [baseline.label, comparison.baseline.right, comparison.baseline.wrong, comparison.baseline.none, comparison.baseline.errors],
                [label, comparison.variant.right, comparison.variant.wrong, comparison.variant.none, comparison.variant.errors],
            ]),
            '',
            `Wrong suggestions removed ${comparison.wrongRemoved}, added ${comparison.wrongAdded} (exact McNemar p = ${pValue(comparison.pWrong)}). Right answers gained ${comparison.rightGained}, lost ${comparison.rightLost}.`,
            '',
            ...comparison.checks.map(check => `- ${check.passed ? 'Pass' : 'Fail'}: ${check.label}`),
            '',
            `**Target ${comparison.meetsTarget ? 'met' : 'not met'}.**`,
        );
    }
    return `${lines.join('\n')}\n`;
}
