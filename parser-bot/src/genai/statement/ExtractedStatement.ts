import { ExtractedTransaction } from '../ExtractedTransaction.js';
import { EXTRACTED_STATEMENT_SCHEMA, JsonSchema } from '../JsonSchema.js';

export interface ExtractedStatement {
    transactions: ExtractedTransaction[];
}

export function getExtractedStatementSchema(): JsonSchema {
    return EXTRACTED_STATEMENT_SCHEMA;
}

