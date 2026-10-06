import { File } from 'bkper-js';
import { BkperAIResponsesClient, type StructuredGenerationPart } from './BkperAIResponsesClient.js';
import { GenAI } from './GenAI.js';
import { type GenAIRequestContext, getBase64DecodedSize, getFileSizeBucket } from './GenAITelemetry.js';

export abstract class GenAIFile<E> extends GenAI<E> {
    protected file: File;

    constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
        super(env, responsesClient);
        this.file = file;
    }

    protected abstract getDefaultUserPrompt(): string;

    public async extract(
        prompt: string | undefined,
        context: GenAIRequestContext = {}
    ): Promise<E | undefined> {
        const fileContentBase64 = await this.file.getContent();

        if (fileContentBase64) {
            prompt = prompt || this.getDefaultUserPrompt();

            if (!this.readOnly) console.log('FILE PROMPT:', prompt);

            const contentType = this.file.getContentType() || 'application/octet-stream';
            const contents: StructuredGenerationPart[] = [
                { text: prompt },
                {
                    inlineData: {
                        mimeType: contentType,
                        data: fileContentBase64,
                    },
                },
            ];
            return await this.query(contents, {
                ...context,
                media_type: contentType,
                file_size_bucket: getFileSizeBucket(getBase64DecodedSize(fileContentBase64)),
            });
        }
    }
}
