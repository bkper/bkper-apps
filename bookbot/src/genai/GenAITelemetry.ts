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

