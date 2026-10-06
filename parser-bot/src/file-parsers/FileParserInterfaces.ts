import { Account, Book, File } from 'bkper-js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { PromptResolution } from '../services/PromptLookupService.js';

export interface FileTransactionParseResult {
    kind: 'transaction';
    transactions: ExtractedTransaction[];
    prompt?: string;
    account?: Account;
}

export interface FileTransactionsParseResult {
    kind: 'transactions';
    transactions: ExtractedTransaction[];
    prompt?: string;
    account?: Account;
}

export type FileTransactionExtraction = FileTransactionParseResult | FileTransactionsParseResult;
export type FileParsingResult = FileTransactionExtraction & { fileProperties?: Record<string, string> };

export interface FileTransactionParserInput {
    book: Book;
    file: File;
    account?: Account;
    prompt?: string;
}

export interface FileTransactionsParserInput {
    book: Book;
    file: File;
    account?: Account;
    transactionsPrompt?: PromptResolution;
    transactionPrompt?: PromptResolution;
}

export interface FilePropertiesParserInput {
    book: Book;
    file: File;
    account?: Account;
    prompt?: string;
}

export interface FileTransactionParser {
    parse(input: FileTransactionParserInput): Promise<FileTransactionParseResult>;
}

export interface FileTransactionsParser {
    parse(input: FileTransactionsParserInput): Promise<FileTransactionExtraction>;
}

export interface FilePropertiesParser {
    parse(input: FilePropertiesParserInput): Promise<Record<string, string> | undefined>;
}
