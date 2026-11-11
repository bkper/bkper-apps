import { Account, Book, File, Group } from 'bkper-js';
import { AppContext } from '../AppContext.js';
import { AGENT_PARSER_FILE_PROPERTY } from '../constants.js';
import { ExtractorUrlLookupResult, PromptResolution } from '../services/PromptLookupService.js';
import { FileParserExternalFileProperties } from './FileParserExternalFileProperties.js';
import { FileParserExternalTransaction } from './FileParserExternalTransaction.js';
import { FileParserExternalTransactions } from './FileParserExternalTransactions.js';
import { FileParserGenAIFileProperties } from './FileParserGenAIFileProperties.js';
import { FileParserGenAITransaction } from './FileParserGenAITransaction.js';
import { FileParserGenAITransactions } from './FileParserGenAITransactions.js';
import { FileParsingResult, FilePropertiesParser, FileTransactionExtraction, FileTransactionParser, FileTransactionsParser } from './FileParserInterfaces.js';
import { isCSVFile } from './FileParserUtils.js';

interface FileParserContext {
    book: Book;
    file: File;
    account?: Account;
    group?: Group;
    transactionsPrompt?: PromptResolution;
    transactionPrompt?: PromptResolution;
    filePrompt?: PromptResolution;
    transactionsParserLookup?: ExtractorUrlLookupResult;
    transactionParserLookup?: ExtractorUrlLookupResult;
    fileParserLookup?: ExtractorUrlLookupResult;
}

export class FileParserRouter {
    constructor(private readonly context: AppContext) { }

    async parse(book: Book, file: File): Promise<FileParsingResult> {
        const parserContext = await this.createParserContext(book, file);
        const [transactionExtraction, fileProperties] = await Promise.all([
            this.parseTransactions(parserContext),
            this.parseFileProperties(parserContext),
        ]);

        return {
            ...transactionExtraction,
            fileProperties,
        };
    }

    private async createParserContext(book: Book, file: File): Promise<FileParserContext> {
        const promptContext = await this.context.promptLookupService.lookupPrompts({ book, file });
        const transactionsPrompt = promptContext?.getPrompt('transactions');
        const transactionPrompt = promptContext?.getPrompt('transaction');
        const filePrompt = promptContext?.getPrompt('file');
        const account = transactionsPrompt?.account ?? transactionPrompt?.account ?? promptContext?.account;
        const group = transactionsPrompt?.group ?? transactionPrompt?.group ?? promptContext?.group;

        const [transactionsParserLookup, transactionParserLookup, fileParserLookup] = await Promise.all([
            this.context.promptLookupService.lookupParserUrl({ book, file, account, group, purpose: 'transactions' }),
            isCSVFile(file) ? Promise.resolve(null) : this.context.promptLookupService.lookupParserUrl({ book, file, account, group, purpose: 'transaction' }),
            this.context.promptLookupService.lookupParserUrl({ book, file, account, group, purpose: 'file' }),
        ]);

        return {
            book,
            file,
            account,
            group,
            transactionsPrompt,
            transactionPrompt,
            filePrompt,
            transactionsParserLookup: transactionsParserLookup ?? undefined,
            transactionParserLookup: transactionParserLookup ?? undefined,
            fileParserLookup: fileParserLookup ?? undefined,
        };
    }

    private async parseTransactions(parserContext: FileParserContext): Promise<FileTransactionExtraction> {
        const externalTransactionsParser = this.selectExternalTransactionsParser(parserContext);
        if (externalTransactionsParser) {
            return externalTransactionsParser.parse({
                book: parserContext.book,
                file: parserContext.file,
                account: parserContext.account,
                transactionsPrompt: parserContext.transactionsPrompt,
                transactionPrompt: parserContext.transactionPrompt,
            });
        }

        const transactionParser = this.selectTransactionParser(parserContext);
        if (transactionParser) {
            return transactionParser.parse({
                book: parserContext.book,
                file: parserContext.file,
                account: parserContext.transactionParserLookup ? parserContext.account : parserContext.transactionPrompt?.account ?? parserContext.account,
                prompt: parserContext.transactionPrompt?.prompt,
            });
        }

        return this.selectDefaultTransactionsParser().parse({
            book: parserContext.book,
            file: parserContext.file,
            account: parserContext.account,
            transactionsPrompt: parserContext.transactionsPrompt,
            transactionPrompt: parserContext.transactionPrompt,
        });
    }

    private async parseFileProperties(parserContext: FileParserContext): Promise<Record<string, string> | undefined> {
        const parser = this.selectFilePropertiesParser(parserContext);
        if (!parser) {
            return undefined;
        }

        return parser.parse({
            book: parserContext.book,
            file: parserContext.file,
            account: parserContext.account,
            prompt: parserContext.filePrompt?.prompt,
        });
    }

    private selectExternalTransactionsParser(parserContext: FileParserContext): FileTransactionsParser | undefined {
        return parserContext.transactionsParserLookup ? new FileParserExternalTransactions(parserContext.transactionsParserLookup, !this.context.readOnly, this.context.readOnly ? this.context.requestSignal : undefined) : undefined;
    }

    private selectTransactionParser(parserContext: FileParserContext): FileTransactionParser | undefined {
        if (parserContext.transactionParserLookup) {
            return new FileParserExternalTransaction(parserContext.transactionParserLookup, !this.context.readOnly, this.context.readOnly ? this.context.requestSignal : undefined);
        }

        return undefined;
    }

    private selectDefaultTransactionsParser(): FileTransactionsParser {
        return new FileParserGenAITransactions(this.context, new FileParserGenAITransaction(this.context));
    }

    private selectFilePropertiesParser(parserContext: FileParserContext): FilePropertiesParser | undefined {
        if (parserContext.fileParserLookup) {
            return new FileParserExternalFileProperties(parserContext.fileParserLookup, !this.context.readOnly, this.context.readOnly ? this.context.requestSignal : undefined);
        }

        if (parserContext.filePrompt?.sourceProperty === AGENT_PARSER_FILE_PROPERTY && parserContext.filePrompt.prompt) {
            return new FileParserGenAIFileProperties(this.context);
        }

        return undefined;
    }
}
