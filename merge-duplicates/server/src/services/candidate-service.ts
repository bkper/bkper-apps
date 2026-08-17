import { Amount } from 'bkper-js';

export interface AccountSnapshot {
    id: string;
    name: string;
}

export interface TransactionFingerprint {
    id: string;
    date: string;
    amount: string;
    description: string;
    fromAccount: AccountSnapshot | null;
    toAccount: AccountSnapshot | null;
    properties: Record<string, string>;
    draft: boolean;
}

export interface CandidatePair {
    key: string;
    first: TransactionFingerprint;
    second: TransactionFingerprint;
}

export interface SkippedCounts {
    total: number;
    trashed: number;
    checked: number;
    locked: number;
}

export interface CandidateEvaluation {
    pairIndex: number;
    duplicate: boolean;
    strength: 'Strong' | 'Possible';
    explanation: string;
}

export interface DuplicateSuggestion extends CandidatePair {
    id: string;
    strength: 'Strong' | 'Possible';
    explanation: string;
}

export function filterEligibleTransactions(
    transactions: readonly bkper.Transaction[],
    lockDate?: string
): { transactions: TransactionFingerprint[]; skipped: SkippedCounts } {
    const skipped: SkippedCounts = { total: 0, trashed: 0, checked: 0, locked: 0 };
    const eligible: TransactionFingerprint[] = [];

    for (const transaction of transactions) {
        if (transaction.trashed) {
            skipped.trashed += 1;
            skipped.total += 1;
            continue;
        }
        if (transaction.checked) {
            skipped.checked += 1;
            skipped.total += 1;
            continue;
        }
        if (isLocked(transaction.date, lockDate)) {
            skipped.locked += 1;
            skipped.total += 1;
            continue;
        }
        const fingerprint = toFingerprint(transaction);
        if (fingerprint) eligible.push(fingerprint);
    }

    return { transactions: eligible, skipped };
}

export function generateCandidatePairs(
    previous: readonly (TransactionFingerprint | bkper.Transaction)[],
    current: readonly (TransactionFingerprint | bkper.Transaction)[]
): CandidatePair[] {
    const toFingerprints = (
        items: readonly (TransactionFingerprint | bkper.Transaction)[]
    ): TransactionFingerprint[] =>
        items
            .map(item => (isFingerprint(item) ? item : toFingerprint(item)))
            .filter((item): item is TransactionFingerprint => item !== undefined);
    const previousFingerprints = toFingerprints(previous);
    const currentFingerprints = toFingerprints(current);
    const currentIds = new Set(currentFingerprints.map(item => item.id));
    const byId = new Map<string, TransactionFingerprint>();
    for (const transaction of [...previousFingerprints, ...currentFingerprints]) {
        byId.set(transaction.id, transaction);
    }
    const transactions = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
    const pairs: CandidatePair[] = [];

    for (let firstIndex = 0; firstIndex < transactions.length; firstIndex += 1) {
        for (
            let secondIndex = firstIndex + 1;
            secondIndex < transactions.length;
            secondIndex += 1
        ) {
            const first = transactions[firstIndex];
            const second = transactions[secondIndex];
            if (!currentIds.has(first.id) && !currentIds.has(second.id)) continue;
            if (!isPlausiblePair(first, second)) continue;
            pairs.push({ key: `${first.id}|${second.id}`, first, second });
        }
    }

    return pairs;
}

export function retainNonOverlappingSuggestions(
    pairs: readonly CandidatePair[],
    evaluations: readonly CandidateEvaluation[]
): DuplicateSuggestion[] {
    const ranked = evaluations
        .filter(evaluation => evaluation.duplicate && pairs[evaluation.pairIndex] !== undefined)
        .sort((left, right) => {
            const strengthDifference = strengthRank(left.strength) - strengthRank(right.strength);
            return strengthDifference || left.pairIndex - right.pairIndex;
        });
    const used = new Set<string>();
    const retained: DuplicateSuggestion[] = [];

    for (const evaluation of ranked) {
        const pair = pairs[evaluation.pairIndex];
        if (used.has(pair.first.id) || used.has(pair.second.id)) continue;
        used.add(pair.first.id);
        used.add(pair.second.id);
        retained.push({
            ...pair,
            id: pair.key,
            strength: evaluation.strength,
            explanation: cleanExplanation(evaluation.explanation),
        });
    }

    return retained;
}

function toFingerprint(transaction: bkper.Transaction): TransactionFingerprint | undefined {
    const id = cleanRequired(transaction.id);
    const date = cleanRequired(transaction.date);
    const amount = normalizeAmount(transaction.amount);
    if (!id || !date || !amount || !parseIsoDate(date)) return undefined;

    return {
        id,
        date,
        amount,
        description: cleanText(transaction.description ?? ''),
        fromAccount: toAccountSnapshot(transaction.creditAccount),
        toAccount: toAccountSnapshot(transaction.debitAccount),
        properties: visibleProperties(transaction.properties),
        draft: transaction.posted !== true,
    };
}

function isFingerprint(
    value: TransactionFingerprint | bkper.Transaction
): value is TransactionFingerprint {
    return 'fromAccount' in value && 'toAccount' in value && 'draft' in value;
}

function isPlausiblePair(first: TransactionFingerprint, second: TransactionFingerprint): boolean {
    if (!equalAmounts(first.amount, second.amount)) return false;
    if (calendarDayDistance(first.date, second.date) > 7) return false;

    const sameFrom = sharedAccount(first.fromAccount, second.fromAccount);
    const sameTo = sharedAccount(first.toAccount, second.toAccount);
    if (sameFrom || sameTo) return true;

    const firstIncomplete = first.draft && (!first.fromAccount || !first.toAccount);
    const secondIncomplete = second.draft && (!second.fromAccount || !second.toAccount);
    return (
        (firstIncomplete || secondIncomplete) &&
        first.description.trim().length > 0 &&
        second.description.trim().length > 0
    );
}

function sharedAccount(first: AccountSnapshot | null, second: AccountSnapshot | null): boolean {
    return first !== null && second !== null && first.id === second.id;
}

function equalAmounts(first: string, second: string): boolean {
    try {
        return new Amount(first).eq(new Amount(second));
    } catch {
        return false;
    }
}

function normalizeAmount(value: string | undefined): string | undefined {
    if (!value?.trim()) return undefined;
    try {
        return new Amount(value).toString();
    } catch {
        return undefined;
    }
}

function calendarDayDistance(first: string, second: string): number {
    const firstTime = parseIsoDate(first)?.getTime();
    const secondTime = parseIsoDate(second)?.getTime();
    if (firstTime === undefined || secondTime === undefined) return Number.POSITIVE_INFINITY;
    return Math.abs(firstTime - secondTime) / 86_400_000;
}

function parseIsoDate(value: string): Date | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return undefined;
    }
    return date;
}

function isLocked(transactionDate: string | undefined, lockDate: string | undefined): boolean {
    if (!lockDate) return false;
    const effectiveDate = transactionDate ?? new Date().toISOString().slice(0, 10);
    const transaction = parseIsoDate(effectiveDate);
    const lock = parseIsoDate(lockDate);
    return transaction !== undefined && lock !== undefined && transaction <= lock;
}

function toAccountSnapshot(account: bkper.Account | undefined): AccountSnapshot | null {
    const id = cleanRequired(account?.id);
    if (!id) return null;
    return { id, name: cleanText(account?.name ?? '') };
}

function visibleProperties(properties: Record<string, string> | undefined): Record<string, string> {
    return Object.fromEntries(
        Object.entries(properties ?? {})
            .filter(([key]) => !key.endsWith('_'))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [cleanText(key), cleanText(value)])
    );
}

function cleanRequired(value: string | undefined): string | undefined {
    const cleaned = value?.trim();
    return cleaned ? cleaned : undefined;
}

function cleanText(value: string): string {
    return value.replace(/\s+/gu, ' ').trim();
}

function cleanExplanation(value: string): string {
    const cleaned = cleanText(value);
    return cleaned.length <= 180 ? cleaned : `${cleaned.slice(0, 179)}…`;
}

function strengthRank(strength: 'Strong' | 'Possible'): number {
    return strength === 'Strong' ? 0 : 1;
}
