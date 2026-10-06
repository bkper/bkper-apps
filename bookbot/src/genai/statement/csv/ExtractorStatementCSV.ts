import { File } from 'bkper-js';
import { BkperAIResponsesClient, type StructuredGenerationPart } from '../../BkperAIResponsesClient.js';
import { GenAIFile } from '../../GenAIFile.js';
import { JsonSchema } from '../../JsonSchema.js';
import { ExtractedStatement, getExtractedStatementSchema } from '../ExtractedStatement.js';
import { GEMINI_MODEL_FLASH } from '../../../constants.js';
import { GenAIRequestContext, getBase64DecodedSize, getFileSizeBucket } from '../../GenAITelemetry.js';

export class ExtractorStatementCSV extends GenAIFile<ExtractedStatement> {
    constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
        super(file, env, responsesClient);
    }

    getModel(): string {
        return GEMINI_MODEL_FLASH;
    }

    getOperation(): 'transactions_extraction' {
        return 'transactions_extraction';
    }

    getSystemPrompt(): string {
        return `
        You are a specialized assistant to extract transaction data from CSV, like bank, credit card statements or any other similar structures.
        You understand CSV column structures and can map columns to transaction fields (date, description, amount and properties).
        You always consider a csv reprenting a statement with multiple transactions, and NOT an invoice.
    `;
    }

    getDefaultUserPrompt(): string {
        return `
        - Identify which columns contain date, description, and amount
        - Map date column to YYYY-MM-DD format
        - Map description/memo/narrative column to description field
        - Map amount/debit/credit column to amount field
        - Preserve the amount sign EXACTLY as it appears in the source column. Do NOT flip or infer the sign based on account type, transaction kind, or any "expense/income" interpretation. A value written as "5" stays positive; a value written as "-259.08" stays negative.
        - If the CSV uses parentheses for negatives (e.g. "(259.08)"), convert to a negative number.
        - If the CSV has separate debit and credit columns, treat debit-column values as positive and credit-column values as negative (single signed output).
        - Extract any additional columns as properties
        - Do not include header row as a transaction
    `;
    }

    getResponseSchema(): JsonSchema {
        return getExtractedStatementSchema();
    }

    protected isStrictResponseSchema(): boolean {
        return false;
    }

    /**
     * Override extract to convert CSV to text instead of sending as inline data
     */
    public async extract(prompt: string | undefined, context: GenAIRequestContext = {}): Promise<ExtractedStatement | undefined> {
        const fileContentBase64 = await this.file.getContent();
        if (!fileContentBase64) {
            return undefined;
        }

        const csvTextContent = await this.convertCSVToText(fileContentBase64);
        if (csvTextContent) {
            prompt = prompt || this.getDefaultUserPrompt();

            console.log(`CSV FILE PROMPT:`, prompt);

            const contents: StructuredGenerationPart[] = [
                {
                    text: `${prompt}\n\n${csvTextContent}`,
                },
            ];
            const contentType = this.file.getContentType() || 'text/csv';

            return await this.query(contents, {
                ...context,
                media_type: contentType,
                file_size_bucket: getFileSizeBucket(getBase64DecodedSize(fileContentBase64)),
            });
        }
    }

    /**
     * Convert CSV base64 content to text with encoding and delimiter detection
     */
    public async convertCSVToText(content?: string): Promise<string> {
        const fileContentBase64 = content ?? await this.file.getContent();
        if (!fileContentBase64) {
            return '';
        }

        const binaryString = atob(fileContentBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const encoding = this.detectEncoding(bytes);
        const decoder = new TextDecoder(encoding);
        const csvText = decoder.decode(bytes);

        const delimiter = this.detectDelimiter(csvText);
        const hasHeaders = this.hasHeaderRow(csvText, delimiter);

        return `CSV Content:
Delimiter: ${delimiter === '\t' ? '\\t (tab)' : delimiter}
Has Headers: ${hasHeaders}
Encoding: ${encoding}

${csvText}`;
    }

    /**
     * Detect the delimiter used in the CSV (comma, semicolon, or tab)
     */
    public detectDelimiter(csvText: string): string {
        const firstLines = csvText.split('\n').slice(0, 3).join('\n');

        const commaCount = (firstLines.match(/,/g) || []).length;
        const semicolonCount = (firstLines.match(/;/g) || []).length;
        const tabCount = (firstLines.match(/\t/g) || []).length;

        if (tabCount > commaCount && tabCount > semicolonCount) {
            return '\t';
        }
        if (semicolonCount > commaCount) {
            return ';';
        }
        return ',';
    }

    /**
     * Detect the encoding of the CSV file (UTF-8, Latin-1, etc.)
     */
    public detectEncoding(bytes: Uint8Array): string {
        try {
            const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
            decoder.decode(bytes);
            return 'utf-8';
        } catch (e) {
            return 'latin1';
        }
    }

    /**
     * Check if the CSV has a header row
     */
    public hasHeaderRow(csvText: string, delimiter: string): boolean {
        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
            return false;
        }

        const firstRow = lines[0].split(delimiter);
        const secondRow = lines[1].split(delimiter);

        let textFieldsInFirst = 0;
        let numericFieldsInSecond = 0;

        for (let i = 0; i < Math.min(firstRow.length, 3); i++) {
            const firstField = firstRow[i]?.trim() || '';
            const secondField = secondRow[i]?.trim() || '';

            if (firstField && isNaN(Number(firstField)) && !/^\d{4}-\d{2}-\d{2}/.test(firstField)) {
                textFieldsInFirst++;
            }

            if (
                secondField &&
                (!isNaN(Number(secondField)) || /^\d{4}-\d{2}-\d{2}/.test(secondField))
            ) {
                numericFieldsInSecond++;
            }
        }

        return textFieldsInFirst >= 2 && numericFieldsInSecond >= 1;
    }
}
