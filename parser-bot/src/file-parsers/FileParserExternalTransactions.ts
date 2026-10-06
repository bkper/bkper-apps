import { ExternalExtractorClient } from '../external-extractor/ExternalExtractorClient.js';
import { ExtractorUrlLookupResult } from '../services/PromptLookupService.js';
import { FileTransactionsParseResult, FileTransactionsParser, FileTransactionsParserInput } from './FileParserInterfaces.js';

export class FileParserExternalTransactions implements FileTransactionsParser {
    constructor(private readonly lookup: ExtractorUrlLookupResult) { }

    async parse(input: FileTransactionsParserInput): Promise<FileTransactionsParseResult> {
        const account = input.account ?? this.lookup.account;
        if (!account) {
            throw new Error('Account is required for external transactions parser');
        }

        const client = new ExternalExtractorClient(this.lookup.url);
        const result = await client.extract(input.file, input.book, account, this.lookup);

        if (!result.transactions || result.transactions.length === 0) {
            console.warn('External extractor returned no transactions');
            return {
                kind: 'transactions',
                transactions: [],
                prompt: input.transactionsPrompt?.prompt,
                account,
            };
        }

        console.log(`External extractor returned ${result.transactions.length} transactions`);

        return {
            kind: 'transactions',
            transactions: result.transactions,
            prompt: input.transactionsPrompt?.prompt,
            account,
        };
    }
}
