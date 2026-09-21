import type { AppContext } from '../app-context';
import { elapsedMilliseconds } from '../observability';
import {
    collectCandidateTransactions,
    filterEligibleTransactions,
    type SkippedCounts,
} from './candidate-service';
import { analyzeCandidateTransactions, BkperAiError } from './bkper-ai-service';
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
    const monitor = context.performanceMonitor;
    const startedAt = monitor.now();
    let phase = 'book';
    monitor.log('analysis.started', { submittedTransactions: request.transactions.length });

    try {
        const book = await context.bkper.getBook(request.bookId, true, true);
        requireAnalyzePermission(book);
        const bookLoadedAt = monitor.now();

        phase = 'candidates';
        const effectiveLockDate = mostRecentDate(book.getLockDate(), book.getClosingDate());
        const filtered = filterEligibleTransactions(request.transactions, effectiveLockDate);
        const candidates = collectCandidateTransactions([], filtered.transactions);
        const candidatesReadyAt = monitor.now();
        if (candidates.pairCount === 0) {
            const completedAt = monitor.now();
            monitor.log('analysis.completed', {
                submittedTransactions: request.transactions.length,
                eligibleTransactions: filtered.transactions.length,
                skippedTransactions: filtered.skipped.total,
                candidateTransactions: 0,
                candidatePairs: 0,
                learningExamples: 0,
                jevBatches: 0,
                suggestions: 0,
                bookMs: elapsedMilliseconds(startedAt, bookLoadedAt),
                candidateMs: elapsedMilliseconds(bookLoadedAt, candidatesReadyAt),
                learningMs: 0,
                jevMs: 0,
                totalMs: elapsedMilliseconds(startedAt, completedAt),
            });
            return { suggestions: [], skipped: filtered.skipped };
        }

        const originalsById = new Map(
            request.transactions.map(transaction => [transaction.id, transaction] as const)
        );
        phase = 'learning';
        const learningExamples = await collectApplicableLearningExamples(
            book,
            candidates.transactions
        );
        const learningReadyAt = monitor.now();

        phase = 'jev';
        const analysis = await analyzeCandidateTransactions(
            candidates.transactions,
            learningExamples,
            context.aiFetch,
            monitor
        );
        const jevReadyAt = monitor.now();

        phase = 'suggestions';
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
        const completedAt = monitor.now();
        monitor.log('analysis.completed', {
            submittedTransactions: request.transactions.length,
            eligibleTransactions: filtered.transactions.length,
            skippedTransactions: filtered.skipped.total,
            candidateTransactions: candidates.transactions.length,
            candidatePairs: candidates.pairCount,
            learningExamples: learningExamples.length,
            jevBatches: analysis.batchCount,
            suggestions: suggestions.length,
            bookMs: elapsedMilliseconds(startedAt, bookLoadedAt),
            candidateMs: elapsedMilliseconds(bookLoadedAt, candidatesReadyAt),
            learningMs: elapsedMilliseconds(candidatesReadyAt, learningReadyAt),
            jevMs: elapsedMilliseconds(learningReadyAt, jevReadyAt),
            totalMs: elapsedMilliseconds(startedAt, completedAt),
        });

        return { suggestions, skipped: filtered.skipped };
    } catch (error) {
        monitor.log('analysis.failed', {
            phase,
            errorCode: analysisErrorCode(error),
            totalMs: elapsedMilliseconds(startedAt, monitor.now()),
        });
        throw error;
    }
}

function mostRecentDate(first: string | undefined, second: string | undefined): string | undefined {
    if (!first) return second;
    if (!second) return first;
    return first >= second ? first : second;
}

function analysisErrorCode(error: unknown): string {
    if (error instanceof BkperAiError) return error.code;
    return error instanceof Error ? error.name : 'unexpected_error';
}
