import { File } from 'bkper-js';
import { CuratorBase } from '../../ace/CuratorBase.js';
import { ReflectionResult } from '../../ace/ReflectionResult.js';

/**
 * CuratorCSV improves CSV statement extraction prompts based on
 * reflection analysis of extraction quality.
 *
 * Focuses on column mapping, delimiter detection, and data parsing guidance.
 */
export class CuratorStatementCSV extends CuratorBase {

    getUserPrompt(): string {
        return `

Improve the prompt for CSV statement extraction:

**Additional Focus for CSV Files:**
Emphasize COLUMN MAPPING AND STRUCTURE GUIDANCE:
- WHICH column number contains the date field (e.g., "column 1", "first column", "column A")
- WHICH column number contains the description field
- WHICH column number contains the amount field
- WHICH column numbers contain additional properties (be explicit about column positions)
- HOW to handle the header row (skip it, use it for column names, etc.)
- WHAT delimiter to use (comma, semicolon, tab)
- WHAT date format to expect (YYYY-MM-DD, DD/MM/YYYY, MM-DD-YYYY, etc.)
- WHAT amount format to expect (decimal separator, sign convention, currency symbols)
- HOW to identify and exclude summary/total rows (keywords like "Total", "Summary", "Balance")

CRITICAL: CSV extraction should focus on column structure, NOT document layout or visual appearance.
- Use column numbers or names (e.g., "column 3", "first column", "column A")
- Specify exact column positions (e.g., "column 3" not "the third area")
- Describe data patterns (e.g., "amounts in parentheses are negative")
- Be explicit about row filtering (e.g., "skip rows where column 1 contains 'Total'")

The improved prompt should teach the AI WHICH COLUMNS to map and HOW to parse the data.
Focus on column positions, delimiters, headers, and data formats - NOT visual or spatial layout.`;
    }
}
