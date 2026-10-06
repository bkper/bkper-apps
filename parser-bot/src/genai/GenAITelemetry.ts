export type GenAIOperation =
    | 'file_classification'
    | 'transaction_extraction'
    | 'transactions_extraction'
    | 'file_properties_extraction'
    | 'amount_extraction'
    | 'date_extraction'
    | 'description_parts_extraction'
    | 'evaluation'
    | 'ace';

export type FileSizeBucket = 'under_1mb' | '1mb_5mb' | '5mb_10mb' | '10mb_25mb' | '25mb_plus';

export interface GenAIRequestMetadata {
    operation: GenAIOperation;
    document_kind?: 'invoice' | 'statement' | 'unknown';
    stage?: 'pre_validation' | 'reflection' | 'curation' | 'post_validation';
    epoch?: number;
    media_type?: string;
    file_size_bucket?: FileSizeBucket;
}

export type GenAIRequestContext = Omit<GenAIRequestMetadata, 'operation'> & {
    operation?: GenAIOperation;
};

export function getFileSizeBucket(sizeBytes: number): FileSizeBucket {
    const megabyte = 1024 * 1024;
    if (sizeBytes < megabyte) return 'under_1mb';
    if (sizeBytes < 5 * megabyte) return '1mb_5mb';
    if (sizeBytes < 10 * megabyte) return '5mb_10mb';
    if (sizeBytes < 25 * megabyte) return '10mb_25mb';
    return '25mb_plus';
}

export function getBase64DecodedSize(base64Content: string): number {
    const normalizedContent = base64Content.replace(/\s/g, '');
    if (normalizedContent.length === 0) return 0;

    const paddingLength = normalizedContent.endsWith('==') ? 2 : normalizedContent.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((normalizedContent.length * 3) / 4) - paddingLength);
}
