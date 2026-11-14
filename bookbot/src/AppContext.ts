import { Bkper } from 'bkper-js';
import { PromptLookupService } from './services/PromptLookupService.js';
import { Discovery } from './services/DiscoveryService.js';
import { RediscoveryService } from './services/RediscoveryService.js';
import { ExtractorDescriptionParts } from './genai/ExtractorDescriptionParts.js';
import { ExtractorAmount } from './genai/ExtractorAmount.js';
import { ExtractorDate } from './genai/ExtractorDate.js';
import { DescriptionCompletion } from './services/DescriptionCompletion.js';
import { BkperAIResponsesClient } from './genai/BkperAIResponsesClient.js';
import { AccountChooser } from './genai/AccountChooser.js';

/** Bookbot's request context: draft completion, account discovery, rediscovery, and their Bkper AI clients. */
export class AppContext {
    readonly bkper: Bkper;
    readonly env: Env;
    readonly bkperAIResponsesClient: BkperAIResponsesClient;
    private readonly requestSignal?: AbortSignal;

    // Lazy-instantiated stateless services (singleton per request)
    private _promptLookupService?: PromptLookupService;

    constructor(bkper: Bkper, env: Env, oauthToken?: string, requestSignal?: AbortSignal) {
        this.bkper = bkper;
        this.env = env;
        this.requestSignal = requestSignal;
        const clientOptions = {
            // Platform apps have no plain variables; Wrangler vars or .dev.vars may override for local development.
            baseUrl: env.BKPER_AI_BASE_URL ?? 'https://ai.bkper.app/v1',
            oauthToken,
            signal: requestSignal,
        };
        this.bkperAIResponsesClient = new BkperAIResponsesClient(clientOptions);
    }

    // ============================================
    // Stateless Services (lazy singleton per request)
    // ============================================

    get promptLookupService(): PromptLookupService {
        return (this._promptLookupService ??= new PromptLookupService());
    }

    // ============================================
    // Factory Methods for Stateful/Batch-Scoped Objects
    // ============================================

    /**
     * Creates a new Discovery instance for batch operations.
     * Discovery maintains caches (transactions, accounts, description parts)
     * that should be scoped to a single batch operation.
     */
    createDiscovery(): Discovery {
        return new Discovery(this);
    }

    /**
     * Creates a new RediscoveryService instance.
     * RediscoveryService creates its own Discovery internally for batch operations.
     */
    createRediscoveryService(): RediscoveryService {
        return new RediscoveryService(this);
    }

    createExtractorDescriptionParts(onError?: (error: unknown) => void): ExtractorDescriptionParts {
        return new ExtractorDescriptionParts(this.env, this.bkperAIResponsesClient, onError);
    }

    createDescriptionCompletion(onError?: (error: unknown) => void): DescriptionCompletion {
        return new DescriptionCompletion(this, onError);
    }

    createExtractorAmount(onError?: (error: unknown) => void): ExtractorAmount {
        return new ExtractorAmount(this.env, this.bkperAIResponsesClient, onError);
    }

    createExtractorDate(onError?: (error: unknown) => void): ExtractorDate {
        return new ExtractorDate(this.env, this.bkperAIResponsesClient, onError);
    }

    createAccountChooser(): AccountChooser {
        return new AccountChooser({ baseUrl: this.env.BKPER_AI_BASE_URL, signal: this.requestSignal });
    }
}
