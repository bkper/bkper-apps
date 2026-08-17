import { Permission } from 'bkper-js';
import type { AppContext } from '../app-context';
import {
    filterEligibleTransactions,
    generateCandidatePairs,
    retainNonOverlappingSuggestions,
    type SkippedCounts,
    type TransactionFingerprint,
} from './candidate-service';
import { analyzeCandidatePairs, PROMPT_VERSION } from './bkper-ai-service';
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
    const candidates = generateCandidatePairs(request.fingerprints, filtered.transactions);

    let suggestions: ScanSuggestion[] = [];
    if (candidates.length > 0) {
        await book.getGroups();
        await book.getAccounts();
        const learningExamples = await collectApplicableLearningExamples(
            book,
            candidates.flatMap(pair => [pair.first, pair.second])
        );
        const analysis = await analyzeCandidatePairs(candidates, learningExamples, context.aiFetch);
        suggestions = retainNonOverlappingSuggestions(candidates, analysis.evaluations).map(
            suggestion => ({
                id: suggestion.id,
                strength: suggestion.strength,
                explanation: suggestion.explanation,
                first: suggestion.first,
                second: suggestion.second,
            })
        );
    }

    const cursor = page.getCursor();
    return {
        permission: toScanPermission(book.getPermission()),
        suggestions,
        fingerprints: filtered.transactions,
        ...(cursor ? { cursor } : {}),
        scanned: transactions.length,
        candidateCount: candidates.length,
        skipped: filtered.skipped,
        promptVersion: PROMPT_VERSION,
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
