/**
 * TypeScript interfaces for external transaction extractor API
 * Based on the API specification from docs/TRANSACTIONS_EXTRACTOR_API.md
 */

import { ExtractedTransaction } from '../genai/ExtractedTransaction';

/**
 * Request structure sent to external extractor service
 */
export interface ExternalExtractorRequest {
    book: bkper.Book;
    account?: {
        id: string;
        name: string;
        properties: Record<string, string>;
    };
    group?: bkper.Group;
    file: {
        id: string;
        name: string;
        content: string; // base64 encoded
        contentType: string;
    };
}

/**
 * Success response from external extractor service
 */
export interface ExternalExtractorResponse {
    success: boolean;
    data?: {
        transaction?: ExtractedTransaction;
        transactions?: ExtractedTransaction[];
    };
    file?: {
        properties?: Record<string, string>;
    };
    metadata?: {
        book_id: string;
        account_id: string;
        account_name: string;
        total_transactions: number;
    };
    error?: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
}

/**
 * Result returned by ExternalExtractorClient.extract(). The transactions
 * operation consumes only data.transactions; file metadata is extracted
 * separately through extractFileProperties().
 */
export interface ExternalExtractorResult {
    transactions: ExtractedTransaction[];
}

