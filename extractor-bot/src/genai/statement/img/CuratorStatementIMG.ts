import { File } from 'bkper-js';
import { CuratorBase } from '../../ace/CuratorBase.js';
import { ReflectionResult } from '../../ace/ReflectionResult.js';

/**
 * CuratorIMG improves bank statement extraction prompts based on
 * reflection analysis of extraction quality.
 *
 * Focuses on adding spatial and structural guidance to prompts.
 */
export class CuratorStatementIMG extends CuratorBase {

    getUserPrompt(): string {
        return `

Improve the prompt for bank statement extraction:

**Additional Focus for Bank Statements:**
Emphasize SPATIAL AND STRUCTURAL GUIDANCE:
- WHERE in the document to find transactions: Use table names, section titles, structural markers (e.g., "in the 'Transaction Details' table")
- WHICH columns contain each field (date column, description column, amount column, etc.)
- HOW to identify the transaction table structure (by table title, headers, row patterns, visual layout)
- HOW to detect transaction boundaries (row breaks, patterns, delimiters)
- WHAT to exclude (headers, footers, summaries, totals, non-transaction rows)

CRITICAL: If suggestions mention page numbers (e.g., "Page 9", "starting on page 3"), you MUST:
- Remove the page reference completely
- Replace it with a structural description (e.g., "in the main transaction table titled 'Transactions in Date Sequence'")
- Never include page numbers in the final prompt under any circumstances

The improved prompt should teach the AI WHERE and HOW to extract transactions, not just WHAT to extract.
Focus on document structure, column patterns, and table layout guidance - NOT page locations.`;
    }
}
