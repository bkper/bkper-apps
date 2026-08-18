import { AccountType, Amount, Permission } from 'bkper-js';
import type { AppContext } from '../app-context';
import {
    collectCandidateTransactions,
    filterEligibleTransactions,
    type AccountSnapshot,
    type AccountSnapshotType,
    type SkippedCounts,
    type TransactionFingerprint,
} from './candidate-service';
import { analyzeCandidateTransactions, PROMPT_VERSION } from './bkper-ai-service';
import { collectApplicableLearningExamples } from './learning-service';
import { requireScanPermission } from './permission-service';

export interface ScanRequest {
    bookId: string;
    query: string;
    cursor?: string | null;
    fingerprints: TransactionFingerprint[];
}

export interface ScanSuggestion {
    id: string;
    strength: 'Strong' | 'Possible';
    explanation: string;
    first: TransactionFingerprint;
    second: TransactionFingerprint;
}

export type ScanPermission = 'OWNER' | 'EDITOR' | 'POSTER';

export interface ScanResult {
    permission: ScanPermission;
    suggestions: ScanSuggestion[];
    fingerprints: TransactionFingerprint[];
    cursor?: string;
    scanned: number;
    candidateCount: number;
    skipped: SkippedCounts;
    promptVersion: string;
}

export async function scanTransactions(
    context: AppContext,
    request: ScanRequest
): Promise<ScanResult> {
    const book = await context.bkper.getBook(request.bookId, true, true);
    requireScanPermission(book);

    const page = await book.listTransactions(request.query, 200, request.cursor ?? undefined);
    const transactions = page.getItems();
    const effectiveLockDate = mostRecentDate(book.getLockDate(), book.getClosingDate());
    const filtered = filterEligibleTransactions(
        transactions.map(transaction => transaction.json()),
        effectiveLockDate
    );
    const accountSnapshots = new Map<string, AccountSnapshot>();
    for (const account of await book.getAccounts()) {
        const accountId = account.getId();
        if (!accountId) continue;
        accountSnapshots.set(accountId, {
            id: accountId,
            name: account.getName() ?? '',
            type: toAccountSnapshotType(account.getType()),
        });
    }
    const transactionsWithDisplayMetadata = filtered.transactions.map(transaction => ({
        ...transaction,
        amountFormatted: book.formatValue(new Amount(transaction.amount)),
        fromAccount: withAccountMetadata(transaction.fromAccount, accountSnapshots),
        toAccount: withAccountMetadata(transaction.toAccount, accountSnapshots),
    }));
    const cumulativeTransactions = mergeFingerprints(
        request.fingerprints,
        transactionsWithDisplayMetadata
    );
    const cumulativeCandidates = collectCandidateTransactions([], cumulativeTransactions);
    const pageCandidateCount = collectCandidateTransactions(
        request.fingerprints,
        transactionsWithDisplayMetadata
    ).pairCount;

    let suggestions: ScanSuggestion[] = [];
    if (cumulativeCandidates.pairCount > 0) {
        const candidateTransactions = cumulativeCandidates.transactions;
        await book.getGroups();
        const learningExamples = await collectApplicableLearningExamples(
            book,
            candidateTransactions
        );
        const analysis = await analyzeCandidateTransactions(
            candidateTransactions,
            learningExamples,
            context.aiFetch
        );
        suggestions = analysis.pairs.map(pair => {
            const [first, second] = canonicalPair(
                candidateTransactions[pair.firstIndex],
                candidateTransactions[pair.secondIndex]
            );
            return {
                id: `${first.id}|${second.id}`,
                strength: pair.strength,
                explanation: pair.explanation,
                first,
                second,
            };
        });
    }

    const cursor = page.getCursor();
    return {
        permission: toScanPermission(book.getPermission()),
        suggestions,
        fingerprints: transactionsWithDisplayMetadata,
        ...(cursor ? { cursor } : {}),
        scanned: transactions.length,
        candidateCount: pageCandidateCount,
        skipped: filtered.skipped,
        promptVersion: PROMPT_VERSION,
    };
}

function mergeFingerprints(
    previous: readonly TransactionFingerprint[],
    current: readonly TransactionFingerprint[]
): TransactionFingerprint[] {
    const merged = new Map<string, TransactionFingerprint>();
    for (const transaction of [...previous, ...current]) {
        merged.set(transaction.id, transaction);
    }
    return [...merged.values()];
}

function canonicalPair(
    first: TransactionFingerprint,
    second: TransactionFingerprint
): [TransactionFingerprint, TransactionFingerprint] {
    return first.id.localeCompare(second.id) <= 0 ? [first, second] : [second, first];
}

function toAccountSnapshotType(type: AccountType): AccountSnapshotType {
    switch (type) {
        case AccountType.ASSET:
            return 'ASSET';
        case AccountType.LIABILITY:
            return 'LIABILITY';
        case AccountType.INCOMING:
            return 'INCOMING';
        case AccountType.OUTGOING:
            return 'OUTGOING';
    }
}

function withAccountMetadata(
    account: AccountSnapshot | null,
    accountSnapshots: ReadonlyMap<string, AccountSnapshot>
): AccountSnapshot | null {
    if (!account) return null;
    const snapshot = accountSnapshots.get(account.id);
    if (!snapshot) return account;
    return {
        ...account,
        name: account.name || snapshot.name,
        type: account.type ?? snapshot.type,
    };
}

function toScanPermission(permission: Permission): ScanPermission {
    if (permission === Permission.OWNER) return 'OWNER';
    if (permission === Permission.EDITOR) return 'EDITOR';
    if (permission === Permission.POSTER) return 'POSTER';
    throw new Error(`Unexpected scan permission: ${permission}.`);
}

function mostRecentDate(first: string | undefined, second: string | undefined): string | undefined {
    if (!first) return second;
    if (!second) return first;
    return first >= second ? first : second;
}
