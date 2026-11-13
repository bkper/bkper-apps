import { File } from 'bkper-js';
import { AppContext } from '../AppContext.js';
import { APP_PROPERTY_PREFIXES, EXTRACTOR_PROMPT_FILE_PROPERTY, LEGACY_AGENT_PARSER_FILE_PROPERTY } from '../constants.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { PromptResolution } from './PromptLookupService.js';

export class AttachmentExtractionService {
    constructor(private readonly context: AppContext) { }

    async extractAttachedTransaction(file: File, promptResolution: PromptResolution | undefined): Promise<ExtractedTransaction | undefined> {
        return this.context.createExtractorInvoice(file).extract(promptResolution?.prompt);
    }

    async extractFilePropertiesIfConfigured(file: File, filePrompt: PromptResolution | undefined): Promise<Record<string, string> | undefined> {
        if ((filePrompt?.sourceProperty !== EXTRACTOR_PROMPT_FILE_PROPERTY && filePrompt?.sourceProperty !== LEGACY_AGENT_PARSER_FILE_PROPERTY) || !filePrompt.prompt) {
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
        return [...APP_PROPERTY_PREFIXES, 'parsed_', 'account_id', 'group_id', 'upload_method', 'auto_filled_date_'].some((prefix) => key.startsWith(prefix));
    }
}
