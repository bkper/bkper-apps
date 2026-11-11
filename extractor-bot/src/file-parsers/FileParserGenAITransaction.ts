import { AppContext } from '../AppContext.js';
import { FileTransactionParseResult, FileTransactionParser, FileTransactionParserInput } from './FileParserInterfaces.js';

export class FileParserGenAITransaction implements FileTransactionParser {
    constructor(private readonly context: AppContext) { }

    async parse(input: FileTransactionParserInput): Promise<FileTransactionParseResult> {
        console.log('Using AI transaction extractor');
        const transaction = await this.context.createExtractorInvoice(input.file).extract(input.prompt);

        return {
            kind: 'transaction',
            transactions: transaction ? [transaction] : [],
            prompt: input.prompt,
            account: input.account,
        };
    }
}
