import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Account, Book, File, Group, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { BkperAIClientError } from '../../src/genai/BkperAIClientError.js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';
import { ReflectionResult } from '../../src/genai/ace/ReflectionResult.js';
import { InvoicePromptImprovementService } from '../../src/services/InvoicePromptImprovementService.js';
import { StatementPromptImprovementService } from '../../src/services/StatementPromptImprovementService.js';

interface InvoiceSeams {
    validateTransactionPrerequisites: () => Promise<File | null>;
    lookupPromptLocation: () => Promise<{
        prompt: string;
        account?: Account;
        group?: Group;
        promptEntity: Account | Group;
        targetProperty: string;
    } | null>;
    needsPromptImprovement: () => Promise<boolean>;
    buildTransactionComparison: () => Promise<{ aiExtracted: ExtractedTransaction; userCorrected: ExtractedTransaction }>;
    performPreValidation: () => Promise<{ shouldSkip: boolean; preExtracted?: ExtractedTransaction }>;
    performReflection: () => Promise<ReflectionResult | null>;
    performCuration: () => Promise<{ improvedPrompt: string; reasoning: string } | null>;
    performPostValidation: () => Promise<{ passed: boolean; extractedTransaction?: ExtractedTransaction }>;
    saveImprovedPrompt: () => Promise<string | null>;
}

interface StatementSeams {
    findFileForEntity: () => Promise<File | null>;
    lookupTransactionsParserForEntity: () => Promise<null>;
    getCurrentPrompt: () => string | null;
    getStoredTransactionsPrompt: () => string | undefined;
    buildTransactionDataset: () => Promise<{
        aiExtracted: ExtractedTransaction[];
        userCorrected: ExtractedTransaction[];
        userRemoved: ExtractedTransaction[];
        userDefinedSkipKeys: string[];
    } | null>;
    performReflection: () => Promise<ReflectionResult | null>;
    performCuration: () => Promise<{ improvedPrompt: string; reasoning: string } | null>;
    performPostValidation: () => Promise<{ passed: boolean; extractedTransactions?: ExtractedTransaction[] }>;
}

function extracted(amount: number = 999.99): ExtractedTransaction {
    return { date: '2026-01-01', description: 'private-description', amount, properties: {} };
}

function parseResults(calls: unknown[][]): Array<Record<string, unknown>> {
    return calls
        .map((call) => String(call[0]))
        .filter((message) => message.startsWith('ACE_RESULT '))
        .map((message) => JSON.parse(message.slice('ACE_RESULT '.length)) as Record<string, unknown>);
}

function createContext(): AppContext {
    return {
        env: {} as Env,
        jevEvaluationService: {
            areInvoiceDescriptionsEquivalent: mock().mockResolvedValue([false]),
            areAceBulletsRedundant: mock().mockResolvedValue([false]),
        },
        promptLookupService: {
            lookupTransactionParserUrl: mock().mockResolvedValue(null),
            lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
        },
        flagManagementService: {
            clearImprovementFlag: mock().mockResolvedValue(undefined),
        },
    } as unknown as AppContext;
}

describe('structured ACE terminal results', () => {
    let consoleLog: ReturnType<typeof spyOn>;

    beforeEach(() => {
        consoleLog = spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleLog.mockRestore();
    });

    it('does not log routine exits before an ACE model workflow starts', async () => {
        const service = new InvoicePromptImprovementService(createContext());
        const seams = service as unknown as InvoiceSeams;
        spyOn(seams, 'validateTransactionPrerequisites').mockResolvedValue(null);

        expect(await service.improveInvoicePrompt({} as Book, {} as Transaction)).toBeNull();
        expect(parseResults(consoleLog.mock.calls)).toEqual([]);
    });

    it('logs one successful dynamic invoice epoch without resource or extraction data', async () => {
        const context = createContext();
        const service = new InvoicePromptImprovementService(context);
        const seams = service as unknown as InvoiceSeams;
        const book = { getId: () => 'book-secret' } as unknown as Book;
        const transaction = {} as Transaction;
        const file = { getId: () => 'file-secret' } as unknown as File;
        const entity = {
            getProperty: () => undefined,
        } as unknown as Account;
        const original = extracted();
        const corrected = extracted(1000);

        spyOn(seams, 'validateTransactionPrerequisites').mockResolvedValue(file);
        spyOn(seams, 'lookupPromptLocation').mockResolvedValue({
            prompt: '- original',
            promptEntity: entity,
            targetProperty: 'agent_parser_transaction',
        });
        spyOn(seams, 'needsPromptImprovement').mockResolvedValue(true);
        spyOn(seams, 'buildTransactionComparison').mockResolvedValue({ aiExtracted: original, userCorrected: corrected });
        spyOn(seams, 'performPreValidation').mockResolvedValue({ shouldSkip: false, preExtracted: original });
        spyOn(seams, 'performReflection').mockResolvedValue({ whatWorked: [], whatFailed: ['amount'], suggestedImprovements: 'fix amount' });
        spyOn(seams, 'performCuration').mockResolvedValue({ improvedPrompt: '- improved', reasoning: 'reason' });
        spyOn(seams, 'performPostValidation')
            .mockResolvedValueOnce({ passed: false, extractedTransaction: original })
            .mockResolvedValueOnce({ passed: true, extractedTransaction: corrected });
        spyOn(seams, 'saveImprovedPrompt').mockResolvedValue('saved');

        expect(await service.improveInvoicePrompt(book, transaction)).toBe('saved');

        const results = parseResults(consoleLog.mock.calls);
        expect(results).toEqual([{
            kind: 'invoice',
            outcome: 'prompt_updated',
            epochsAttempted: 2,
            successfulEpoch: 2,
        }]);
        const serialized = JSON.stringify(results);
        expect(serialized).not.toContain('book-secret');
        expect(serialized).not.toContain('file-secret');
        expect(serialized).not.toContain('private-description');
        expect(serialized).not.toContain('999.99');
    });

    it('stops invoice ACE after two failed epochs', async () => {
        const service = new InvoicePromptImprovementService(createContext());
        const seams = service as unknown as InvoiceSeams;
        const original = extracted();
        const entity = { getProperty: () => undefined } as unknown as Account;

        spyOn(seams, 'validateTransactionPrerequisites').mockResolvedValue({} as File);
        spyOn(seams, 'lookupPromptLocation').mockResolvedValue({
            prompt: '- original', promptEntity: entity, targetProperty: 'agent_parser_transaction',
        });
        spyOn(seams, 'needsPromptImprovement').mockResolvedValue(true);
        spyOn(seams, 'buildTransactionComparison').mockResolvedValue({
            aiExtracted: original, userCorrected: extracted(1000),
        });
        spyOn(seams, 'performPreValidation').mockResolvedValue({ shouldSkip: false, preExtracted: original });
        spyOn(seams, 'performReflection').mockResolvedValue({ whatWorked: [], whatFailed: ['amount'], suggestedImprovements: 'fix amount' });
        spyOn(seams, 'performCuration').mockResolvedValue({ improvedPrompt: '- improved', reasoning: 'reason' });
        const postValidation = spyOn(seams, 'performPostValidation').mockResolvedValue({
            passed: false, extractedTransaction: original,
        });

        expect(await service.improveInvoicePrompt({} as Book, {} as Transaction)).toBeNull();
        expect(postValidation).toHaveBeenCalledTimes(2);
        expect(parseResults(consoleLog.mock.calls)).toEqual([{
            kind: 'invoice', outcome: 'validation_failed', epochsAttempted: 2,
            reason: 'no_improvement',
        }]);
    });

    it('defers invoice ACE once on quota exhaustion without saving', async () => {
        const service = new InvoicePromptImprovementService(createContext());
        const seams = service as unknown as InvoiceSeams;
        const file = {} as File;
        const entity = { getProperty: () => undefined } as unknown as Account;
        spyOn(seams, 'validateTransactionPrerequisites').mockResolvedValue(file);
        spyOn(seams, 'lookupPromptLocation').mockResolvedValue({
            prompt: '- original', promptEntity: entity, targetProperty: 'agent_parser_transaction',
        });
        spyOn(seams, 'needsPromptImprovement').mockResolvedValue(true);
        spyOn(seams, 'buildTransactionComparison').mockResolvedValue({
            aiExtracted: extracted(), userCorrected: extracted(1000),
        });
        spyOn(seams, 'performPreValidation').mockRejectedValue(new BkperAIClientError(
            429, 'usage_limit_exceeded', 'limit', false
        ));
        const save = spyOn(seams, 'saveImprovedPrompt');

        expect(await service.improveInvoicePrompt({} as Book, {} as Transaction)).toBeNull();
        expect(save).not.toHaveBeenCalled();
        expect(parseResults(consoleLog.mock.calls)).toEqual([{
            kind: 'invoice', outcome: 'quota_deferred', epochsAttempted: 0,
            reason: 'usage_limit_exceeded',
        }]);
    });

    it('stops statement ACE after two failed epochs', async () => {
        const context = createContext();
        const service = new StatementPromptImprovementService(context);
        const seams = service as unknown as StatementSeams;
        const book = {} as Book;
        const entity = { getName: () => 'private-entity' } as unknown as Group;
        const file = { getContentType: () => 'application/pdf' } as unknown as File;
        const transaction = extracted();

        spyOn(seams, 'findFileForEntity').mockResolvedValue(file);
        spyOn(seams, 'lookupTransactionsParserForEntity').mockResolvedValue(null);
        spyOn(seams, 'getCurrentPrompt').mockReturnValue('- original');
        spyOn(seams, 'getStoredTransactionsPrompt').mockReturnValue('- original');
        spyOn(seams, 'buildTransactionDataset').mockResolvedValue({
            aiExtracted: [transaction],
            userCorrected: [extracted(1000)],
            userRemoved: [],
            userDefinedSkipKeys: [],
        });
        spyOn(seams, 'performReflection').mockResolvedValue({ whatWorked: [], whatFailed: ['amount'], suggestedImprovements: 'fix amount' });
        spyOn(seams, 'performCuration').mockResolvedValue({ improvedPrompt: '- improved', reasoning: 'reason' });
        const postValidation = spyOn(seams, 'performPostValidation').mockResolvedValue({ passed: false, extractedTransactions: [transaction] });

        expect(await service.improveStatementPrompt(book, entity)).toBeNull();

        expect(postValidation).toHaveBeenCalledTimes(2);
        expect(parseResults(consoleLog.mock.calls)).toEqual([{
            kind: 'statement',
            outcome: 'validation_failed',
            epochsAttempted: 2,
            reason: 'no_improvement',
        }]);
    });

    it('leaves the statement improvement flag unchanged when quota is exhausted', async () => {
        const context = createContext();
        const service = new StatementPromptImprovementService(context);
        const seams = service as unknown as StatementSeams;
        const file = { getContentType: () => 'application/pdf' } as unknown as File;
        const entity = { getName: () => 'private-entity' } as unknown as Group;
        spyOn(seams, 'findFileForEntity').mockResolvedValue(file);
        spyOn(seams, 'lookupTransactionsParserForEntity').mockResolvedValue(null);
        spyOn(seams, 'getCurrentPrompt').mockReturnValue('- original');
        spyOn(seams, 'getStoredTransactionsPrompt').mockReturnValue('- original');
        spyOn(seams, 'buildTransactionDataset').mockResolvedValue({
            aiExtracted: [extracted()], userCorrected: [extracted(1000)],
            userRemoved: [], userDefinedSkipKeys: [],
        });
        spyOn(seams, 'performReflection').mockRejectedValue(new BkperAIClientError(
            429, 'usage_limit_exceeded', 'limit', false
        ));

        expect(await service.improveStatementPrompt({} as Book, entity)).toBeNull();
        expect(context.flagManagementService.clearImprovementFlag).not.toHaveBeenCalled();
        expect(parseResults(consoleLog.mock.calls)).toEqual([{
            kind: 'statement', outcome: 'quota_deferred', epochsAttempted: 1,
            reason: 'usage_limit_exceeded',
        }]);
    });
});
