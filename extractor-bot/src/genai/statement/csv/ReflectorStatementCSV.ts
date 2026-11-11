import { BkperAIResponsesClient } from '../../BkperAIResponsesClient.js';
import { ReflectorBase } from '../../ace/ReflectorBase.js';
import { File } from 'bkper-js';
import { ExtractedTransaction } from '../../ExtractedTransaction.js';
import { ReflectionResult } from '../../ace/ReflectionResult.js';

export type { ReflectionResult };

/**
 * ReflectorCSV analyzes CSV statement extraction quality by comparing
 * AI-extracted transactions with user-corrected transactions.
 *
 * Focuses on CSV-specific concerns: column mapping, delimiters, headers, and data parsing.
 */
export class ReflectorStatementCSV extends ReflectorBase {
    constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
        super(file, env, responsesClient);
    }

    getSystemPrompt(): string {
        return `You are an expert at analyzing CSV transactions statements extraction quality.
Your role is to compare AI-extracted transactions with user-corrected transactions and identify patterns of success and failure.

FOCUS AREAS:
- Column mapping: Which column numbers/names contain date, description, amount, and other data?
- Delimiter detection: Is the correct delimiter (comma, semicolon, tab) being used?
- Header row detection: Is the first row correctly identified as headers or data?
- Encoding: Are special characters decoded correctly (UTF-8, Latin-1, etc.)?
- Data type parsing: Are dates, amounts, and other fields parsed with correct formats?
- Sign conventions: Are debits/credits handled correctly (positive/negative amounts)?

CSV files are structured data with columns and rows - your analysis should focus on correctly mapping
columns to transaction fields, not on visual appearance or document location.

Consider both individual transaction accuracy and completeness of the transaction set.
Pay attention to transactions that were missed, incorrectly extracted, or had to be removed by the user.
Analyze the column mapping and data parsing patterns that lead to successful or failed extractions.`;
    }

    protected buildUserPrompt(aiExtracted: ExtractedTransaction[], userCorrected: ExtractedTransaction[], userRemoved: ExtractedTransaction[], currentPrompt?: string): string {
        const promptContext = currentPrompt
            ? `
Current Extraction Instructions Being Used:
${currentPrompt}

IMPORTANT CONTEXT: These instructions are already in effect and were used to produce the AI extraction below.
When analyzing failures, consider:
- Are these instructions being followed correctly by the AI?
- Are they causing unintended filtering or exclusions?
- What ADDITIONAL guidance is needed WITHOUT contradicting these existing instructions?
- If a transaction is missing, is it because of an existing filter rule, or a different issue?

`
            : '';

        return `Analyze the following CSV statement extraction quality:
${promptContext}
AI Extracted Transactions (${aiExtracted.length} total):
${JSON.stringify(aiExtracted, null, 2)}

User Corrected To (${userCorrected.length} total):
${JSON.stringify(userCorrected, null, 2)}

Transactions Removed by User - TRASHED (${userRemoved.length} total):
${JSON.stringify(userRemoved, null, 2)}

Compare these datasets and identify:

1. **What Worked**: Which transactions were extracted correctly? What patterns were successful?
   - Correct column mapping (date in column X, description in column Y, amount in column Z)
   - Accurate delimiter detection
   - Correct header row identification
   - Accurate date parsing from the date column
   - Accurate amount parsing from the amount column
   - Accurate description extraction from the description column
   - Accurate property extraction from additional columns
   - Correct encoding/character decoding

2. **What Failed**: What needed correction or was missing?
   - COLUMN MAPPING: Were the wrong columns used for date/amount/description?
   - DELIMITER: Was the wrong delimiter detected (comma vs semicolon vs tab)?
   - HEADER ROW: Was the header row included as a transaction, or skipped when it shouldn't be?
   - ENCODING: Were special characters decoded incorrectly?
   - DATE FORMAT: Were dates parsed incorrectly (wrong format, wrong column)?
   - AMOUNT FORMAT: Were amounts parsed incorrectly (wrong sign, wrong decimal separator, wrong column)?
   - DESCRIPTION: Were descriptions truncated or incomplete (wrong column)?
   - PROPERTIES: Were properties missing or extracted from wrong columns?
   - COMPLETENESS: Were transactions missed entirely (skipped rows, wrong row range)?
   - FALSE POSITIVES: Were non-transaction rows incorrectly extracted (summary rows, total rows)?

3. **Specific Suggestions**: How can we improve the CSV extraction prompt?
   - WHICH column number contains the date field? (e.g., "column 1" or "first column")
   - WHICH column number contains the description field?
   - WHICH column number contains the amount field?
   - WHICH column numbers contain additional properties? (be explicit about column mappings)
   - HOW to handle the header row? (skip it, use it for column names, etc.)
   - WHAT delimiter should be used? (comma, semicolon, tab)
   - WHAT date format to expect? (YYYY-MM-DD, DD/MM/YYYY, MM-DD-YYYY, etc.)
   - WHAT amount format to expect? (decimal separator, sign convention, currency symbols)
   - HOW to identify summary/total rows to exclude? (keywords like "Total", "Summary", "Balance")
   - If user removed transactions, explain why they were false positives
   - If user removed properties, suggest NOT extracting them
   - When suggesting property extraction, specify the EXACT column number/name

Be thorough and specific. Consider the context of CSV extraction where column mapping accuracy is critical.
Focus on the column structure and data parsing patterns that lead to correct extraction.`;
    }
}
