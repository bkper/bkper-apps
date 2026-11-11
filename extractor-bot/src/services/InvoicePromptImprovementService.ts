import { Account, Book, File, Transaction } from 'bkper-js';
import { AGENT_EXTRACTED_PROPERTY } from '../constants.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { CuratorInvoice } from '../genai/invoice/CuratorInvoice.js';
import { ExtractorInvoice } from '../genai/invoice/ExtractorInvoice.js';
import { ReflectorInvoice } from '../genai/invoice/ReflectorInvoice.js';
import { ReflectionResult } from '../genai/ace/ReflectionResult.js';
import { JevInvoiceDescriptionComparator, PromptImprovementServiceBase } from './PromptImprovementServiceBase.js';
import { AppContext } from '../AppContext.js';
import { PromptResolution } from './PromptLookupService.js';
import { ACEResult, logACEResult } from '../genai/ace/ACEResult.js';
import { GenAIRequestContext } from '../genai/GenAITelemetry.js';
import { BkperAIClientError } from '../genai/BkperAIClientError.js';

export class InvoicePromptImprovementService extends PromptImprovementServiceBase {
    private context: AppContext;

    constructor(context: AppContext) {
        super(new JevInvoiceDescriptionComparator(context.jevEvaluationService));
        this.context = context;
    }

    protected override getChangeDetectionThreshold(): undefined {
        return undefined;
    }

    async improveInvoicePrompt(book: Book, transaction: Transaction): Promise<null | string> {
        const file = await this.validateTransactionPrerequisites(book, transaction);
        if (!file) return null;

        const promptLookup = await this.lookupPromptLocation(book, transaction, file);
        if (!promptLookup) return null;

        const parserLookup = await this.context.promptLookupService.lookupTransactionParserUrl({
            book,
            transaction,
            file,
            account: promptLookup.account,
            group: promptLookup.group,
        });
        if (parserLookup) {
            console.log('Transaction parser URL configured - skipping invoice ACE');
            return null;
        }

        // Resolve user-defined skip keys through the shared account/group/book policy.
        const userDefinedSkipKeys = Array.from(await this.context.promptLookupService.lookupPropertySkipKeys({
            book,
            account: promptLookup.account,
            group: promptLookup.group,
        }));

        if (!await this.needsPromptImprovement(transaction, userDefinedSkipKeys)) {
            return null;
        }

        const currentPrompt = promptLookup.prompt || this.context.createExtractorInvoice(file).getDefaultUserPrompt();
        const account = promptLookup.account || null;
        let comparison: { aiExtracted: ExtractedTransaction; userCorrected: ExtractedTransaction };
        try {
            comparison = await this.buildTransactionComparison(transaction, account, userDefinedSkipKeys);
        } catch (error) {
            console.error('❌ ACE: Pipeline failed with error:', error);
            return null;
        }

        let epochsAttempted = 0;
        let aceResult: ACEResult = {
            kind: 'invoice',
            outcome: 'pipeline_failed',
            epochsAttempted,
            reason: 'unexpected_error',
        };

        try {
            console.log('🔄 ACE: Starting prompt improvement pipeline');

            const preValidationResult = await this.performPreValidation(file, currentPrompt, comparison.userCorrected);
            if (preValidationResult.shouldSkip || !preValidationResult.preExtracted) {
                aceResult = {
                    kind: 'invoice',
                    outcome: preValidationResult.currentPromptValid ? 'current_prompt_valid' : 'pre_validation_failed',
                    epochsAttempted,
                    reason: preValidationResult.currentPromptValid ? undefined : 'no_response',
                };
                return null;
            }

            const preExtracted = preValidationResult.preExtracted;

            const hasStoredPrompt = !!promptLookup.prompt;

            // Multi-epoch adaptation (ACE framework - https://arxiv.org/html/2510.04618v1)
            // Each epoch refines the context by:
            // 1. Reflection: Analyze extraction results vs user corrections to identify failures
            // 2. Curation: Extract new instruction bullets and merge with existing ones (semantic deduplication)
            // 3. Validation: Test improved prompt; if successful, save; if failed, use new extraction for next epoch
            // Bullets accumulate across epochs, creating comprehensive, evolving prompts
            const MAX_EPOCHS = 2;
            let accumulatedPrompt = currentPrompt;
            let lastExtractedTransaction = comparison.aiExtracted;

            for (let epochNum = 1; epochNum <= MAX_EPOCHS; epochNum++) {
                epochsAttempted = epochNum;
                console.log(`\n🔄 ACE Epoch ${epochNum}/${MAX_EPOCHS}`);

                // Build comparison data for this epoch
                const epochComparison = {
                    aiExtracted: lastExtractedTransaction,
                    userCorrected: comparison.userCorrected,
                };

                const reflection = await this.performReflection(file, epochComparison, accumulatedPrompt, epochNum);
                if (!reflection) {
                    aceResult = { kind: 'invoice', outcome: 'reflection_failed', epochsAttempted, reason: 'no_response' };
                    return null;
                }

                const curationResult = await this.performCuration(reflection, accumulatedPrompt, epochNum);
                if (!curationResult) {
                    aceResult = { kind: 'invoice', outcome: 'curation_failed', epochsAttempted, reason: 'no_response' };
                    return null;
                }

                const { improvedPrompt, reasoning } = curationResult;
                accumulatedPrompt = improvedPrompt;

                const validationResult = await this.performPostValidation(
                    file,
                    improvedPrompt,
                    epochComparison,
                    preExtracted,
                    hasStoredPrompt,
                    epochNum,
                    userDefinedSkipKeys
                );

                if (validationResult.passed) {
                    // Validation passed - save and return success
                    aceResult = { kind: 'invoice', outcome: 'save_failed', epochsAttempted, reason: 'save_error' };
                    const result = await this.saveImprovedPrompt(promptLookup.promptEntity, promptLookup.targetProperty, improvedPrompt, reasoning);
                    if (result) {
                        aceResult = { kind: 'invoice', outcome: 'prompt_updated', epochsAttempted, successfulEpoch: epochNum };
                        return result;
                    }
                    aceResult = { kind: 'invoice', outcome: 'save_failed', epochsAttempted, reason: 'save_returned_empty' };
                    return null;
                }

                // Validation failed
                if (!validationResult.extractedTransaction) {
                    console.log('❌ Extraction failed - cannot continue to next epoch');
                    aceResult = { kind: 'invoice', outcome: 'extraction_failed', epochsAttempted, reason: 'no_response' };
                    return null;
                }

                if (epochNum === MAX_EPOCHS) {
                    // Last epoch failed - return null
                    console.log(`❌ All ${MAX_EPOCHS} epochs failed`);
                    aceResult = { kind: 'invoice', outcome: 'validation_failed', epochsAttempted, reason: 'no_improvement' };
                    return null;
                }

                // Not the last epoch - extract with new prompt for next iteration
                console.log(`⚠️  Epoch ${epochNum} validation failed - attempting epoch ${epochNum + 1}`);
                lastExtractedTransaction = validationResult.extractedTransaction;
            }

            // Should never reach here due to loop logic, but TypeScript needs it
            return null;
        } catch (error) {
            if (error instanceof BkperAIClientError && error.code === 'request_aborted') {
                throw error;
            }
            if (error instanceof BkperAIClientError && error.code === 'usage_limit_exceeded') {
                aceResult = {
                    kind: 'invoice',
                    outcome: 'quota_deferred',
                    epochsAttempted,
                    reason: 'usage_limit_exceeded',
                };
                return null;
            }
            if (aceResult.outcome !== 'save_failed') {
                aceResult = { kind: 'invoice', outcome: 'pipeline_failed', epochsAttempted, reason: 'unexpected_error' };
            }
            console.error('❌ ACE: Pipeline failed with error:', error);
            return null;
        } finally {
            logACEResult(aceResult);
        }
    }

    /**
     * Validate transaction has required prerequisites (files and extracted property).
     */
    private async validateTransactionPrerequisites(book: Book, transaction: Transaction): Promise<File | null> {
        if (!transaction.getFiles() || transaction.getFiles().length === 0) {
            return null;
        }
        if (!transaction.getProperty(AGENT_EXTRACTED_PROPERTY)) {
            return null;
        }

        const file = await book.getFile(transaction.getFiles()[0].getId() || '');
        if (!file) {
            return null;
        }

        return file;
    }

    /**
     * Lookup where the prompt is stored (account or group).
     */
    private async lookupPromptLocation(book: Book, transaction: Transaction, file: File): Promise<PromptResolution | null> {
        console.log(file.getProperties());
        const promptContext = await this.context.promptLookupService.lookupPrompts({ book, transaction, file });
        const promptResolution = promptContext?.getPrompt('transaction');
        if (!promptResolution?.promptEntity) {
            console.log('No prompt lookup result');
            return null;
        }
        return promptResolution;
    }

    /**
     * Perform pre-validation to check if current prompt already works.
     * Returns the preExtracted result for reuse in post-validation.
     */
    private async performPreValidation(file: File, currentPrompt: string, userCorrected: ExtractedTransaction): Promise<{ shouldSkip: boolean; currentPromptValid?: boolean; preExtracted?: ExtractedTransaction }> {
        const preValidator: ExtractorInvoice = this.context.createExtractorInvoice(file);
        const requestContext: GenAIRequestContext = {
            operation: 'ace',
            document_kind: 'invoice',
            stage: 'pre_validation',
        };
        const preExtracted = await preValidator.extract(currentPrompt, requestContext);

        if (!preExtracted) {
            console.warn('⚠️  ACE: Pre-extraction failed - cannot improve prompt');
            return { shouldSkip: true, currentPromptValid: false };
        }

        const preValid = await this.exactMatch(preExtracted, userCorrected, undefined, requestContext);
        if (preValid) {
            console.log('Current prompt already produces correct extraction - skipping ACE pipeline');
            return { shouldSkip: true, currentPromptValid: true };
        }

        return { shouldSkip: false, preExtracted };
    }

    /**
     * Perform reflection analysis on transaction data.
     *
     * @param currentPrompt - Current accumulated prompt to provide context for multi-epoch analysis
     */
    private async performReflection(file: File, comparison: { aiExtracted: ExtractedTransaction; userCorrected: ExtractedTransaction }, currentPrompt: string | undefined, epoch: number): Promise<ReflectionResult | null> {
        console.log('🔍 ACE: Reflecting on extraction quality');
        const reflector = new ReflectorInvoice(file, this.context.env, this.context.bkperAIResponsesClient);
        const reflection = await reflector.reflect([comparison.aiExtracted], [comparison.userCorrected], [], currentPrompt, {
            operation: 'ace',
            document_kind: 'invoice',
            stage: 'reflection',
            epoch,
        });

        if (!reflection) {
            console.error('❌ ACE: Reflection failed');
            return null;
        }
        console.log(`✅ ACE: Reflection complete - ${reflection.whatFailed.length} issues identified`);

        return reflection;
    }

    /**
     * Perform curation by extracting and merging bullets.
     */
    private async performCuration(reflection: ReflectionResult, currentPrompt: string, epoch: number): Promise<{ improvedPrompt: string; reasoning: string } | null> {
        console.log('📝 ACE: Extracting bullets from failures');
        const curator = new CuratorInvoice(reflection, this.context.env, this.context.bkperAIResponsesClient);
        const newBullets = await curator.extractNewBullets({
            operation: 'ace',
            document_kind: 'invoice',
            stage: 'curation',
            epoch,
        });

        if (!newBullets) {
            console.error('❌ ACE: Bullet extraction failed');
            return null;
        }

        const existingBullets = currentPrompt.split('\n').filter(line => line.trim().startsWith('- ')).map(line => line.trim().substring(2).trim());
        const mergedBullets = [...existingBullets, ...newBullets];
        const improvedPrompt = mergedBullets.map(b => `- ${b}`).join('\n');
        const reasoning = `Added ${newBullets.length} instruction${newBullets.length !== 1 ? 's' : ''} to address failures`;

        console.log(`✅ ACE: Prompt improved - ${reasoning}`);

        this.monitorPromptSize(improvedPrompt, 'Invoice Extraction Prompt');

        return { improvedPrompt, reasoning };
    }

    /**
     * Perform post-validation of improved prompt.
     * Returns validation result with extracted transaction for potential next epoch.
     *
     * @param preExtracted - Pre-computed extraction from performPreValidation (reused across epochs)
     */
    private async performPostValidation(
        file: File,
        improvedPrompt: string,
        comparison: { aiExtracted: ExtractedTransaction; userCorrected: ExtractedTransaction },
        preExtracted: ExtractedTransaction,
        hasStoredPrompt: boolean,
        epochNum: number = 1,
        userDefinedSkipKeys?: string[]
    ): Promise<{ passed: boolean; extractedTransaction?: ExtractedTransaction }> {
        console.log('✓ ACE: Validating improved prompt (partial improvement enabled)');
        const postValidator: ExtractorInvoice = this.context.createExtractorInvoice(file);
        const requestContext: GenAIRequestContext = {
            operation: 'ace',
            document_kind: 'invoice',
            stage: 'post_validation',
            epoch: epochNum,
        };
        const postExtracted = await postValidator.extract(improvedPrompt, requestContext);

        if (!postExtracted) {
            console.warn('⚠️  ACE: Post-extraction failed - prompt not updated');
            return { passed: false };
        }

        const comparisonResult = await this.compareExtractions(preExtracted, postExtracted, comparison.userCorrected, undefined, userDefinedSkipKeys, requestContext);

        if (!comparisonResult.isImprovement) {
            const isBaselineAcceptance = comparisonResult.improvements === 0 && comparisonResult.regressions === 0 && !hasStoredPrompt && epochNum === 1;

            if (isBaselineAcceptance) {
                const message = '✓ ACE: No improvements/regressions, but accepting as baseline prompt (no prompt stored yet)';
                console.log(message);
                return { passed: true, extractedTransaction: postExtracted };
            }

            let warningMsg = `⚠️  ACE: No improvement detected - improvements: ${comparisonResult.improvements}, regressions: ${comparisonResult.regressions}`;

            if (comparisonResult.regressions > 0 && comparisonResult.regressionDetails.length > 0) {
                warningMsg += this.formatRegressionDetails(comparisonResult.regressionDetails);
            }

            console.warn(warningMsg);
            return { passed: false, extractedTransaction: postExtracted };
        }

        console.log(`✅ ACE: Partial improvement validated - ${comparisonResult.improvements} properties fixed, ${comparisonResult.matches} properties maintained, ${comparisonResult.stillWrong} still need work`);
        return { passed: true, extractedTransaction: postExtracted };
    }


    private async buildTransactionComparison(transaction: Transaction, account: Account | null, userDefinedSkipKeys?: string[]): Promise<{ aiExtracted: ExtractedTransaction; userCorrected: ExtractedTransaction }> {
        // Get current transaction values (user corrected - final state)
        // Use base class method with property filtering enabled
        // For invoices, pick whichever account exists (debit or credit)
        const userCorrected = await this.transactionToExtractedTransaction(transaction, account, userDefinedSkipKeys);

        // Get AI extracted data from property
        const extractedJson = transaction.getProperty(AGENT_EXTRACTED_PROPERTY);

        if (!extractedJson) {
            throw new Error('AGENT_EXTRACTED_PROPERTY not found');
        }

        const aiExtracted = JSON.parse(extractedJson) as ExtractedTransaction;

        // Filter out user-defined skip keys from AI extracted properties
        if (aiExtracted.properties && userDefinedSkipKeys && userDefinedSkipKeys.length > 0) {
            aiExtracted.properties = this.filterProperties(aiExtracted.properties, userDefinedSkipKeys);
        }

        return { aiExtracted, userCorrected };
    }

    /**
     * Filter properties by removing user-defined skip keys.
     */
    private filterProperties(properties: Record<string, string | number>, userDefinedSkipKeys: string[]): Record<string, string | number> {
        const filtered: Record<string, string | number> = {};
        for (const key in properties) {
            if (!this.shouldSkipProperty(key, userDefinedSkipKeys)) {
                filtered[key] = properties[key];
            }
        }
        return filtered;
    }
}
