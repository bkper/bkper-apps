import { Account, Book, File, Group, Transaction } from 'bkper-js';
import { AGENT_CREDIT_ACCOUNT_ID_PROPERTY, AGENT_DEBIT_ACCOUNT_ID_PROPERTY, AGENT_EXTRACTED_PROPERTY, AGENT_FILE_ID_PROPERTY, AGENT_PARSER_TRANSACTIONS_PROPERTY, AGENT_PROMPT_IMPROVE_PROPERTY, AGENT_PROMPT_PROPERTY, AGENT_PROMPT_TRANSACTIONS_PROPERTY } from '../constants.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { CuratorStatementIMG } from '../genai/statement/img/CuratorStatementIMG.js';
import { ExtractorStatementIMG } from '../genai/statement/img/ExtractorStatementIMG.js';
import { ReflectorStatementIMG } from '../genai/statement/img/ReflectorStatementIMG.js';
import { CuratorStatementCSV } from '../genai/statement/csv/CuratorStatementCSV.js';
import { ExtractorStatementCSV } from '../genai/statement/csv/ExtractorStatementCSV.js';
import { ReflectorStatementCSV } from '../genai/statement/csv/ReflectorStatementCSV.js';
import { PromptImprovementServiceBase, RegressionDetail, JaroWinklerStringComparator } from './PromptImprovementServiceBase.js';
import { BulletMerger } from '../genai/ace/BulletMerger.js';
import { ReflectionResult } from '../genai/ace/ReflectionResult.js';
import { AppContext } from '../AppContext.js';
import { ExtractorUrlLookupResult } from './PromptLookupService.js';
import { ACEResult, logACEResult } from '../genai/ace/ACEResult.js';
import { BkperAIClientError } from '../genai/BkperAIClientError.js';

/**
 * Maximum number of transactions to retrieve when querying statement transactions.
 * Default limit is 100, but statements can contain more transactions.
 * Max allowed by API is 1000.
 */
const STATEMENT_TRANSACTION_LIMIT = 500;

/**
 * Service to handle Statement ACE (Agentic Context Engineering) pipeline.
 * This service is separate from PromptImprovementService (which handles invoices).
 * It manages the async process of learning from user corrections on multi-transaction statements.
 */
export class StatementPromptImprovementService extends PromptImprovementServiceBase {
    private context: AppContext;

    constructor(context: AppContext) {
        super(new JaroWinklerStringComparator());
        this.context = context;
    }

    /**
     * Detect if file is CSV based on content type
     */
    private isCSVFile(file: File): boolean {
        const contentType = file.getContentType();
        return contentType === 'text/csv' || contentType === 'application/csv';
    }

    /**
     * Flag statement for improvement on TRANSACTION_UPDATED or TRANSACTION_DELETED.
     * This method analyzes if changes to a transaction indicate the statement extraction
     * needs improvement, and if so, flags the appropriate account or group.
     *
     * @param book - The Book containing the transaction
     * @param transaction - The transaction that was updated or deleted
     * @returns Promise<boolean> - True if statement was flagged, false otherwise
     */
    async flagStatementForImprovement(book: Book, transaction: Transaction): Promise<null | string> {
        // Step 1: Pre-checks - must have agent_file_id_ property (statement indicator)
        const fileId = transaction.getProperty(AGENT_FILE_ID_PROPERTY);
        if (!fileId) {
            console.log('Transaction has no agent_file_id_ property');
            return null; // Not a statement transaction
        }

        // Step 2: Must have baseline AI extraction stored
        const aiExtractedJson = transaction.getProperty(AGENT_EXTRACTED_PROPERTY);
        if (!aiExtractedJson) {
            console.log('Transaction has no baseline AI extraction');
            return null; // No baseline to compare against
        }

        // Step 3: Cheap change detection before API lookups.
        // This uses only the built-in skip rules. If no changes are found here,
        // user-defined skip keys can only keep that result unchanged, so it is safe to exit.
        const isTrashed = transaction.isTrashed() === true;
        if (isTrashed && await this.hasFlaggedTransactionAccount(transaction)) {
            return null;
        }

        const preliminaryNeedsImprovement = isTrashed || await this.needsPromptImprovement(transaction);
        if (!preliminaryNeedsImprovement) {
            console.log('No significant changes detected in transaction');
            return null; // No changes detected
        }

        // Step 4: Find where prompt is stored using PromptLookupService
        const file = await book.getFile(fileId);
        if (!file) {
            console.error(`File ${fileId} not found`);
            return null;
        }

        const promptContext = await this.context.promptLookupService.lookupPrompts({
            book,
            transaction,
            file,
        });
        const promptResolution = promptContext?.getPrompt('transactions');

        if (!promptResolution?.promptEntity) {
            console.log('No prompt lookup result');
            return null;
        }

        const parserLookup = await this.context.promptLookupService.lookupTransactionsParserUrl({
            book,
            transaction,
            file,
            account: promptResolution.account,
            group: promptResolution.group,
        });
        if (parserLookup) {
            console.log('Transactions parser URL configured - skipping statement ACE flagging');
            return null;
        }

        // Step 5: Resolve user-defined skip keys through the shared account/group/book policy.
        const entity = promptResolution.promptEntity;
        const userDefinedSkipKeys = Array.from(await this.context.promptLookupService.lookupPropertySkipKeys({
            book,
            account: promptResolution.account,
            group: promptResolution.group,
        }));

        // Step 6: Re-check only when user-defined skip keys can change the preliminary result.
        const needsImprovement = isTrashed || userDefinedSkipKeys.length === 0 || await this.needsPromptImprovement(transaction, userDefinedSkipKeys);
        if (!needsImprovement) {
            console.log('No significant changes detected in transaction');
            return null; // No changes detected
        }

        // Step 7: Set flag on the prompt owner entity
        await this.context.flagManagementService.setImprovementFlag(entity, file);
        const msg = `Prompt flagged for improvement: ${entity.getName()}`;
        console.log(msg);
        return msg;
    }

    private async hasFlaggedTransactionAccount(transaction: Transaction): Promise<boolean> {
        const [creditAccount, debitAccount] = await Promise.all([
            this.getTransactionAccountSafely(transaction, 'credit'),
            this.getTransactionAccountSafely(transaction, 'debit'),
        ]);
        const accounts = this.getStatementAccountCandidates(transaction, creditAccount, debitAccount);

        for (const account of accounts) {
            if (account.getProperty(AGENT_PROMPT_IMPROVE_PROPERTY)) {
                console.log(`Statement already flagged for improvement on transaction account: ${account.getName()}`);
                return true;
            }
        }

        return false;
    }

    private getStatementAccountCandidates(transaction: Transaction, creditAccount: Account | undefined, debitAccount: Account | undefined): Account[] {
        const candidates: Account[] = [];
        const agentCreditAccountId = transaction.getProperty(AGENT_CREDIT_ACCOUNT_ID_PROPERTY);
        const agentDebitAccountId = transaction.getProperty(AGENT_DEBIT_ACCOUNT_ID_PROPERTY);

        if (creditAccount && (!agentCreditAccountId || creditAccount.getId() !== agentCreditAccountId)) {
            candidates.push(creditAccount);
        }
        if (debitAccount && (!agentDebitAccountId || debitAccount.getId() !== agentDebitAccountId)) {
            candidates.push(debitAccount);
        }

        return candidates.length > 0 ? candidates : [creditAccount, debitAccount].filter((account): account is Account => account != null);
    }

    private async getTransactionAccountSafely(transaction: Transaction, side: 'credit' | 'debit'): Promise<Account | undefined> {
        try {
            return side === 'credit' ? await transaction.getCreditAccount() : await transaction.getDebitAccount();
        } catch (error) {
            console.error(`Failed to read ${side} account while checking existing statement flag`, error);
            return undefined;
        }
    }

    /**
     * Run full ACE pipeline for statement.
     * This method is called during BOOK_AUDITED to process one flagged statement.
     *
     * Implements multi-epoch adaptation as described in the ACE paper:
     * https://arxiv.org/html/2510.04618v1
     *
     * @param book - The Book containing the statement
     * @param entity - The Account or Group that was flagged for improvement
     * @param env - The environment configuration
     * @returns Promise<string | false> - Success message with reasoning, or false if failed/skipped
     */
    async improveStatementPrompt(book: Book, entity: Account | Group): Promise<string | null> {
        const isAccount = entity instanceof Account;
        const entityName = entity.getName();

        const file = await this.findFileForEntity(book, entity, isAccount, entityName);
        if (!file) return null;

        const parserLookup = await this.lookupTransactionsParserForEntity(book, entity, isAccount);
        if (parserLookup) {
            console.log('Transactions parser URL configured - clearing statement ACE flag');
            await this.context.flagManagementService.clearImprovementFlag(entity);
            return null;
        }

        const isCSV = this.isCSVFile(file);
        const currentPrompt = this.getCurrentPrompt(entity, file, isCSV);
        if (!currentPrompt) {
            console.log('No prompt found on entity - clearing flag');
            await this.context.flagManagementService.clearImprovementFlag(entity);
            return null;
        }

        const hasStoredPrompt = !!this.getStoredTransactionsPrompt(entity);

        const comparison = await this.buildTransactionDataset(book, file, entity, isAccount);
        if (!comparison) return null;

        let epochsAttempted = 0;
        let aceResult: ACEResult = {
            kind: 'statement',
            outcome: 'pipeline_failed',
            epochsAttempted,
            reason: 'unexpected_error',
        };

        try {
            // Multi-epoch adaptation (ACE framework - https://arxiv.org/html/2510.04618v1)
            // Each epoch refines the context by:
            // 1. Reflection: Analyze extraction results vs user corrections to identify failures
            // 2. Curation: Extract new instruction bullets and merge with existing ones (semantic deduplication)
            // 3. Validation: Test improved prompt; if successful, save; if failed, use new extraction for next epoch
            // Bullets accumulate across epochs, creating comprehensive, evolving prompts
            const MAX_EPOCHS = 2;
            let accumulatedPrompt = currentPrompt;
            let lastExtractedTransactions = comparison.aiExtracted;

            for (let epochNum = 1; epochNum <= MAX_EPOCHS; epochNum++) {
                epochsAttempted = epochNum;
                console.log(`\n🔄 ACE Epoch ${epochNum}/${MAX_EPOCHS}`);

                // Build comparison data for this epoch
                const epochComparison = {
                    aiExtracted: lastExtractedTransactions,
                    userCorrected: comparison.userCorrected,
                    userRemoved: comparison.userRemoved,
                };

                const reflection = await this.performReflection(file, epochComparison, isCSV, accumulatedPrompt, epochNum);
                if (!reflection) {
                    aceResult = { kind: 'statement', outcome: 'reflection_failed', epochsAttempted, reason: 'no_response' };
                    if (epochNum === MAX_EPOCHS) {
                        await this.context.flagManagementService.clearImprovementFlag(entity);
                    }
                    return null;
                }

                const curationResult = await this.performCuration(reflection, accumulatedPrompt, hasStoredPrompt, isCSV, epochNum);
                if (!curationResult) {
                    aceResult = { kind: 'statement', outcome: 'curation_failed', epochsAttempted, reason: 'no_new_instructions' };
                    if (epochNum === MAX_EPOCHS) {
                        await this.context.flagManagementService.clearImprovementFlag(entity);
                    }
                    return null;
                }

                const { improvedPrompt, reasoning } = curationResult;
                accumulatedPrompt = improvedPrompt;

                const validationResult = await this.performPostValidation(file, improvedPrompt, comparison, hasStoredPrompt, isCSV, epochNum, MAX_EPOCHS);

                if (validationResult.passed) {
                    // Validation passed - save and return success
                    aceResult = { kind: 'statement', outcome: 'save_failed', epochsAttempted, reason: 'save_error' };
                    const response = await this.saveImprovedPrompt(entity, AGENT_PARSER_TRANSACTIONS_PROPERTY, improvedPrompt, reasoning);

                    aceResult = response
                        ? { kind: 'statement', outcome: 'prompt_updated', epochsAttempted, successfulEpoch: epochNum }
                        : { kind: 'statement', outcome: 'save_failed', epochsAttempted, reason: 'save_returned_empty' };
                    await this.context.flagManagementService.clearImprovementFlag(entity);
                    return response;
                }

                // Validation failed
                if (!validationResult.extractedTransactions) {
                    console.log('❌ Extraction failed - cannot continue to next epoch');
                    aceResult = { kind: 'statement', outcome: 'extraction_failed', epochsAttempted, reason: 'no_response' };
                    await this.context.flagManagementService.clearImprovementFlag(entity);
                    return null;
                }

                if (epochNum === MAX_EPOCHS) {
                    // Last epoch failed - clear flag and return false
                    console.log(`❌ All ${MAX_EPOCHS} epochs failed - clearing flag`);
                    aceResult = {
                        kind: 'statement',
                        outcome: 'validation_failed',
                        epochsAttempted,
                        reason: validationResult.failureReason ?? 'no_improvement',
                    };
                    await this.context.flagManagementService.clearImprovementFlag(entity);
                    return null;
                }

                // Not the last epoch - extract with new prompt for next iteration
                console.log(`⚠️  Epoch ${epochNum} validation failed - attempting epoch ${epochNum + 1}`);
                lastExtractedTransactions = validationResult.extractedTransactions;
            }

            // Should never reach here due to loop logic, but TypeScript needs it
            await this.context.flagManagementService.clearImprovementFlag(entity);
            return null;
        } catch (error) {
            if (error instanceof BkperAIClientError && error.code === 'usage_limit_exceeded') {
                aceResult = {
                    kind: 'statement',
                    outcome: 'quota_deferred',
                    epochsAttempted,
                    reason: 'usage_limit_exceeded',
                };
                return null;
            }
            throw error;
        } finally {
            aceResult.epochsAttempted = epochsAttempted;
            logACEResult(aceResult);
        }
    }

    /**
     * Find file associated with entity by querying transactions.
     */
    private async findFileForEntity(book: Book, entity: Account | Group, isAccount: boolean, entityName: string | undefined): Promise<File | null> {
        const query = isAccount ? `account:"${entityName}"` : `group:"${entityName}"`;
        const transactionsList = await book.listTransactions(query, STATEMENT_TRANSACTION_LIMIT);
        const transactions = transactionsList.getItems();

        let fileId: string | undefined = undefined;

        for (const txn of transactions) {
            const fileIdValue = txn.getProperty(AGENT_FILE_ID_PROPERTY);
            if (fileIdValue) {
                fileId = fileIdValue;
                break;
            }
        }

        if (!fileId) {
            console.error('No file ID found for flagged entity - clearing flag');
            await this.context.flagManagementService.clearImprovementFlag(entity);
            return null;
        }

        const file = await book.getFile(fileId);
        if (!file) {
            console.error(`File ${fileId} not found - Book id ${book.getId()} - Owner ${book.getOwnerName()} - clearing flag`);
            await this.context.flagManagementService.clearImprovementFlag(entity);
            return null;
        }

        return file;
    }

    /**
     * Get current prompt from entity or generate default.
     */
    private getCurrentPrompt(entity: Account | Group, file: File, isCSV: boolean): string | null {
        const storedPrompt = this.getStoredTransactionsPrompt(entity);
        if (storedPrompt) return storedPrompt;

        const defaultPrompt = isCSV
            ? this.context.createExtractorStatementCSV(file).getDefaultUserPrompt()
            : this.context.createExtractorStatementIMG(file).getDefaultUserPrompt();

        return defaultPrompt || null;
    }

    private getStoredTransactionsPrompt(entity: Account | Group): string | undefined {
        return entity.getProperty(AGENT_PARSER_TRANSACTIONS_PROPERTY) || entity.getProperty(AGENT_PROMPT_TRANSACTIONS_PROPERTY) || entity.getProperty(AGENT_PROMPT_PROPERTY);
    }

    private async lookupTransactionsParserForEntity(book: Book, entity: Account | Group, isAccount: boolean): Promise<ExtractorUrlLookupResult | null> {
        if (isAccount) {
            return this.context.promptLookupService.lookupTransactionsParserUrl({ book, account: entity as Account });
        }
        return this.context.promptLookupService.lookupTransactionsParserUrl({ book, group: entity as Group });
    }

    /**
     * Build complete transaction dataset with comparison data.
     */
    private async buildTransactionDataset(book: Book, file: File, entity: Account | Group, isAccount: boolean): Promise<{ aiExtracted: ExtractedTransaction[]; userCorrected: ExtractedTransaction[]; userRemoved: ExtractedTransaction[]; userDefinedSkipKeys: string[] } | null> {
        const fileId = file.getId();

        let prefix: string;
        if (isAccount) {
            prefix = `account:'${entity.getName()}'`;
        } else {
            prefix = `group:'${entity.getName()}'`;
        }

        const postedTransactionsList = await book.listTransactions(`${prefix} agent_file_id_:${fileId}`, STATEMENT_TRANSACTION_LIMIT);
        const postedTransactions = postedTransactionsList.getItems();

        const trashedTransactionsList = await book.listTransactions(`${prefix} agent_file_id_:${fileId} is:trashed`, STATEMENT_TRANSACTION_LIMIT);
        const trashedTransactions = trashedTransactionsList.getItems();

        const allTransactions = [...postedTransactions, ...trashedTransactions];

        console.log(`Dataset: ${postedTransactions.length} posted, ${trashedTransactions.length} trashed`);

        await book.getAccounts();

        const account: Account | null = isAccount ? entity as Account : null;
        const userDefinedSkipKeys = Array.from(await this.context.promptLookupService.lookupPropertySkipKeys({
            book,
            account: isAccount ? entity as Account : undefined,
            group: isAccount ? undefined : entity as Group,
        }));

        const aiExtracted: ExtractedTransaction[] = [];
        for (const txn of allTransactions) {
            const aiExtractedJson = txn.getProperty(AGENT_EXTRACTED_PROPERTY);
            if (aiExtractedJson) {
                try {
                    const extracted = JSON.parse(aiExtractedJson) as ExtractedTransaction;
                    // Filter out user-defined skip keys from AI extracted properties
                    if (extracted.properties && userDefinedSkipKeys.length > 0) {
                        extracted.properties = this.filterProperties(extracted.properties, userDefinedSkipKeys);
                    }
                    aiExtracted.push(extracted);
                } catch (e) {
                    console.error('Failed to parse AI extracted transaction:', e);
                    await this.context.flagManagementService.clearImprovementFlag(entity);
                    return null;
                }
            }
        }

        const userCorrected: ExtractedTransaction[] = await Promise.all(postedTransactions.map((txn) => this.transactionToExtractedTransaction(txn, account, userDefinedSkipKeys)));
        const userRemoved: ExtractedTransaction[] = await Promise.all(trashedTransactions.map((txn) => this.transactionToExtractedTransaction(txn, account, userDefinedSkipKeys)));

        return { aiExtracted, userCorrected, userRemoved, userDefinedSkipKeys };
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

    /**
     * Perform reflection analysis on transaction data.
     *
     * @param currentPrompt - Current accumulated prompt to provide context for multi-epoch analysis
     */
    private async performReflection(file: File, comparison: { aiExtracted: ExtractedTransaction[]; userCorrected: ExtractedTransaction[]; userRemoved: ExtractedTransaction[] }, isCSV: boolean, currentPrompt: string | undefined, epoch: number): Promise<ReflectionResult | null> {
        console.log('Step 1: Reflection...');
        const reflector = isCSV
            ? new ReflectorStatementCSV(file, this.context.env, this.context.bkperAIResponsesClient)
            : new ReflectorStatementIMG(file, this.context.env, this.context.bkperAIResponsesClient);
        const reflection = await reflector.reflect(comparison.aiExtracted, comparison.userCorrected, comparison.userRemoved, currentPrompt, {
            operation: 'ace',
            document_kind: 'statement',
            stage: 'reflection',
            epoch,
        });

        if (!reflection) {
            console.error('Reflection failed');
            return null;
        }

        console.log('Reflection results:');
        console.log('- What worked:', reflection.whatWorked);
        console.log('- What failed:', reflection.whatFailed);
        console.log('- Suggestions:', reflection.suggestedImprovements);

        return reflection;
    }

    /**
     * Perform curation by extracting and merging bullets.
     */
    private async performCuration(reflection: ReflectionResult, currentPrompt: string, hasStoredPrompt: boolean, isCSV: boolean, epoch: number): Promise<{ improvedPrompt: string; reasoning: string } | null> {
        console.log('Step 2: Curation - Extracting bullets...');

        const curator = isCSV
            ? new CuratorStatementCSV(reflection, this.context.env, this.context.bkperAIResponsesClient)
            : new CuratorStatementIMG(reflection, this.context.env, this.context.bkperAIResponsesClient);
        const curationContext = {
            operation: 'ace' as const,
            document_kind: 'statement' as const,
            stage: 'curation' as const,
            epoch,
        };
        const newBullets = await curator.extractNewBullets(curationContext);

        if (!newBullets) {
            console.error('Bullet extraction failed');
            return null;
        }

        if (newBullets.length === 0 && hasStoredPrompt) {
            console.log('  → No new bullets to add (all failures already addressed)');
            return null;
        }

        console.log(`  → Extracted ${newBullets.length} new bullet${newBullets.length !== 1 ? 's' : ''}`);

        const existingBullets = this.parseBulletsFromPrompt(currentPrompt);
        console.log(`  → Current prompt has ${existingBullets.length} bullet${existingBullets.length !== 1 ? 's' : ''}`);

        const bulletMerger = new BulletMerger(this.context.jevEvaluationService);
        const mergedBullets = await bulletMerger.mergeBullets(existingBullets, newBullets, curationContext);

        const addedCount = mergedBullets.length - existingBullets.length;
        console.log(`  → After merging: ${mergedBullets.length} total bullet${mergedBullets.length !== 1 ? 's' : ''} (${addedCount} new)`);

        const improvedPrompt = mergedBullets.map((b) => `- ${b}`).join('\n');
        const reasoning = !hasStoredPrompt
            ? `Baseline: Generated initial prompt with ${mergedBullets.length} instruction${mergedBullets.length !== 1 ? 's' : ''} from failures`
            : `Appended ${addedCount} new instruction${addedCount !== 1 ? 's' : ''} to address failures while preserving ${existingBullets.length} existing instruction${existingBullets.length !== 1 ? 's' : ''}`;

        console.log('Curation completed:');
        console.log('- Improved prompt length:', improvedPrompt.length);
        console.log('- Reasoning:', reasoning);

        this.monitorPromptSize(improvedPrompt, 'Statement Extraction Prompt');

        return { improvedPrompt, reasoning };
    }

    /**
     * Perform post-validation of improved prompt.
     * Returns validation result with extracted transactions for potential next epoch.
     *
     * Part of multi-epoch adaptation - if validation fails, the extracted transactions
     * are used as the baseline for the next epoch's reflection and curation.
     */
    private async performPostValidation(
        file: File,
        improvedPrompt: string,
        comparison: { aiExtracted: ExtractedTransaction[]; userCorrected: ExtractedTransaction[]; userRemoved: ExtractedTransaction[]; userDefinedSkipKeys?: string[] },
        hasStoredPrompt: boolean,
        isCSV: boolean,
        epochNum: number = 1,
        maxEpochs: number = 1
    ): Promise<{ passed: boolean; extractedTransactions?: ExtractedTransaction[]; failureReason?: 'no_response' | 'transaction_count_mismatch' | 'no_improvement' }> {
        console.log(`Step 3: Post-validation (epoch ${epochNum}/${maxEpochs}, partial improvement enabled)...`);
        const postValidator: ExtractorStatementCSV | ExtractorStatementIMG = isCSV ? this.context.createExtractorStatementCSV(file) : this.context.createExtractorStatementIMG(file);
        const postExtractedResult = await postValidator.extract(improvedPrompt, {
            operation: 'ace',
            document_kind: 'statement',
            stage: 'post_validation',
            epoch: epochNum,
        });

        if (!postExtractedResult || !postExtractedResult.transactions) {
            console.error('⚠️  ACE: Validation result NULL - Post-validation extraction failed');
            return { passed: false, failureReason: 'no_response' };
        }

        const postExtracted = postExtractedResult.transactions;

        if (postExtracted.length !== comparison.userCorrected.length) {
            console.warn('⚠️  ACE: Transaction count mismatch - prompt not updated');
            console.warn('Expected:', comparison.userCorrected.length, 'transactions');
            console.warn('Got:', postExtracted.length, 'transactions');
            return { passed: false, extractedTransactions: postExtracted, failureReason: 'transaction_count_mismatch' };
        }

        const validationResult = await this.validateStatementExtractionPartial(comparison.aiExtracted, postExtracted, comparison.userCorrected, comparison.userDefinedSkipKeys);

        if (!validationResult.anyImprovement) {
            if (!hasStoredPrompt && epochNum === 1 && validationResult.regressed === 0) {
                const message = '✓ ACE: Baseline - accepting prompt (no regressions detected, provides starting point for future improvements)';
                console.log(message);
                return { passed: true, extractedTransactions: postExtracted };
            }

            let warningMsg = `⚠️  ACE: No improvement detected - ${validationResult.improved} transactions improved, ${validationResult.regressed} regressed`;

            if (validationResult.regressed > 0 && validationResult.regressionDetails.length > 0) {
                warningMsg += '\n\n📋 Regression Details:\n';

                let transactionNum = 1;
                for (const { transaction, details } of validationResult.regressionDetails) {
                    const identifier = `Transaction #${transactionNum} [${transaction.date}, $${Math.abs(transaction.amount).toFixed(2)}]`;
                    warningMsg += this.formatRegressionDetails(details, identifier);
                    transactionNum++;
                }
            }

            console.warn(warningMsg);
            return { passed: false, extractedTransactions: postExtracted, failureReason: 'no_improvement' };
        }

        console.log(`✅ ACE: Partial improvement validated - ${validationResult.improved} transactions improved, ${validationResult.perfect} already perfect, ${validationResult.stillWrong} still need work`);
        return { passed: true, extractedTransactions: postExtracted };
    }

    /**
     * Validate extracted transactions with partial improvement logic (per-transaction validation).
     * Accepts prompt update if ANY transaction shows improvement without regressions.
     *
     * @param original - Original AI extraction (before prompt improvement)
     * @param improved - New AI extraction (after prompt improvement)
     * @param expected - Expected transactions (user-corrected)
     * @param userDefinedSkipKeys - Optional array of user-defined property keys to skip
     * @returns Validation result with improvement statistics
     */
    private async validateStatementExtractionPartial(
        original: ExtractedTransaction[],
        improved: ExtractedTransaction[],
        expected: ExtractedTransaction[],
        userDefinedSkipKeys?: string[]
    ): Promise<{ anyImprovement: boolean; improved: number; regressed: number; perfect: number; stillWrong: number; regressionDetails: Array<{ transaction: ExtractedTransaction; details: RegressionDetail[]; }>; }> {
        let improvedCount = 0;
        let regressedCount = 0;
        let perfectCount = 0;
        let stillWrongCount = 0;
        const regressionDetails: Array<{ transaction: ExtractedTransaction; details: RegressionDetail[] }> = [];

        // Track which transactions have been matched to prevent duplicates
        const matchedOriginalIndices = new Set<number>();
        const matchedImprovedIndices = new Set<number>();

        // For each expected transaction, find matches in original and improved sets
        for (const exp of expected) {
            // Find best match in original extraction (Phase 1: Transaction Matching)
            // Note: Cannot use findIndex with async predicate, must use manual loop
            let origIndex = -1;
            for (let i = 0; i < original.length; i++) {
                if (!matchedOriginalIndices.has(i)) {
                    const matches = await this.exactMatch(original[i], exp, PromptImprovementServiceBase.SIMILARITY_THRESHOLDS.TRANSACTION_MATCHING); // silent mode
                    if (matches) {
                        origIndex = i;
                        break;
                    }
                }
            }

            // Find best match in improved extraction (Phase 1: Transaction Matching)
            // Note: Cannot use findIndex with async predicate, must use manual loop
            let impIndex = -1;
            for (let i = 0; i < improved.length; i++) {
                if (!matchedImprovedIndices.has(i)) {
                    const matches = await this.exactMatch(improved[i], exp, PromptImprovementServiceBase.SIMILARITY_THRESHOLDS.TRANSACTION_MATCHING); // silent mode
                    if (matches) {
                        impIndex = i;
                        break;
                    }
                }
            }

            // If we can't find matches, try fuzzy matching by date and amount
            let origMatch: ExtractedTransaction | null = null;
            let impMatch: ExtractedTransaction | null = null;

            if (origIndex !== -1) {
                origMatch = original[origIndex];
                matchedOriginalIndices.add(origIndex);
            } else {
                // Fuzzy match: find transaction with same date and amount (even if description/properties differ)
                for (let i = 0; i < original.length; i++) {
                    if (
                        !matchedOriginalIndices.has(i) &&
                        original[i].date === exp.date &&
                        Math.abs(original[i].amount) === Math.abs(exp.amount)
                    ) {
                        origMatch = original[i];
                        matchedOriginalIndices.add(i);
                        break;
                    }
                }
            }

            if (impIndex !== -1) {
                impMatch = improved[impIndex];
                matchedImprovedIndices.add(impIndex);
            } else {
                // Fuzzy match: find transaction with same date and amount
                for (let i = 0; i < improved.length; i++) {
                    if (
                        !matchedImprovedIndices.has(i) &&
                        improved[i].date === exp.date &&
                        Math.abs(improved[i].amount) === Math.abs(exp.amount)
                    ) {
                        impMatch = improved[i];
                        matchedImprovedIndices.add(i);
                        break;
                    }
                }
            }

            // If we found matches in both sets, do 3-way comparison (Phase 2: Field Validation)
            if (origMatch && impMatch) {
                const comparison = await this.compareExtractions(
                    origMatch,
                    impMatch,
                    exp,
                    PromptImprovementServiceBase.SIMILARITY_THRESHOLDS.FIELD_VALIDATION,
                    userDefinedSkipKeys
                );

                if (comparison.isImprovement) {
                    improvedCount++; // This transaction improved
                } else if (comparison.regressions > 0) {
                    regressedCount++; // This transaction regressed
                    // Capture regression details for this transaction
                    regressionDetails.push({
                        transaction: exp, // Use expected transaction as the identifier
                        details: comparison.regressionDetails,
                    });
                } else if (comparison.matches > 0 && comparison.stillWrong === 0) {
                    perfectCount++; // This transaction was already perfect
                } else {
                    stillWrongCount++; // This transaction is still wrong
                }
            } else {
                // Couldn't find matches - count as still wrong
                stillWrongCount++;
            }
        }

        // Accept if at least one transaction improved AND no transactions regressed
        const anyImprovement = improvedCount > 0 && regressedCount === 0;

        return {
            anyImprovement,
            improved: improvedCount,
            regressed: regressedCount,
            perfect: perfectCount,
            stillWrong: stillWrongCount,
            regressionDetails,
        };
    }

    /**
     * Parse bullet points from a prompt string.
     * Extracts lines that start with "- " as separate bullet points.
     *
     * @param prompt - The prompt string containing bullet points
     * @returns Array of bullet point strings (without the "- " prefix)
     */
    private parseBulletsFromPrompt(prompt: string): string[] {
        const lines = prompt.split('\n');
        const bullets: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            // Match lines that start with "- " or "* "
            if (trimmed.startsWith('- ')) {
                bullets.push(trimmed.substring(2).trim());
            } else if (trimmed.startsWith('* ')) {
                bullets.push(trimmed.substring(2).trim());
            }
        }

        return bullets;
    }
}
