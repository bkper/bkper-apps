import { Bkper, File } from 'bkper-js';
import { PromptLookupService } from './services/PromptLookupService.js';
import { FlagManagementService } from './services/FlagManagementService.js';
import { BookbotDiscoveryClient } from './services/BookbotDiscoveryClient.js';
import { JevEvaluationService } from './genai/JevEvaluationService.js';
import { ExtractorInvoice } from './genai/invoice/ExtractorInvoice.js';
import { ExtractorStatementCSV } from './genai/statement/csv/ExtractorStatementCSV.js';
import { ExtractorStatementIMG } from './genai/statement/img/ExtractorStatementIMG.js';
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

    constructor(bkper: Bkper, env: Env, oauthToken?: string, readonly requestSignal?: AbortSignal, readonly readOnly = false) {
        this.bkper = bkper;
        this.env = env;
        const clientOptions = {
            // Platform apps have no plain variables; Wrangler vars or .dev.vars may override for local development.
            baseUrl: env.BKPER_AI_BASE_URL ?? 'https://ai.bkper.app/v1',
            oauthToken,
            signal: requestSignal,
            readOnly,
        };
        this.bkperAIEvaluationsClient = new BkperAIEvaluationsClient(clientOptions);
        this.bkperAIResponsesClient = new BkperAIResponsesClient(clientOptions);
    }

    // ============================================
    // Stateless Services (lazy singleton per request)
    // ============================================

    get promptLookupService(): PromptLookupService {
        return (this._promptLookupService ??= new PromptLookupService(this.readOnly ? { migrateLegacyPromptProperties: async () => {} } : undefined, !this.readOnly));
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
     * Creates a client for Bookbot's discovery API. Event handlers use it instead of local discovery;
     * Platform outbound delegates the event or user authorization to Bookbot.
     */
    createBookbotDiscoveryClient(): BookbotDiscoveryClient {
        return new BookbotDiscoveryClient(undefined, undefined, this.requestSignal);
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
}
