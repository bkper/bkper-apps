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
