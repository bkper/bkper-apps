import { Account, Group, Transaction } from 'bkper-js';
import { AGENT_EXTRACTED_PROPERTY } from '../constants.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { isExactMatch, isSimilarString, stripAccountNamesFromDescription } from '../utils.js';
import { getAmountSignFromAccountSide } from '../utils/transaction-utils.js';
import { GenAIRequestContext } from '../genai/GenAITelemetry.js';
import type { InvoiceDescriptionPair, SemanticEvaluationService } from '../genai/JevEvaluationService.js';

/**
 * Details about a specific field regression.
 */
export interface RegressionDetail {
    field: string; // Field name (e.g., "date", "amount", "description", "vendor")
    original: unknown; // Original AI extraction value
    improved: unknown; // New AI extraction value (after prompt improvement)
    expected: unknown; // User-corrected value (the correct value)
}

/**
 * Comparison result for 3-way extraction comparison.
 * Tracks improvements, regressions, and matches between original, improved, and expected extractions.
 */
export interface ComparisonResult {
    improvements: number; // Properties that were wrong, now correct
    regressions: number; // Properties that were correct, now wrong
    matches: number; // Properties that stayed correct
    stillWrong: number; // Properties that are still wrong
    isImprovement: boolean; // true if improvements > 0 AND regressions === 0
    regressionDetails: RegressionDetail[]; // Detailed information about what regressed
}

export interface StringComparator {
    areSimilar(pairs: InvoiceDescriptionPair[], threshold?: number, context?: GenAIRequestContext): Promise<boolean[]>;
}

/**
 * Uses Jev's invoice-specific material-equivalence probability policy.
 * Syntactic similarity thresholds are intentionally ignored rather than
 * translated into evaluation probabilities.
 */
export class JevInvoiceDescriptionComparator implements StringComparator {
    constructor(private readonly evaluator: SemanticEvaluationService) {}

    async areSimilar(
        pairs: InvoiceDescriptionPair[],
        _syntacticThreshold?: number,
        context: GenAIRequestContext = {}
    ): Promise<boolean[]> {
        return this.evaluator.areInvoiceDescriptionsEquivalent(pairs, context);
    }
}

/**
 * Uses Jaro-Winkler syntactic similarity for statement descriptions.
 */
export class JaroWinklerStringComparator implements StringComparator {
    async areSimilar(pairs: InvoiceDescriptionPair[], threshold: number = 0.8): Promise<boolean[]> {
        return pairs.map(pair => isSimilarString(pair.first, pair.second, threshold));
    }
}
/**
 * Base class for prompt improvement services.
 * Centralizes common logic for transaction conversion and change detection.
 */
export abstract class PromptImprovementServiceBase {

    protected stringComparator: StringComparator;

    constructor(stringComparator: StringComparator) {
        this.stringComparator = stringComparator;
    }
    /**
     * Properties to skip when filtering transaction properties.
     * These are internal/structural properties that should not trigger prompt improvements.
     */
    protected static readonly SKIP_PROPERTIES = ['agent_', 'parsed_', 'account_id', 'group_id', 'upload_method', 'auto_filled_date_'];

    /**
     * Thresholds for prompt size monitoring.
     * When prompts exceed these values, warnings are logged to help identify when deduplication might be needed.
     */
    protected static readonly PROMPT_SIZE_THRESHOLDS = {
        bulletPoints: 40, // Warn when prompts exceed this many bullet points
        tokens: 1500, // Warn when prompts exceed this many tokens (rough estimate)
    };

    /**
     * Statement-only syntactic similarity thresholds for transaction comparison and validation.
     * Invoice descriptions use Jev's separate material-equivalence probability threshold.
     *
     * These thresholds control fuzzy matching behavior with length-based validation:
     * maxLengthDifference = 1 - threshold
     *
     * Example:
     * - 0.60 threshold → allows max 40% length difference
     * - 0.80 threshold → allows max 20% length difference
     * - 0.90 threshold → allows max 10% length difference
     */
    protected static readonly SIMILARITY_THRESHOLDS = {
        /**
         * Transaction Matching (Phase 1): Pairing transactions across datasets
         *
         * Lenient threshold (60%) used to identify which transactions correspond to each other
         * even when descriptions are significantly different. Allows 40% length difference.
         *
         * Use case: Finding the same logical transaction in different extraction results
         * Fallback: If matching fails, uses date+amount matching
         *
         * Used in:
         * - validateStatementExtractionPartial (transaction pairing)
         * - validateStatementExtraction (transaction pairing)
         */
        TRANSACTION_MATCHING: 0.6,

        /**
         * Field Validation (Phase 2): Validating field-level improvements
         *
         * Strict threshold (80%) used to determine if individual fields (especially descriptions)
         * have actually improved. Allows 20% length difference.
         *
         * Use case: After pairing transactions, validate if descriptions/fields improved
         * Critical: Prevents incomplete descriptions from being considered "good enough"
         *
         * Used in:
         * - compareExtractions (3-way field comparison in statements)
         */
        FIELD_VALIDATION: 0.8,

        /**
         * Change Detection: Detecting when user edits trigger prompt improvement
         *
         * Very strict threshold (90%) ensures only significant changes trigger re-training.
         * Allows 10% length difference.
         *
         * Use case: Determining if a transaction edit warrants flagging for improvement
         * Rationale: Avoid triggering improvement for minor formatting tweaks
         *
         * Used in:
         * - needsPromptImprovement (description comparison)
         */
        CHANGE_DETECTION: 0.9,
    } as const;


    /**
     * Check if a property should be skipped based on SKIP_PROPERTIES and user-defined skip keys.
     *
     * Hardcoded SKIP_PROPERTIES use prefix matching (startsWith) for backward compatibility.
     * User-defined skip keys use exact matching only.
     *
     * @param key - The property key to check
     * @param userDefinedSkipKeys - Optional array of user-defined property keys to skip (exact match)
     * @returns True if the property should be skipped, false otherwise
     */
    protected shouldSkipProperty(key: string, userDefinedSkipKeys?: string[]): boolean {
        // Hardcoded: prefix matching (existing behavior)
        const matchesHardcoded = PromptImprovementServiceBase.SKIP_PROPERTIES.some((prefix) => key.startsWith(prefix));
        if (matchesHardcoded) {
            return true;
        }

        // User-defined: exact matching only
        if (userDefinedSkipKeys && userDefinedSkipKeys.length > 0) {
            const normalizedKey = key.toLowerCase();
            return userDefinedSkipKeys.some((skipKey) => skipKey.trim().toLowerCase() === normalizedKey);
        }

        return false;
    }

    /**
     * Convert a Transaction to ExtractedTransaction format.
     * Strips account names from description to enable accurate comparison.
     *
     * @param transaction - The transaction to convert
     * @param account - The account for amount sign calculation
     * @param userDefinedSkipKeys - Optional array of user-defined property keys to skip
     * @returns ExtractedTransaction with transaction data
     */
    protected async transactionToExtractedTransaction(transaction: Transaction, account: Account | null, userDefinedSkipKeys?: string[]): Promise<ExtractedTransaction> {
        // transaction.getDate() already returns ISO format string (yyyy-MM-dd), no conversion needed
        const transactionDateStr = transaction.getDate() || null;

        // Get account names to strip from description
        const creditAccountName = await transaction.getCreditAccountName();
        const debitAccountName = await transaction.getDebitAccountName();

        // Get description and strip account names
        const rawDescription = transaction.getDescription() || '';
        const description = stripAccountNamesFromDescription(rawDescription, creditAccountName, debitAccountName);
        const amount = await getAmountSignFromAccountSide(transaction, account);

        const result: ExtractedTransaction = {
            date: transactionDateStr,
            description: description,
            amount: amount?.toNumber() || 0,
            properties: {},
        };

        const currentProperties = transaction.getProperties?.() || {};

        // Filter out SKIP_PROPERTIES and user-defined skip keys
        for (const key in currentProperties) {
            if (this.shouldSkipProperty(key, userDefinedSkipKeys)) continue;
            result.properties[key] = currentProperties[key];
        }

        return result;
    }

    protected getChangeDetectionThreshold(): number | undefined {
        return PromptImprovementServiceBase.SIMILARITY_THRESHOLDS.CHANGE_DETECTION;
    }

    async compareStrings(
        pairs: InvoiceDescriptionPair[],
        threshold?: number,
        context: GenAIRequestContext = {}
    ): Promise<boolean[]> {
        return this.stringComparator.areSimilar(pairs, threshold, context);
    }

    async compareString(
        str1: string,
        str2: string,
        threshold?: number,
        context: GenAIRequestContext = {}
    ): Promise<boolean> {
        const results = await this.compareStrings([{ first: str1, second: str2 }], threshold, context);
        return results[0] ?? false;
    }

    /**
     * Check if a transaction needs prompt improvement based on changes from AI extraction.
     * Compares current transaction state against the original AI extraction stored in properties.
     *
     * @param transaction - The transaction to check
     * @param userDefinedSkipKeys - Optional array of user-defined property keys to skip
     * @returns True if the transaction has changes that warrant prompt improvement
     */
    async needsPromptImprovement(transaction: Transaction, userDefinedSkipKeys?: string[]): Promise<boolean> {
        // Get the original AI extracted data from property
        const extractedJson = transaction.getProperty(AGENT_EXTRACTED_PROPERTY);

        if (!extractedJson) {
            return false; // No AI extraction stored, can't improve
        }

        try {
            const aiExtracted = JSON.parse(extractedJson) as ExtractedTransaction;

            // Get current transaction values
            // transaction.getDate() already returns ISO format string (yyyy-MM-dd), no conversion needed
            const currentDate = transaction.getDate() || null;
            const currentDescription = transaction.getDescription() || '';
            const currentAmount = transaction.getAmount()?.toNumber() || 0;

            // Check if core fields changed
            // Date requires EXACT match (financial data integrity)
            // Amount uses sign-agnostic comparison (absolute values must match)
            if (aiExtracted.date !== currentDate) return true;
            if (Math.abs(aiExtracted.amount) !== Math.abs(currentAmount)) return true;

            // Statements use strict syntactic matching; invoices use Jev material equivalence.
            // Only trigger improvement if the description changed materially.
            if (!await this.compareString(aiExtracted.description, currentDescription, this.getChangeDetectionThreshold())) {
                return true;
            }

            // Check if custom properties changed
            const currentProperties = transaction.getProperties?.() || {};
            const aiProperties = aiExtracted.properties || {};

            // Check if any AI-extracted property changed
            // Use STRICT/EXACT matching for property values (no fuzzy matching)
            for (const key in aiProperties) {
                const currentValue = currentProperties[key] || '';
                const aiValue = aiProperties[key];

                if (!isExactMatch(currentValue, aiValue)) {
                    return true;
                }
            }

            // Check if any new property was added (not in AI extraction)
            // Skip internal/structural properties and user-defined skip keys
            for (const key in currentProperties) {
                if (this.shouldSkipProperty(key, userDefinedSkipKeys)) continue;

                if (aiProperties[key] === undefined && currentProperties[key]) {
                    return true;
                }
            }

            return false; // Nothing changed significantly, no improvement needed
        } catch (e) {
            console.error('Failed to parse AGENT_EXTRACTED_PROPERTY:', e);
            return false;
        }
    }

    /**
     * Compare two ExtractedTransaction objects for exact match.
     * Used for validation in ACE pipeline to ensure improved prompt produces correct extraction.
     *
     * @param a - First extracted transaction
     * @param b - Second extracted transaction
     * @param descriptionSimilarityThreshold - Optional syntactic threshold used by statement comparison; invoice comparison uses its fixed Jev probability policy.
     * @returns True if transactions match exactly according to validation rules
     */
    async exactMatch(a: ExtractedTransaction, b: ExtractedTransaction, descriptionSimilarityThreshold?: number, context: GenAIRequestContext = {}): Promise<boolean> {
        // Date requires EXACT match (financial data integrity)
        if (a.date !== b.date) {
            return false;
        }
        // Amount uses sign-agnostic comparison (absolute values must match)
        if (Math.abs(a.amount) !== Math.abs(b.amount)) {
            return false;
        }

        // Description comparison is delegated by document kind:
        // statements use configurable Jaro-Winkler thresholds, while invoices use
        // a fixed Jev material-equivalence probability policy.
        if (!await this.compareString(a.description, b.description, descriptionSimilarityThreshold, context)) {
            return false;
        }

        // Property keys must match EXACTLY (schema consistency)
        const aProps = a.properties || {};
        const bProps = b.properties || {};

        const aKeys = Object.keys(aProps);
        const bKeys = Object.keys(bProps);

        // Must have same number of properties
        if (aKeys.length !== bKeys.length) {
            return false;
        }

        // All property keys must match exactly
        for (const key of aKeys) {
            if (!bKeys.includes(key)) {
                return false;
            }

            // STRICT/EXACT match for property values (no fuzzy matching)
            // Rationale: Properties require exact matches for data integrity
            // Numeric values compare absolute values (sign ignored): 3.50 matches -3.5
            // String values must match exactly (case-insensitive, whitespace trimmed)
            if (!isExactMatch(aProps[key], bProps[key])) {
                return false;
            }
        }

        return true;
    }

    /**
     * Compare three extractions to detect improvements and regressions (3-way comparison).
     * Enables partial improvement validation: accept prompt updates when properties improve without regressions.
     *
     * @param original - Original AI extraction (before prompt improvement)
     * @param improved - New AI extraction (after prompt improvement)
     * @param expected - User corrections (the correct values)
     * @param descriptionSimilarityThreshold - Optional syntactic threshold used by statement comparison; invoice comparison uses its fixed Jev probability policy.
     * @param userDefinedSkipKeys - Optional array of user-defined property keys to skip
     * @returns ComparisonResult with improvement details
     */
    async compareExtractions(original: ExtractedTransaction, improved: ExtractedTransaction, expected: ExtractedTransaction, descriptionSimilarityThreshold?: number, userDefinedSkipKeys?: string[], context: GenAIRequestContext = {}): Promise<ComparisonResult> {
        let improvements = 0;
        let regressions = 0;
        let matches = 0;
        let stillWrong = 0;
        const regressionDetails: RegressionDetail[] = [];

        // Helper: Check if a single property matches expected
        const dateMatches = (txn: ExtractedTransaction): boolean => txn.date === expected.date;
        const amountMatches = (txn: ExtractedTransaction): boolean => Math.abs(txn.amount) === Math.abs(expected.amount);
        const [origDescMatch, impDescMatch] = await this.compareStrings([
            { first: original.description, second: expected.description },
            { first: improved.description, second: expected.description },
        ], descriptionSimilarityThreshold, context);

        // Compare DATE
        const origDateMatch = dateMatches(original);
        const impDateMatch = dateMatches(improved);

        if (!origDateMatch && impDateMatch) {
            improvements++; // Was wrong, now correct
        } else if (origDateMatch && !impDateMatch) {
            regressions++; // Was correct, now wrong
            regressionDetails.push({
                field: 'date',
                original: original.date,
                improved: improved.date,
                expected: expected.date,
            });
        } else if (origDateMatch && impDateMatch) {
            matches++; // Was correct, still correct
        } else {
            stillWrong++; // Was wrong, still wrong
        }

        // Compare AMOUNT
        const origAmountMatch = amountMatches(original);
        const impAmountMatch = amountMatches(improved);

        if (!origAmountMatch && impAmountMatch) {
            improvements++;
        } else if (origAmountMatch && !impAmountMatch) {
            regressions++;
            regressionDetails.push({
                field: 'amount',
                original: original.amount,
                improved: improved.amount,
                expected: expected.amount,
            });
        } else if (origAmountMatch && impAmountMatch) {
            matches++;
        } else {
            stillWrong++;
        }

        // Compare DESCRIPTION
        if (!origDescMatch && impDescMatch) {
            improvements++;
        } else if (origDescMatch && !impDescMatch) {
            regressions++;
            regressionDetails.push({
                field: 'description',
                original: original.description,
                improved: improved.description,
                expected: expected.description,
            });
        } else if (origDescMatch && impDescMatch) {
            matches++;
        } else {
            stillWrong++;
        }

        // Compare CUSTOM PROPERTIES
        const origProps = original.properties || {};
        const impProps = improved.properties || {};
        const expProps = expected.properties || {};

        // Get all unique property keys from expected (filtering SKIP_PROPERTIES and user-defined skip keys)
        const expectedKeys = Object.keys(expProps).filter((key) => !this.shouldSkipProperty(key, userDefinedSkipKeys));

        // Check properties that are in expected (these should be present and correct)
        for (const key of expectedKeys) {
            const origValue = origProps[key];
            const impValue = impProps[key];
            const expValue = expProps[key];

            // Check if values match expected (using isExactMatch for consistency)
            const origMatch = origValue !== undefined && isExactMatch(origValue, expValue);
            const impMatch = impValue !== undefined && isExactMatch(impValue, expValue);

            if (!origMatch && impMatch) {
                improvements++; // Was missing/wrong, now correct
            } else if (origMatch && !impMatch) {
                regressions++; // Was correct, now wrong/missing
                regressionDetails.push({
                    field: key,
                    original: origValue,
                    improved: impValue,
                    expected: expValue,
                });
            } else if (origMatch && impMatch) {
                matches++; // Was correct, still correct
            } else {
                stillWrong++; // Was missing/wrong, still missing/wrong
            }
        }

        // Check for false positives: properties in original that should NOT be in expected
        // (AI over-extracted, user removed them, and improved prompt learned not to extract them)
        const originalKeys = Object.keys(origProps).filter((key) => !this.shouldSkipProperty(key, userDefinedSkipKeys));
        for (const key of originalKeys) {
            // Skip if this property is in expected (already handled above)
            if (expectedKeys.includes(key)) {
                continue;
            }

            // This property was in original but NOT in expected (false positive)
            const origValue = origProps[key];
            const impValue = impProps[key];

            if (origValue !== undefined && impValue === undefined) {
                // Was wrongly present in original, correctly absent in improved → IMPROVEMENT
                improvements++;
            } else if (origValue !== undefined && impValue !== undefined) {
                // Was wrongly present in original, still present in improved → STILL WRONG
                stillWrong++;
            }
            // Note: origValue === undefined cases don't exist here (we're iterating original keys)
        }

        // Calculate final result
        const isImprovement = improvements > 0 && regressions === 0;

        return {
            improvements,
            regressions,
            matches,
            stillWrong,
            isImprovement,
            regressionDetails,
        };
    }

    /**
     * Format regression details for logging.
     * Creates human-readable output showing what regressed and the values.
     *
     * @param regressionDetails - Array of regression details from ComparisonResult
     * @param transactionIdentifier - Optional identifier for the transaction (e.g., "Transaction #1 [2025-01-15, $150.00]")
     * @returns Formatted string with regression details
     */
    protected formatRegressionDetails(regressionDetails: RegressionDetail[], transactionIdentifier?: string): string {
        if (regressionDetails.length === 0) {
            return '';
        }

        let output = '\n📋 Regression Details:\n';

        if (transactionIdentifier) {
            output += `\n${transactionIdentifier}:\n`;
        }

        for (const detail of regressionDetails) {
            const originalStr = detail.original !== undefined ? JSON.stringify(detail.original) : '<missing>';
            const improvedStr = detail.improved !== undefined ? JSON.stringify(detail.improved) : '<missing>';
            const expectedStr = JSON.stringify(detail.expected);

            output += `  ❌ ${detail.field}: ${originalStr} (original) → ${improvedStr} (improved) | expected: ${expectedStr}\n`;
        }

        return output;
    }

    /**
     * Count bullet points in a prompt.
     * Counts lines that start with "-" or "•" after trimming whitespace.
     *
     * @param prompt - The prompt text to analyze
     * @returns Number of bullet points
     */
    protected countBulletPoints(prompt: string): number {
        const lines = prompt.split('\n');
        let bulletCount = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
                bulletCount++;
            }
        }

        return bulletCount;
    }

    /**
     * Estimate token count for a prompt.
     * Uses a simple heuristic: split by whitespace and count words.
     * This is a rough estimate; actual token count may vary by ~20%.
     *
     * @param prompt - The prompt text to analyze
     * @returns Estimated token count
     */
    protected estimateTokenCount(prompt: string): number {
        // Simple heuristic: ~0.75 tokens per word on average
        const words = prompt.split(/\s+/).filter((w) => w.length > 0);
        return Math.ceil(words.length * 0.75);
    }

    /**
     * Monitor and log prompt size metrics.
     * Logs warnings if prompt exceeds defined thresholds (bullets or tokens).
     * This helps identify when prompt deduplication might be needed.
     *
     * @param prompt - The prompt to monitor
     * @param promptName - Optional name for logging (e.g., "Statement Extraction Prompt")
     */
    protected monitorPromptSize(prompt: string, promptName: string = 'Prompt'): void {
        const bulletCount = this.countBulletPoints(prompt);
        const tokenCount = this.estimateTokenCount(prompt);

        const warnings: string[] = [];

        if (bulletCount > PromptImprovementServiceBase.PROMPT_SIZE_THRESHOLDS.bulletPoints) {
            warnings.push(`${bulletCount} bullet points (threshold: ${PromptImprovementServiceBase.PROMPT_SIZE_THRESHOLDS.bulletPoints})`);
        }

        if (tokenCount > PromptImprovementServiceBase.PROMPT_SIZE_THRESHOLDS.tokens) {
            warnings.push(`~${tokenCount} tokens (threshold: ${PromptImprovementServiceBase.PROMPT_SIZE_THRESHOLDS.tokens})`);
        }

        if (warnings.length > 0) {
            console.warn(`⚠️  ${promptName} size exceeds thresholds: ${warnings.join(', ')}`);
            console.warn('💡 Consider implementing deduplication to prevent unbounded growth');
        } else {
            console.log(`✓ ${promptName} size: ${bulletCount} bullets, ~${tokenCount} tokens`);
        }
    }

    /**
     * Save improved prompt to account or group on the purpose-specific property.
     */
    protected async saveImprovedPrompt(entity: Account | Group | undefined, promptProperty: string, improvedPrompt: string, reasoning: string): Promise<string | null> {
        if (entity) {
            entity.setProperty(promptProperty, improvedPrompt);
            await entity.update();
            console.log(`🎉 ACE: Prompt updated on ${entity.getName()} (${promptProperty})`);
        } else {
            return null;
        }

        return `UPDATED PROMPT:
${improvedPrompt}

REASONING:

${reasoning}

`;
    }


}
