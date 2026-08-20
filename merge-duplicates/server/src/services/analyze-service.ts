import type { AppContext } from '../app-context';
import {
    collectCandidateTransactions,
    filterEligibleTransactions,
    type SkippedCounts,
} from './candidate-service';
import { analyzeCandidateTransactions } from './bkper-ai-service';
import { collectApplicableLearningExamples } from './learning-service';
import { requireAnalyzePermission } from './permission-service';

export interface AnalyzeRequest {
    bookId: string;
    transactions: bkper.Transaction[];
}

export interface AnalyzeSuggestion {
    transactions: [bkper.Transaction, bkper.Transaction];
    strength: 'Strong' | 'Possible';
    explanation: string;
}

export interface AnalyzeResult {
    suggestions: AnalyzeSuggestion[];
    skipped: SkippedCounts;
}

export async function analyzeTransactions(
    context: AppContext,
    request: AnalyzeRequest
): Promise<AnalyzeResult> {
    const book = await context.bkper.getBook(request.bookId, true, true);
    requireAnalyzePermission(book);

    const effectiveLockDate = mostRecentDate(book.getLockDate(), book.getClosingDate());
    const filtered = filterEligibleTransactions(request.transactions, effectiveLockDate);
    const candidates = collectCandidateTransactions([], filtered.transactions);
    if (candidates.pairCount === 0) {
        return { suggestions: [], skipped: filtered.skipped };
    }

    const originalsById = new Map(
        request.transactions.map(transaction => [transaction.id, transaction] as const)
    );
    const learningExamples = await collectApplicableLearningExamples(book, candidates.transactions);
    const analysis = await analyzeCandidateTransactions(
        candidates.transactions,
        learningExamples,
        context.aiFetch
    );
    const suggestions = analysis.pairs.map(pair => {
        const firstFingerprint = candidates.transactions[pair.firstIndex];
        const secondFingerprint = candidates.transactions[pair.secondIndex];
        const first = originalsById.get(firstFingerprint.id);
        const second = originalsById.get(secondFingerprint.id);
        if (!first || !second) {
            throw new Error('Analyzed transaction payload could not be restored.');
        }
        return {
            transactions: [first, second] as [bkper.Transaction, bkper.Transaction],
            strength: pair.strength,
            explanation: pair.explanation,
        };
    });

    return { suggestions, skipped: filtered.skipped };
}

function mostRecentDate(first: string | undefined, second: string | undefined): string | undefined {
    if (!first) return second;
    if (!second) return first;
    return first >= second ? first : second;
}
