import { ExternalExtractorClient } from '../external-extractor/ExternalExtractorClient.js';
import { ExtractorUrlLookupResult } from '../services/PromptLookupService.js';
import { FileTransactionParseResult, FileTransactionParser, FileTransactionParserInput } from './FileParserInterfaces.js';

export class FileParserExternalTransaction implements FileTransactionParser {
    constructor(private readonly lookup: ExtractorUrlLookupResult) { }

    async parse(input: FileTransactionParserInput): Promise<FileTransactionParseResult> {
        const account = input.account ?? this.lookup.account;
        if (!account) {
            throw new Error('Account is required for external transaction parser');
        }

        const client = new ExternalExtractorClient(this.lookup.url);
        const transaction = await client.extractTransaction(input.file, input.book, account, this.lookup);

        return {
            kind: 'transaction',
            transactions: transaction ? [transaction] : [],
            prompt: input.prompt,
            account,
        };
    }
}
