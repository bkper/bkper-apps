import { Amount } from 'bkper-js';

export type AccountSnapshotType = NonNullable<bkper.Account['type']>;

export interface AccountSnapshot {
    id: string;
    name: string;
    type?: AccountSnapshotType;
}

export interface TransactionFingerprint {
    id: string;
    date: string;
    dateFormatted?: string;
    amount: string;
    amountFormatted?: string;
    description: string;
    fromAccount: AccountSnapshot | null;
    toAccount: AccountSnapshot | null;
    properties: Record<string, string>;
    draft: boolean;
}

export interface SkippedCounts {
    total: number;
    trashed: number;
    checked: number;
    locked: number;
    invalid: number;
}

export function filterEligibleTransactions(
    transactions: readonly bkper.Transaction[],
    lockDate?: string
): { transactions: TransactionFingerprint[]; skipped: SkippedCounts } {
    const skipped: SkippedCounts = {
        total: 0,
        trashed: 0,
        checked: 0,
        locked: 0,
        invalid: 0,
    };
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
        if (fingerprint) {
            eligible.push(fingerprint);
        } else {
            skipped.invalid += 1;
            skipped.total += 1;
        }
    }

    return { transactions: eligible, skipped };
}

export function collectCandidateTransactions(
    previous: readonly (TransactionFingerprint | bkper.Transaction)[],
    current: readonly (TransactionFingerprint | bkper.Transaction)[]
): { transactions: TransactionFingerprint[]; pairCount: number } {
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
    const transactions = [...byId.values()];
    const candidateIds = new Set<string>();
    let pairCount = 0;

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
            candidateIds.add(first.id);
            candidateIds.add(second.id);
            pairCount += 1;
        }
    }

    return {
        transactions: transactions.filter(transaction => candidateIds.has(transaction.id)),
        pairCount,
    };
}

export function toFingerprint(transaction: bkper.Transaction): TransactionFingerprint | undefined {
    const id = cleanRequired(transaction.id);
    const date = cleanRequired(transaction.date);
    const amount = normalizeAmount(transaction.amount);
    if (!id || !date || !amount || !parseIsoDate(date)) return undefined;

    return {
        id,
        date,
        ...(transaction.dateFormatted
            ? { dateFormatted: cleanText(transaction.dateFormatted) }
            : {}),
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

export function isPlausiblePair(
    first: TransactionFingerprint,
    second: TransactionFingerprint
): boolean {
    if (!equalAmounts(first.amount, second.amount)) return false;
    if (calendarDayDistance(first.date, second.date) > 7) return false;

    const sameFrom = sharedAccount(first.fromAccount, second.fromAccount);
    const sameTo = sharedAccount(first.toAccount, second.toAccount);
    if (sameFrom || sameTo) return true;

    return (
        (first.draft || second.draft) &&
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
    return {
        id,
        name: cleanText(account?.name ?? ''),
        ...(account?.type ? { type: account.type } : {}),
    };
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
