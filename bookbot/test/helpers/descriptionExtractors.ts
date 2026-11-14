import { Amount } from 'bkper-js';
import { ExtractorAmount } from '../../src/genai/ExtractorAmount.js';
import { ExtractorDate } from '../../src/genai/ExtractorDate.js';

const env: Env = { BKPER_AI_BASE_URL: 'https://ai.bkper.app/v1' };

/** Reads a fixed amount, or nothing, from any description without calling Bkper AI; fails like the real one when given an error. */
export class FixedAmountExtractor extends ExtractorAmount {
    readonly descriptions: string[] = [];

    constructor(private readonly amount?: string, private readonly failed?: (error: unknown) => void, private readonly error?: Error) {
        super(env, undefined, failed);
    }

    override async extract(description: string): Promise<Amount | null> {
        this.descriptions.push(description);
        if (this.error) {
            this.failed?.(this.error);
            return null;
        }
        return this.amount ? new Amount(this.amount) : null;
    }
}

/** Reads a fixed date, or nothing, from any description without calling Bkper AI. */
export class FixedDateExtractor extends ExtractorDate {
    readonly descriptions: string[] = [];

    constructor(private readonly date?: string) {
        super(env);
    }

    override async extract(description: string): Promise<string | undefined> {
        this.descriptions.push(description);
        return this.date;
    }
}
