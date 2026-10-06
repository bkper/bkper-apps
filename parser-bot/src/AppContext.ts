import { Bkper, File } from 'bkper-js';
import { PromptLookupService } from './services/PromptLookupService.js';
import { Discovery } from './services/DiscoveryService.js';
import { FlagManagementService } from './services/FlagManagementService.js';
import { RediscoveryService } from './services/RediscoveryService.js';
import { JevEvaluationService } from './genai/JevEvaluationService.js';
import { ExtractorInvoice } from './genai/invoice/ExtractorInvoice.js';
import { ExtractorStatementCSV } from './genai/statement/csv/ExtractorStatementCSV.js';
import { ExtractorStatementIMG } from './genai/statement/img/ExtractorStatementIMG.js';
import { ExtractorAmount } from './genai/ExtractorAmount.js';
import { ExtractorDate } from './genai/ExtractorDate.js';
import { ExtractorDescriptionParts } from './genai/ExtractorDescriptionParts.js';
import { ExtractorFileClassification } from './genai/file/ExtractorFileClassification.js';
import { ExtractorFileProperties } from './genai/file/ExtractorFileProperties.js';
import { BkperAIEvaluationsClient } from './genai/BkperAIEvaluationsClient.js';
import { BkperAIResponsesClient } from './genai/BkperAIResponsesClient.js';

export class AppContext {
    readonly bkper: Bkper;
    readonly env: Env;
    readonly bkperAIEvaluationsClient: BkperAIEvaluationsClient;
    readonly bkperAIResponsesClient: BkperAIResponsesClient;

    // Lazy-instantiated stateless services (singleton per request)
    private _promptLookupService?: PromptLookupService;
    private _flagManagementService?: FlagManagementService;
    private _jevEvaluationService?: JevEvaluationService;

    constructor(bkper: Bkper, env: Env, oauthToken?: string, requestSignal?: AbortSignal) {
        this.bkper = bkper;
        this.env = env;
        const clientOptions = {
            baseUrl: env.BKPER_AI_BASE_URL,
            oauthToken,
            signal: requestSignal,
        };
        this.bkperAIEvaluationsClient = new BkperAIEvaluationsClient(clientOptions);
        this.bkperAIResponsesClient = new BkperAIResponsesClient(clientOptions);
    }

    // ============================================
    // Stateless Services (lazy singleton per request)
    // ============================================

    get promptLookupService(): PromptLookupService {
        return (this._promptLookupService ??= new PromptLookupService());
    }

    get flagManagementService(): FlagManagementService {
        return (this._flagManagementService ??= new FlagManagementService());
    }

    get jevEvaluationService(): JevEvaluationService {
        return (this._jevEvaluationService ??= new JevEvaluationService(this.bkperAIEvaluationsClient));
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

    // ============================================
    // Factory Methods for File-Specific Extractors
    // ============================================

    createExtractorInvoice(file: File): ExtractorInvoice {
        return new ExtractorInvoice(file, this.env, this.bkperAIResponsesClient);
    }

    createExtractorStatementCSV(file: File): ExtractorStatementCSV {
        return new ExtractorStatementCSV(file, this.env, this.bkperAIResponsesClient);
    }

    createExtractorStatementIMG(file: File): ExtractorStatementIMG {
        return new ExtractorStatementIMG(file, this.env, this.bkperAIResponsesClient);
    }

    createExtractorFileClassification(file: File): ExtractorFileClassification {
        return new ExtractorFileClassification(file, this.env, this.bkperAIResponsesClient);
    }

    createExtractorFileProperties(file: File): ExtractorFileProperties {
        return new ExtractorFileProperties(file, this.env, this.bkperAIResponsesClient);
    }

    // ============================================
    // Factory Methods for Stateless Extractors
    // ============================================

    createExtractorAmount(): ExtractorAmount {
        return new ExtractorAmount(this.env, this.bkperAIResponsesClient);
    }

    createExtractorDate(): ExtractorDate {
        return new ExtractorDate(this.env, this.bkperAIResponsesClient);
    }

    createExtractorDescriptionParts(): ExtractorDescriptionParts {
        return new ExtractorDescriptionParts(this.env, this.bkperAIResponsesClient);
    }
}
