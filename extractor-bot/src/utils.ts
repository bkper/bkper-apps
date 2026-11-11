/**
 * Calculates Jaro similarity between two strings
 * Returns a value between 0 (completely different) and 1 (identical)
 * @internal
 */
function jaroSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    // Find matches
    for (let i = 0; i < s1.length; i++) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, s2.length);

        for (let j = start; j < end; j++) {
            if (s2Matches[j] || s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches++;
            break;
        }
    }

    if (matches === 0) return 0.0;

    // Find transpositions
    let k = 0;
    for (let i = 0; i < s1.length; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }

    return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3.0;
}

/**
 * Calculates Jaro-Winkler similarity between two strings
 * Returns a value between 0 (completely different) and 1 (identical)
 *
 * Jaro-Winkler gives more weight to strings that match from the beginning,
 * making it ideal for comparing names, invoice numbers, and descriptions.
 *
 * @param s1 First string to compare
 * @param s2 Second string to compare
 * @param prefixScale Scaling factor for common prefix (default: 0.1, max: 0.25)
 * @returns Similarity score from 0 to 1
 *
 * @example
 * jaroWinklerSimilarity("ACME Corp", "ACME Corporation") // ~0.95
 * jaroWinklerSimilarity("Invoice #123", "invoice #123") // 1.0
 * jaroWinklerSimilarity("Apple", "Orange") // ~0.35
 */
export function jaroWinklerSimilarity(s1: string, s2: string, prefixScale: number = 0.1): number {
    const jaroSim = jaroSimilarity(s1, s2);

    // Calculate common prefix length (up to 4 characters)
    let prefixLength = 0;
    const maxPrefixLength = 4;

    for (let i = 0; i < Math.min(s1.length, s2.length, maxPrefixLength); i++) {
        if (s1[i] === s2[i]) {
            prefixLength++;
        } else {
            break;
        }
    }

    // Jaro-Winkler formula
    return jaroSim + prefixLength * prefixScale * (1 - jaroSim);
}

/**
 * Compares two values with fuzzy matching using Jaro-Winkler similarity
 *
 * This function normalizes values (converts to string, trim, lowercase, handles numeric sign) before comparison,
 * making it suitable for user-generated content where case, whitespace, and numeric sign differences should be ignored.
 *
 * **Use this for DESCRIPTIONS only** - for property values, use `isExactMatch()` instead.
 *
 * For numeric values, the sign (positive/negative) is ignored, so -10 and 10 are considered equal.
 *
 * **Length-based validation**: To prevent incomplete strings from matching complete ones (e.g., "MONEY FUND INCOME"
 * matching "MONEY FUND INCOME FEDERATD HERMES SHRT"), this function enforces a maximum allowed length difference
 * that scales with the threshold: `maxLengthDiff = 1 - threshold`.
 * - threshold 0.60 → max 40% length difference (lenient, for curation matching)
 * - threshold 0.80 → max 20% length difference (moderate, for statement validation)
 * - threshold 0.90 → max 10% length difference (strict, for change detection)
 *
 * @param a First value to compare (string or number)
 * @param b Second value to compare (string or number)
 * @param threshold Minimum similarity score (0-1) to consider strings similar (default: 0.9)
 * @returns true if values are similar enough according to the threshold AND pass length validation
 *
 * @example
 * // Exact matches after normalization
 * isSimilarString("ACME Corp", "acme corp") // true
 * isSimilarString("  Invoice #123  ", "Invoice #123") // true
 *
 * // Similar strings (default 90% threshold)
 * isSimilarString("ACME Corporation", "ACME Corp") // true (95% similar, 17% length diff)
 * isSimilarString("Office Supplies", "office supplies") // true (100% similar)
 *
 * // Length-based validation prevents incomplete matches
 * isSimilarString("MONEY FUND INCOME", "MONEY FUND INCOME FEDERATD HERMES SHRT", 0.8)
 * // false (64% length diff exceeds 20% max for 0.8 threshold)
 *
 * // Numeric values (sign ignored)
 * isSimilarString(-10, 10) // true (sign ignored)
 * isSimilarString("-3.50", 3.5) // true (sign ignored)
 * isSimilarString(100, 200) // false (different values)
 *
 * // Different strings
 * isSimilarString("Apple Inc", "Microsoft Corp") // false
 *
 * // Custom threshold
 * isSimilarString("test", "text", 0.95) // false (only 92% similar)
 * isSimilarString("test", "text", 0.90) // true (92% >= 90%)
 */
export function isSimilarString(a: string | number, b: string | number, threshold: number = 0.9): boolean {
    // Convert to string if numeric
    const strA = String(a);
    const strB = String(b);

    // Normalize: trim and lowercase
    const normA = strA.trim().toLowerCase();
    const normB = strB.trim().toLowerCase();

    // For numeric values, ignore sign (positive/negative)
    // This handles cases where AI returns "-3.50" but user corrects to "3.50"
    // Only treat as numeric if the string is PURELY numeric (no non-numeric chars except optional leading +/- and decimal point)
    const numA = parseFloat(normA);
    const numB = parseFloat(normB);
    const isAPureNumber = !isNaN(numA) && /^[+-]?\d+(\.\d+)?$/.test(normA);
    const isBPureNumber = !isNaN(numB) && /^[+-]?\d+(\.\d+)?$/.test(normB);

    if (isAPureNumber && isBPureNumber) {
        return Math.abs(numA) === Math.abs(numB);
    }

    // Exact match after normalization
    if (normA === normB) return true;

    // Empty strings should match only if both empty
    if (normA === '' || normB === '') return false;

    // Length-based validation: prevent short strings from matching long strings
    // Maximum allowed length difference scales with threshold:
    // - threshold 0.60 → max 40% length difference (lenient, for curation)
    // - threshold 0.80 → max 20% length difference (moderate, for statements)
    // - threshold 0.90 → max 10% length difference (strict, for change detection)
    // - threshold 0.95 → max 5% length difference (very strict)
    const maxLengthDiffPercent = 1 - threshold;
    const longerLength = Math.max(normA.length, normB.length);
    const shorterLength = Math.min(normA.length, normB.length);
    const lengthDiffPercent = (longerLength - shorterLength) / longerLength;

    if (lengthDiffPercent > maxLengthDiffPercent) {
        return false; // Length difference too large for this threshold
    }

    // Calculate similarity
    const similarity = jaroWinklerSimilarity(normA, normB);
    return similarity >= threshold;
}

/**
 * Compares two values with STRICT/EXACT matching (no fuzzy matching)
 *
 * This function is designed for comparing property values where exact matches are required.
 * String comparison is case-insensitive and whitespace-trimmed, but requires exact character match.
 * Numeric comparison uses absolute values (sign ignored), so 3.50 matches -3.5.
 *
 * **Use this for PROPERTY VALUES** - for descriptions, use `isSimilarString()` instead.
 *
 * @param a First value to compare (string or number)
 * @param b Second value to compare (string or number)
 * @returns true if values match exactly (or numeric absolute values match)
 *
 * @example
 * // Exact string matches (case-insensitive, whitespace trimmed)
 * isExactMatch("ACME Corp", "acme corp") // true
 * isExactMatch("  Invoice #123  ", "Invoice #123") // true
 *
 * // NOT similar strings (no fuzzy matching)
 * isExactMatch("ACME Corporation", "ACME Corp") // false (different characters)
 * isExactMatch("Office Supplies", "Office Supply") // false (missing 's')
 *
 * // Numeric values (sign ignored, absolute values compared)
 * isExactMatch(-10, 10) // true (|−10| === |10|)
 * isExactMatch("-3.50", 3.5) // true (|−3.50| === |3.5|)
 * isExactMatch(3.50, "-3.5") // true (|3.50| === |−3.5|)
 * isExactMatch(100, 200) // false (different values)
 *
 * // Mixed types
 * isExactMatch("123", 123) // true (converted to string, then compared)
 * isExactMatch(-10, "10") // true (both numeric, absolute match)
 */
export function isExactMatch(a: string | number, b: string | number): boolean {
    // Convert to string
    const strA = String(a);
    const strB = String(b);

    // Normalize: trim and lowercase
    const normA = strA.trim().toLowerCase();
    const normB = strB.trim().toLowerCase();

    // For numeric values, compare absolute values
    // Only treat as numeric if the string is PURELY numeric (no non-numeric chars except optional leading +/- and decimal point)
    const numA = parseFloat(normA);
    const numB = parseFloat(normB);
    const isAPureNumber = !isNaN(numA) && /^[+-]?\d+(\.\d+)?$/.test(normA);
    const isBPureNumber = !isNaN(numB) && /^[+-]?\d+(\.\d+)?$/.test(normB);

    if (isAPureNumber && isBPureNumber) {
        return Math.abs(numA) === Math.abs(numB);
    }

    // Exact string match (after normalization)
    return normA === normB;
}

/**
 * Strips account names from a description before comparison
 *
 * This function removes occurrences of credit and/or debit account names from a transaction description,
 * enabling accurate description comparison when account names have been appended by the Bkper UI or other processes.
 *
 * The stripping is case-insensitive and removes ALL occurrences of the account names.
 *
 * @param description The description to clean
 * @param creditAccount Optional credit account name to remove
 * @param debitAccount Optional debit account name to remove
 * @returns The description with account names removed and trimmed
 *
 * @example
 * // Remove single account name
 * stripAccountNamesFromDescription("Office Supplies Cash", "Cash")
 * // Returns: "Office Supplies"
 *
 * // Remove both credit and debit account names
 * stripAccountNamesFromDescription("Transfer from Cash to Bank Account", "Cash", "Bank Account")
 * // Returns: "Transfer from to"
 *
 * // Case-insensitive removal
 * stripAccountNamesFromDescription("Office Supplies CASH", "Cash")
 * // Returns: "Office Supplies"
 *
 * // No account names to remove
 * stripAccountNamesFromDescription("Office Supplies")
 * // Returns: "Office Supplies"
 */
export function stripAccountNamesFromDescription(description: string, creditAccount?: string, debitAccount?: string): string {
    if (!description) {
        return '';
    }

    let result = description;

    // Strip credit account name if provided
    if (creditAccount) {
        // Create a regex that matches the account name (case-insensitive, global)
        const regex = new RegExp(escapeRegex(creditAccount), 'gi');
        result = result.replace(regex, '');
    }

    // Strip debit account name if provided
    if (debitAccount) {
        // Create a regex that matches the account name (case-insensitive, global)
        const regex = new RegExp(escapeRegex(debitAccount), 'gi');
        result = result.replace(regex, '');
    }

    // Collapse multiple spaces into single space and trim
    result = result.replace(/\s+/g, ' ').trim();

    return result;
}

/**
 * Replaces literal \\n sequences (two-character: backslash + n) with actual newline characters.
 *
 * This function is useful when LLMs return text with literal "\\n" strings instead of actual newlines.
 * It converts these literal sequences into proper line breaks for better readability and formatting.
 *
 * @param text The text containing literal \\n sequences
 * @returns The text with literal \\n converted to actual newlines
 *
 * @example
 * // Convert literal \\n to actual newlines
 * replaceBreakLiterals("Line 1\\nLine 2\\nLine 3")
 * // Returns: "Line 1\nLine 2\nLine 3" (with actual newlines)
 *
 * // Actual newlines are preserved
 * replaceBreakLiterals("Line 1\nLine 2")
 * // Returns: "Line 1\nLine 2" (unchanged)
 *
 * // Mixed content works correctly
 * replaceBreakLiterals("Line 1\\nLine 2\nLine 3")
 * // Returns: "Line 1\nLine 2\nLine 3" (both become actual newlines)
 */
export function replaceBreakLiterals(text: string): string {
    // Convert literal \n (backslash + n) to actual newlines
    return text.replace(/\\n/g, `
`);
}

/**
 * Escapes special regex characters in a string
 * @internal
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
