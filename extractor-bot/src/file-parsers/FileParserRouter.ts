import { Account, Book, File, Group } from 'bkper-js';
import { AppContext } from '../AppContext.js';
import { EXTRACTOR_PROMPT_FILE_PROPERTY, LEGACY_AGENT_PARSER_FILE_PROPERTY } from '../constants.js';
import { PromptResolution } from '../services/PromptLookupService.js';
import { FileParserGenAIFileProperties } from './FileParserGenAIFileProperties.js';
import { FileParserGenAITransaction } from './FileParserGenAITransaction.js';
import { FileParserGenAITransactions } from './FileParserGenAITransactions.js';
import { FileParsingResult, FilePropertiesParser, FileTransactionExtraction, FileTransactionsParser } from './FileParserInterfaces.js';
import { isCSVFile } from './FileParserUtils.js';

interface FileParserContext {
    book: Book;
    file: File;
    account?: Account;
    group?: Group;
    transactionsPrompt?: PromptResolution;
    transactionPrompt?: PromptResolution;
    filePrompt?: PromptResolution;
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

    /**
     * Whether a parser URL is configured for the file: another app owns its extraction.
     * Keep these lookups identical to the ones that app performs.
     */
    async hasParserUrl(book: Book, file: File): Promise<boolean> {
        const { account, group } = await this.createParserContext(book, file);
        const lookups = await Promise.all([
            this.context.promptLookupService.lookupParserUrl({ book, file, account, group, purpose: 'transactions' }),
            isCSVFile(file) ? Promise.resolve(null) : this.context.promptLookupService.lookupParserUrl({ book, file, account, group, purpose: 'transaction' }),
            this.context.promptLookupService.lookupParserUrl({ book, file, account, group, purpose: 'file' }),
        ]);
        return lookups.some(lookup => !!lookup);
    }

    private async createParserContext(book: Book, file: File): Promise<FileParserContext> {
        const promptContext = await this.context.promptLookupService.lookupPrompts({ book, file });
        const transactionsPrompt = promptContext?.getPrompt('transactions');
        const transactionPrompt = promptContext?.getPrompt('transaction');
        const filePrompt = promptContext?.getPrompt('file');
        const account = transactionsPrompt?.account ?? transactionPrompt?.account ?? promptContext?.account;
        const group = transactionsPrompt?.group ?? transactionPrompt?.group ?? promptContext?.group;

        return {
            book,
            file,
            account,
            group,
            transactionsPrompt,
            transactionPrompt,
            filePrompt,
        };
    }

    private async parseTransactions(parserContext: FileParserContext): Promise<FileTransactionExtraction> {
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

    private selectDefaultTransactionsParser(): FileTransactionsParser {
        return new FileParserGenAITransactions(this.context, new FileParserGenAITransaction(this.context));
    }

    private selectFilePropertiesParser(parserContext: FileParserContext): FilePropertiesParser | undefined {
        const fileSource = parserContext.filePrompt?.sourceProperty;
        if ((fileSource === EXTRACTOR_PROMPT_FILE_PROPERTY || fileSource === LEGACY_AGENT_PARSER_FILE_PROPERTY) && parserContext.filePrompt?.prompt) {
            return new FileParserGenAIFileProperties(this.context);
        }

        return undefined;
    }
}
