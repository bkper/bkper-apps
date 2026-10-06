import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Account, Bkper, Book, Transaction, TransactionList } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { ExtractorDescriptionParts } from '../../src/genai/ExtractorDescriptionParts.js';
import { PARSED_ACCOUNT_NAME_PROPERTY } from '../../src/constants.js';

class FailureBook extends Book {
    constructor() {
        super({ id: 'synthetic-book' });
    }

    override async getAccount(id?: string): Promise<Account | undefined> {
        return id ? new Account(this, { id, name: 'Bank', properties: { agent_discovery_examples: 'synthetic' } }) : undefined;
    }

    override async listTransactions(): Promise<TransactionList> {
        throw new Error('Synthetic history failure');
    }
}

class DescriptionParts extends ExtractorDescriptionParts {
    fail = false;

    override async extract(): Promise<string[]> {
        if (this.fail) throw new Error('Synthetic extraction failure');
        return ['purchase'];
    }
}

class FailureContext extends AppContext {
    readonly extractor = new DescriptionParts(this.env);

    constructor() {
        super(new Bkper(), { BKPER_AI_BASE_URL: 'https://ai.bkper.app/v1' });
    }

    override createExtractorDescriptionParts(): ExtractorDescriptionParts {
        return this.extractor;
    }
}

// Existing suites leave prototype spies installed; characterize the real legacy methods.
beforeEach(() => mock.restore());

describe('Discovery legacy failures', () => {
    it('returns empty description parts when the underlying inference fails', async () => {
        class FailingInference extends ExtractorDescriptionParts {
            override async query(): Promise<string[]> {
                throw new Error('Synthetic inference failure');
            }
        }
        const extractor = new FailingInference({ BKPER_AI_BASE_URL: 'https://ai.bkper.app/v1' });

        expect(await extractor.extract('Synthetic purchase')).toEqual([]);
    });
    it('treats a failed history lookup as no match', async () => {
        const context = new FailureContext();
        const draft = new Transaction(new FailureBook(), { description: 'purchase' });

        expect(await context.createDiscovery().discover(draft)).toEqual({ discovered: false });
        expect(draft.json().creditAccount).toBeUndefined();
        expect(draft.json().debitAccount).toBeUndefined();
    });

    it('returns false after locally removing the parsed account when extraction fails', async () => {
        const context = new FailureContext();
        context.extractor.fail = true;
        const draft = new Transaction(new FailureBook(), {
            description: 'Bank purchase',
            properties: { [PARSED_ACCOUNT_NAME_PROPERTY]: 'Bank' },
        });

        expect(await context.createDiscovery().discover(draft)).toEqual({ discovered: false });
        expect(draft.getProperty(PARSED_ACCOUNT_NAME_PROPERTY)).toBeUndefined();
    });
});
