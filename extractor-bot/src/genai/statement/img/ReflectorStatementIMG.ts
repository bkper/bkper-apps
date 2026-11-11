import { BkperAIResponsesClient } from '../../BkperAIResponsesClient.js';
import { ReflectorBase } from '../../ace/ReflectorBase.js';
import { File } from 'bkper-js';
import { ExtractedTransaction } from '../../ExtractedTransaction.js';
import { ReflectionResult } from '../../ace/ReflectionResult.js';

export type { ReflectionResult };

/**
 * ReflectorIMG analyzes bank statement extraction quality by comparing
 * AI-extracted transactions with user-corrected transactions.
 *
 * Focuses on spatial and structural patterns in document analysis.
 */
export class ReflectorStatementIMG extends ReflectorBase {
    constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
        super(file, env, responsesClient);
    }

    getSystemPrompt(): string {
        return `You are an expert at analyzing bank statement extraction quality.
Your role is to compare AI-extracted transactions with user-corrected transactions and identify patterns of success and failure.

FOCUS AREAS:
- Document structure: WHERE in the document are transactions located? (e.g., "in the main table", "bottom section", "transactions area")
- Column patterns: Which columns contain date, description, amount, and other data?
- Table structure: How are transactions organized (rows, headers, sections)?
- Data extraction patterns: How to identify transaction boundaries and parse each field?

CRITICAL: Never reference page numbers in your analysis or suggestions. Users may print/crop/combine pages differently.
Use structural markers instead: "top section", "main table", "after the summary", "transaction details area", etc.

Consider both individual transaction accuracy and completeness of the transaction set.
Pay attention to transactions that were missed, incorrectly extracted, or had to be removed by the user.
Analyze the spatial and structural patterns that lead to successful or failed extractions.`;
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

        return `Analyze the following bank statement extraction quality:
${promptContext}
AI Extracted Transactions (${aiExtracted.length} total):
${JSON.stringify(aiExtracted, null, 2)}

User Corrected To (${userCorrected.length} total):
${JSON.stringify(userCorrected, null, 2)}

Transactions Removed by User - TRASHED (${userRemoved.length} total):
${JSON.stringify(userRemoved, null, 2)}

Compare these datasets and identify:

1. **What Worked**: Which transactions were extracted correctly? What patterns were successful?
   - Correct identification of transaction location in document
   - Accurate column pattern recognition (date, description, amount columns)
   - Correct table structure understanding
   - Accurate date extraction from the identified column
   - Accurate amount extraction from the identified column
   - Accurate description extraction from the identified column
   - Accurate property extraction based on column patterns
   - Correct transaction boundary detection

2. **What Failed**: What needed correction or was missing?
   - DOCUMENT STRUCTURE: Was the wrong section/area of the document analyzed?
   - COLUMN IDENTIFICATION: Were the wrong columns used for date/amount/description?
   - TABLE STRUCTURE: Were transaction rows incorrectly identified or missed?
   - TRANSACTION BOUNDARIES: Were transactions incorrectly split or merged?
   - Transactions that were missed entirely (why - wrong area? wrong pattern?)
   - Transactions with incorrect dates (wrong column? wrong format?)
   - Transactions with incorrect amounts (wrong column?)
   - Transactions with incorrect descriptions (wrong column? incomplete?)
   - Transactions with incorrect or missing properties (which columns to use?)
   - Transactions that were incorrectly extracted and had to be trashed (false positives from wrong area?)

3. **Specific Suggestions**: How can we improve the extraction prompt?
   - WHERE in the document should we look for transactions? (describe by structure: "main table", "bottom section", "after summary row" - NEVER use page numbers)
   - WHICH columns contain the transaction data? (positions, patterns, headers?)
   - HOW to identify transaction table structure? (by table title, headers, visual patterns - NOT by page location)
   - HOW to detect transaction boundaries? (line breaks, patterns, visual cues?)
   - Address missed transactions (describe by structural location - table name, section title, visual pattern)
   - Address false positives (excluding headers, summaries, non-transaction data?)
   - Address field accuracy issues (correct column mapping?)
   - Be explicit about which properties to extract and from which columns
   - If user removed a property, suggest NOT extracting it

CRITICAL: Your suggestions must NEVER mention page numbers (e.g., "Page 9", "starting on page 3").
Users may print, crop, or combine pages differently, making page references unreliable.
Instead, describe location by document structure: table names, section titles, visual patterns, relative positions.

Be thorough and specific. Consider the context of bank statement extraction where accuracy is critical.
Focus on the spatial and structural patterns that lead to correct extraction.`;
    }
}
