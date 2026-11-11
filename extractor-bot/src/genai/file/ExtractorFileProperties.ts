import { BkperAIResponsesClient } from '../BkperAIResponsesClient.js';
import { File } from 'bkper-js';
import { GenAIFile } from '../GenAIFile.js';
import { FILE_PROPERTIES_SCHEMA, JsonSchema } from '../JsonSchema.js';
import { GEMINI_MODEL_FLASH } from '../../constants.js';

export interface ExtractedFileProperties {
    properties: Record<string, string | number>;
}

export class ExtractorFileProperties extends GenAIFile<ExtractedFileProperties> {
    constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
        super(file, env, responsesClient);
    }

    getModel(): string {
        return GEMINI_MODEL_FLASH;
    }

    getOperation(): 'file_properties_extraction' {
        return 'file_properties_extraction';
    }

    getSystemPrompt(): string {
        return `
        You are a specialized assistant to extract file-level metadata as structured key-value properties.
        Extract only metadata about the document itself, not financial transactions.
        Return concise property keys and scalar string or number values.
    `;
    }

    getDefaultUserPrompt(): string {
        return '';
    }

    getResponseSchema(): JsonSchema {
        return FILE_PROPERTIES_SCHEMA;
    }

    protected isStrictResponseSchema(): boolean {
        return false;
    }
}
