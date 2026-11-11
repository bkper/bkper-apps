import { AppContext } from '../AppContext.js';
import type { FileClassificationKind } from '../genai/file/ExtractorFileClassification.js';
import { FileTransactionExtraction, FileTransactionParser, FileTransactionsParser, FileTransactionsParserInput } from './FileParserInterfaces.js';
import { isCSVFile } from './FileParserUtils.js';

export class FileParserGenAITransactions implements FileTransactionsParser {
    constructor(
        private readonly context: AppContext,
        private readonly transactionParser: FileTransactionParser
    ) { }

    async parse(input: FileTransactionsParserInput): Promise<FileTransactionExtraction> {
        const isCSV = isCSVFile(input.file);
        const transactionsPrompt = input.transactionsPrompt;

        if (isCSV) {
            console.log('Using AI transactions extractor');
            const extractorResponse = await this.context.createExtractorStatementCSV(input.file).extract(transactionsPrompt?.prompt);

            return {
                kind: 'transactions',
                transactions: extractorResponse?.transactions || [],
                prompt: transactionsPrompt?.prompt,
                account: input.account,
            };
        }

        const classification = await this.classifyFile(input);
        console.log('fileClassification', classification);

        if (classification === 'statement') {
            console.log('Using AI statement extractor');
            const extractorResponse = await this.context.createExtractorStatementIMG(input.file).extract(transactionsPrompt?.prompt);

            return {
                kind: 'transactions',
                transactions: extractorResponse?.transactions || [],
                prompt: transactionsPrompt?.prompt,
                account: input.account,
            };
        }

        return this.transactionParser.parse({
            book: input.book,
            file: input.file,
            account: input.transactionPrompt?.account ?? input.account,
            prompt: input.transactionPrompt?.prompt ?? transactionsPrompt?.prompt,
        });
    }

    private async classifyFile(input: FileTransactionsParserInput): Promise<FileClassificationKind> {
        const classification = await this.context.createExtractorFileClassification(input.file).extract(undefined);
        return classification?.kind === 'statement' ? 'statement' : 'single_transaction';
    }

}
