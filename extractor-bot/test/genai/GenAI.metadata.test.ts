import { expect, it, mock, describe } from 'bun:test';
import { File } from 'bkper-js';
import { type StructuredGenerationPart } from '../../src/genai/BkperAIResponsesClient.js';
import { GenAI } from '../../src/genai/GenAI.js';
import { GenAIFile } from '../../src/genai/GenAIFile.js';
import { ExtractorStatementCSV } from '../../src/genai/statement/csv/ExtractorStatementCSV.js';
import { GenAIOperation, GenAIRequestMetadata } from '../../src/genai/GenAITelemetry.js';
import { ExtractedStatement } from '../../src/genai/statement/ExtractedStatement.js';
import { JsonSchema } from '../../src/genai/JsonSchema.js';

const env = {} as Env;

class MetadataTestGenAI extends GenAI<string> {
    metadata?: GenAIRequestMetadata;

    protected getModel(): string {
        return 'test-model';
    }

    protected getOperation(): GenAIOperation {
        return 'amount_extraction';
    }

    protected getSystemPrompt(): string {
        return 'test';
    }

    protected getResponseSchema(): JsonSchema {
        return { type: 'string' };
    }

    protected async attemptQuery(_model: string, _contents: StructuredGenerationPart[], metadata: GenAIRequestMetadata): Promise<string> {
        this.metadata = metadata;
        return 'ok';
    }
}

class MetadataTestFile extends GenAIFile<string> {
    metadata?: GenAIRequestMetadata;

    protected getModel(): string {
        return 'test-model';
    }

    protected getOperation(): GenAIOperation {
        return 'transaction_extraction';
    }

    protected getSystemPrompt(): string {
        return 'test';
    }

    protected getResponseSchema(): JsonSchema {
        return { type: 'string' };
    }

    protected getDefaultUserPrompt(): string {
        return 'extract';
    }

    protected async attemptQuery(_model: string, _contents: StructuredGenerationPart[], metadata: GenAIRequestMetadata): Promise<string> {
        this.metadata = metadata;
        return 'ok';
    }
}

class MetadataTestCSV extends ExtractorStatementCSV {
    metadata?: GenAIRequestMetadata;

    protected async attemptQuery(_model: string, _contents: StructuredGenerationPart[], metadata: GenAIRequestMetadata): Promise<ExtractedStatement> {
        this.metadata = metadata;
        return { transactions: [] };
    }
}

describe('GenAI request metadata propagation', () => {
    it('adds normal extraction operation metadata', async () => {
        const genAI = new MetadataTestGenAI(env);

        await genAI.query([{ text: 'request' }]);

        expect(genAI.metadata).toEqual({ operation: 'amount_extraction' });
    });

    it('preserves dynamic ACE validation stage and epoch', async () => {
        const getContent = mock().mockResolvedValue('SGVsbG8=');
        const file = {
            getContent,
            getContentType: () => 'application/pdf',
        } as unknown as File;
        const genAI = new MetadataTestFile(file, env);

        await genAI.extract('prompt', {
            operation: 'ace',
            document_kind: 'invoice',
            stage: 'post_validation',
            epoch: 2,
        });

        expect(genAI.metadata).toMatchObject({
            operation: 'ace',
            document_kind: 'invoice',
            stage: 'post_validation',
            epoch: 2,
        });
    });

    it('adds media type and a size bucket from already-loaded content', async () => {
        const twoMegabytesBase64 = 'A'.repeat(Math.ceil((2 * 1024 * 1024 * 4) / 3));
        const getContent = mock().mockResolvedValue(twoMegabytesBase64);
        const file = {
            getContent,
            getContentType: () => 'image/png',
        } as unknown as File;
        const genAI = new MetadataTestFile(file, env);

        await genAI.extract(undefined);

        expect(getContent).toHaveBeenCalledTimes(1);
        expect(genAI.metadata).toMatchObject({
            operation: 'transaction_extraction',
            media_type: 'image/png',
            file_size_bucket: '1mb_5mb',
        });
    });

    it('loads CSV file content only once while adding file metadata', async () => {
        const csv = btoa('date,description,amount\n2026-01-01,Example,10');
        const getContent = mock().mockResolvedValue(csv);
        const file = {
            getContent,
            getContentType: () => 'text/csv',
        } as unknown as File;
        const extractor = new MetadataTestCSV(file, env);

        await extractor.extract(undefined);

        expect(getContent).toHaveBeenCalledTimes(1);
        expect(extractor.metadata).toMatchObject({
            operation: 'transactions_extraction',
            media_type: 'text/csv',
            file_size_bucket: 'under_1mb',
        });
    });

    it('does not fetch missing CSV file content twice', async () => {
        const getContent = mock().mockResolvedValue(undefined);
        const file = {
            getContent,
            getContentType: () => 'text/csv',
        } as unknown as File;
        const extractor = new MetadataTestCSV(file, env);

        expect(await extractor.extract(undefined)).toBeUndefined();
        expect(getContent).toHaveBeenCalledTimes(1);
    });

});
