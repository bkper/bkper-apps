import { Account, Book, File, Group, Transaction } from 'bkper-js';
import { AppContext } from '../AppContext.js';
import { AGENT_PARSER_FILE_PROPERTY } from '../constants.js';
import { ExternalExtractorClient } from '../external-extractor/ExternalExtractorClient.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { ExtractorUrlLookupResult, PromptResolution } from './PromptLookupService.js';

export class AttachmentExtractionService {
    constructor(private readonly context: AppContext) { }

    async extractAttachedTransaction(
        book: Book,
        transaction: Transaction,
        file: File,
        account: Account | undefined,
        group: Group | undefined,
        promptResolution: PromptResolution | undefined
    ): Promise<ExtractedTransaction | undefined> {
        const parserLookup = await this.context.promptLookupService.lookupParserUrl({ book, transaction, file, account, group, purpose: 'transaction' });
        if (parserLookup) {
            const parserAccount = await this.resolveTransactionParserAccount(transaction, account, parserLookup);
            if (!parserAccount) {
                throw new Error('Account is required for external transaction parser');
            }
            const client = new ExternalExtractorClient(parserLookup.url, !this.context.readOnly, this.context.readOnly ? this.context.requestSignal : undefined);
            return client.extractTransaction(file, book, parserAccount, parserLookup);
        }

        return this.context.createExtractorInvoice(file).extract(promptResolution?.prompt);
    }

    private async resolveTransactionParserAccount(transaction: Transaction, account: Account | undefined, parserLookup: ExtractorUrlLookupResult): Promise<Account | undefined> {
        if (account) {
            return account;
        }
        if (parserLookup.account) {
            return parserLookup.account;
        }
        const creditAccount = await transaction.getCreditAccount();
        if (creditAccount) {
            return creditAccount;
        }
        return transaction.getDebitAccount();
    }

    async extractFilePropertiesIfConfigured(
        book: Book,
        transaction: Transaction,
        file: File,
        account: Account | undefined,
        group: Group | undefined,
        filePrompt: PromptResolution | undefined
    ): Promise<Record<string, string> | undefined> {
        const parserLookup = await this.context.promptLookupService.lookupParserUrl({ book, transaction, file, account, group, purpose: 'file' });
        if (parserLookup) {
            const client = new ExternalExtractorClient(parserLookup.url, !this.context.readOnly, this.context.readOnly ? this.context.requestSignal : undefined);
            return this.filterFileProperties(await client.extractFileProperties(file, book, account ?? parserLookup.account, parserLookup));
        }

        if (filePrompt?.sourceProperty !== AGENT_PARSER_FILE_PROPERTY || !filePrompt.prompt) {
            return undefined;
        }

        const extracted = await this.context.createExtractorFileProperties(file).extract(filePrompt.prompt);
        return this.filterFileProperties(extracted?.properties);
    }

    private filterFileProperties(properties: Record<string, string | number> | undefined): Record<string, string> | undefined {
        if (!properties) {
            return undefined;
        }

        const filtered: Record<string, string> = {};
        for (const [key, value] of Object.entries(properties)) {
            if (this.shouldSkipFileProperty(key) || value === undefined || value === null) {
                continue;
            }
            const stringValue = String(value);
            if (stringValue.length > 0) {
                filtered[key] = stringValue;
            }
        }
        return filtered;
    }

    private shouldSkipFileProperty(key: string): boolean {
        if (!key.trim()) {
            return true;
        }
        return ['agent_', 'parsed_', 'account_id', 'group_id', 'upload_method', 'auto_filled_date_'].some((prefix) => key.startsWith(prefix));
    }
}
