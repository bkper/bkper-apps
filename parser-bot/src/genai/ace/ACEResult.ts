export type ACEKind = 'invoice' | 'statement';

export type ACEOutcome =
    | 'prompt_updated'
    | 'current_prompt_valid'
    | 'pre_validation_failed'
    | 'reflection_failed'
    | 'curation_failed'
    | 'validation_failed'
    | 'extraction_failed'
    | 'save_failed'
    | 'pipeline_failed'
    | 'quota_deferred';

export type ACEFailureReason =
    | 'unexpected_error'
    | 'no_response'
    | 'no_improvement'
    | 'transaction_count_mismatch'
    | 'no_new_instructions'
    | 'save_error'
    | 'save_returned_empty'
    | 'usage_limit_exceeded';

export interface ACEResult {
    kind: ACEKind;
    outcome: ACEOutcome;
    epochsAttempted: number;
    successfulEpoch?: number;
    reason?: ACEFailureReason;
}

export function logACEResult(result: ACEResult): void {
    console.log(`ACE_RESULT ${JSON.stringify(result)}`);
}
