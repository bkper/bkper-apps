import { Transaction } from 'bkper-js';
import { AUTO_FILLED_DATE_PROPERTY } from '../constants.js';
import { AppContext } from '../AppContext.js';

/**
 * Fills what a draft's description states and the draft lacks: a missing amount, and a date Bkper filled in
 * automatically. Never replaces a supplied amount or a date the user chose.
 */
export class DescriptionCompletion {
    constructor(private readonly context: AppContext, private readonly onError?: (error: unknown) => void) {}

    /** Returns true when the amount or date was filled. */
    async complete(draft: Transaction): Promise<boolean> {
        let completed = false;

        if (draft.getAmount() == null) {
            // Extract amount from description using AI
            const extractedAmount = await this.context.createExtractorAmount(this.onError).extract(draft.getDescription() || '');
            if (extractedAmount && extractedAmount.gt(0)) {
                draft.setAmount(extractedAmount);
                completed = true;
            }
        }

        if (draft.getProperty(AUTO_FILLED_DATE_PROPERTY)) {
            // Extract date from description using AI
            const extractedDate = await this.context.createExtractorDate(this.onError).extract(draft.getDescription() || '');
            if (extractedDate) {
                draft.setDate(extractedDate);
                completed = true;
            }
        }

        return completed;
    }
}
