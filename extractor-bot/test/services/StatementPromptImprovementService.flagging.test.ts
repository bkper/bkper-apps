/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';
import { StatementPromptImprovementService } from '../../src/services/StatementPromptImprovementService.js';
import { Book, Transaction, Account, Group, File } from 'bkper-js';
import { AGENT_CREDIT_ACCOUNT_ID_PROPERTY, AGENT_FILE_ID_PROPERTY, AGENT_EXCLUDED_PROPERTIES_PROPERTY, AGENT_EXTRACTED_PROPERTY, AGENT_PROMPT_IMPROVE_PROPERTY } from '../../src/constants.js';
import { AppContext } from '../../src/AppContext.js';

function createMockContext(overrides: Partial<{
    flagManagementService: any;
    promptLookupService: any;
    jevEvaluationService: any;
}> = {}): AppContext {
    return {
        env: {} as Env,
        flagManagementService: overrides.flagManagementService ?? {
            clearImprovementFlag: mock().mockResolvedValue(undefined),
            setImprovementFlag: mock().mockResolvedValue(undefined),
        },
        promptLookupService: overrides.promptLookupService ?? {
            lookupPrompts: mock().mockResolvedValue(null),
            lookupTransactionsParserUrl: mock().mockResolvedValue(null),
            lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
        },
        jevEvaluationService: overrides.jevEvaluationService ?? {
            areAceBulletsRedundant: mock().mockImplementation(async (_existing: string[], additions: string[]) => additions.map(() => false)),
        },
        createExtractorStatementCSV: mock(),
        createExtractorStatementIMG: mock(),
    } as unknown as AppContext;
}

describe('StatementPromptImprovementService - flagStatementForImprovement', () => {
    let service: StatementPromptImprovementService;
    let mockBook: Book;
    let mockContext: AppContext;

    beforeEach(() => {
        mockContext = createMockContext();
        service = new StatementPromptImprovementService(mockContext);
        mockBook = {
            getId: () => 'book123',
            getOwnerName: () => 'Test Owner',
            listTransactions: mock(),
            getFile: mock(),
        } as unknown as Book;
    });

    describe('Pre-checks', () => {
        it('should return null when transaction has no agent_file_id_ property', async () => {
            const mockTransaction = {
                getProperty: mock().mockReturnValue(undefined),
                isTrashed: mock().mockReturnValue(false),
            } as unknown as Transaction;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toBe(null);
            expect(mockTransaction.getProperty).toHaveBeenCalledWith(AGENT_FILE_ID_PROPERTY);
        });

        it('should return null when transaction has no agent_extracted_ property', async () => {
            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return undefined;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
            } as unknown as Transaction;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toBe(null);
        });

        it('should proceed when both agent_file_id_ and agent_extracted_ are present', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
                getDate: mock().mockReturnValue('2025-01-15'),
                getDescription: mock().mockReturnValue('Transaction 1'),
                getAmount: mock().mockReturnValue({ toNumber: () => 100 }),
                getProperties: mock().mockReturnValue({}),
            } as unknown as Transaction;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            // Should return null because no changes detected (transaction is identical to AI extraction)
            expect(result).toBe(null);
            expect(mockTransaction.getProperty).toHaveBeenCalledWith(AGENT_FILE_ID_PROPERTY);
            expect(mockTransaction.getProperty).toHaveBeenCalledWith(AGENT_EXTRACTED_PROPERTY);
        });
    });

    describe('Change detection', () => {
        it('should detect when transaction amount changed', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
                getDate: mock().mockReturnValue('2025-01-15'),
                getDescription: mock().mockReturnValue('Transaction 1'),
                getAmount: mock().mockReturnValue({ toNumber: () => 150 }), // Changed from 100 to 150
                getProperties: mock().mockReturnValue({}),
            } as unknown as Transaction;

            const mockAccount = {
                getName: mock().mockReturnValue('Test Account'),
                getProperty: mock().mockReturnValue(undefined),
                setProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Account;

            const mockFile = {
                getId: () => 'file123',
            } as File;

            spyOn(mockBook, 'getFile').mockResolvedValue(mockFile);

            // Mock PromptLookupService to return account
            const mockLookupService = {
                lookupPrompts: mock().mockResolvedValue({
                    getPrompt: () => ({ account: mockAccount, promptEntity: mockAccount, targetProperty: 'agent_parser_transactions' }),
                }),
                lookupTransactionsParserUrl: mock().mockResolvedValue(null),
                lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
            };
            (mockContext as any).promptLookupService = mockLookupService;

            const mockFlagService = {
                setImprovementFlag: mock().mockResolvedValue(undefined),
            };
            (mockContext as any).flagManagementService = mockFlagService;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toContain('Prompt flagged for improvement');
            expect(mockFlagService.setImprovementFlag).toHaveBeenCalledWith(mockAccount, mockFile);
        });

        it('should detect when transaction date changed', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
                getDate: mock().mockReturnValue('2025-01-20'), // Changed from 15 to 20
                getDescription: mock().mockReturnValue('Transaction 1'),
                getAmount: mock().mockReturnValue({ toNumber: () => 100 }),
                getProperties: mock().mockReturnValue({}),
            } as unknown as Transaction;

            const mockAccount = {
                getName: mock().mockReturnValue('Test Account'),
                getProperty: mock().mockReturnValue(undefined),
                setProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Account;

            const mockFile = {
                getId: () => 'file123',
            } as File;

            spyOn(mockBook, 'getFile').mockResolvedValue(mockFile);

            const mockLookupService = {
                lookupPrompts: mock().mockResolvedValue({
                    getPrompt: () => ({ account: mockAccount, promptEntity: mockAccount, targetProperty: 'agent_parser_transactions' }),
                }),
                lookupTransactionsParserUrl: mock().mockResolvedValue(null),
                lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
            };
            (mockContext as any).promptLookupService = mockLookupService;

            const mockFlagService = {
                setImprovementFlag: mock().mockResolvedValue(undefined),
            };
            (mockContext as any).flagManagementService = mockFlagService;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toContain('Prompt flagged for improvement');
            expect(mockFlagService.setImprovementFlag).toHaveBeenCalledWith(mockAccount, mockFile);
        });

        it('should return null when no changes detected', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
                getDate: mock().mockReturnValue('2025-01-15'), // Same
                getDescription: mock().mockReturnValue('Transaction 1'), // Same
                getAmount: mock().mockReturnValue({ toNumber: () => 100 }), // Same
                getProperties: mock().mockReturnValue({}), // Same
            } as unknown as Transaction;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toBe(null);
            expect(mockBook.getFile).not.toHaveBeenCalled();
            expect(mockContext.promptLookupService.lookupPrompts).not.toHaveBeenCalled();
            expect(mockContext.promptLookupService.lookupTransactionsParserUrl).not.toHaveBeenCalled();
        });

        it('should not flag user-skipped property-only changes after the prompt entity is known', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
                getDate: mock().mockReturnValue('2025-01-15'),
                getDescription: mock().mockReturnValue('Transaction 1'),
                getAmount: mock().mockReturnValue({ toNumber: () => 100 }),
                getProperties: mock().mockReturnValue({ statement_note: 'ignored by user config' }),
            } as unknown as Transaction;

            const mockAccount = {
                getName: mock().mockReturnValue('Test Account'),
                getProperty: mock((key: string) => {
                    if (key === AGENT_EXCLUDED_PROPERTIES_PROPERTY) return 'statement_note';
                    return undefined;
                }),
                setProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Account;

            const mockFile = {
                getId: () => 'file123',
            } as File;

            spyOn(mockBook, 'getFile').mockResolvedValue(mockFile);

            const mockLookupService = {
                lookupPrompts: mock().mockResolvedValue({
                    getPrompt: () => ({ account: mockAccount, promptEntity: mockAccount, targetProperty: 'agent_parser_transactions' }),
                }),
                lookupTransactionsParserUrl: mock().mockResolvedValue(null),
                lookupPropertySkipKeys: mock().mockResolvedValue(new Set(['statement_note'])),
            };

            const mockFlagService = {
                setImprovementFlag: mock().mockResolvedValue(undefined),
            };
            Object.assign(mockContext, {
                promptLookupService: mockLookupService,
                flagManagementService: mockFlagService,
            });

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toBe(null);
            expect(mockLookupService.lookupPrompts).toHaveBeenCalled();
            expect(mockFlagService.setImprovementFlag).not.toHaveBeenCalled();
        });

        it('should skip deleted transaction when a transaction account is already flagged', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const flaggedAccount = {
                getName: mock().mockReturnValue('Bank'),
                getProperty: mock((key: string) => {
                    if (key === AGENT_PROMPT_IMPROVE_PROPERTY) return '2026-06-16T10:00:00.000Z';
                    return undefined;
                }),
            } as unknown as Account;

            const getCreditAccount = mock().mockResolvedValue(flaggedAccount);
            const getDebitAccount = mock().mockResolvedValue(undefined);
            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(true),
                getCreditAccount,
                getDebitAccount,
            } as unknown as Transaction;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toBe(null);
            expect(getCreditAccount).toHaveBeenCalled();
            expect(getDebitAccount).toHaveBeenCalled();
            expect(mockBook.getFile).not.toHaveBeenCalled();
            expect(mockContext.promptLookupService.lookupPrompts).not.toHaveBeenCalled();
            expect(mockContext.promptLookupService.lookupTransactionsParserUrl).not.toHaveBeenCalled();
            expect(mockContext.flagManagementService.setImprovementFlag).not.toHaveBeenCalled();
        });

        it('should not skip deleted transaction when only the auto-discovered counterparty account is flagged', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const flaggedCounterpartyAccount = {
                getId: mock().mockReturnValue('category'),
                getName: mock().mockReturnValue('Category'),
                getProperty: mock((key: string) => {
                    if (key === AGENT_PROMPT_IMPROVE_PROPERTY) return '2026-06-16T10:00:00.000Z';
                    return undefined;
                }),
            } as unknown as Account;

            const statementAccount = {
                getId: mock().mockReturnValue('bank'),
                getName: mock().mockReturnValue('Bank'),
                getProperty: mock().mockReturnValue(undefined),
            } as unknown as Account;

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    if (key === AGENT_CREDIT_ACCOUNT_ID_PROPERTY) return 'category';
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(true),
                getCreditAccount: mock().mockResolvedValue(flaggedCounterpartyAccount),
                getDebitAccount: mock().mockResolvedValue(statementAccount),
            } as unknown as Transaction;

            const mockFile = {
                getId: () => 'file123',
            } as File;

            spyOn(mockBook, 'getFile').mockResolvedValue(mockFile);

            const mockLookupService = {
                lookupPrompts: mock().mockResolvedValue({
                    getPrompt: () => ({ account: statementAccount, promptEntity: statementAccount, targetProperty: 'agent_parser_transactions' }),
                }),
                lookupTransactionsParserUrl: mock().mockResolvedValue(null),
                lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
            };
            const mockFlagService = {
                setImprovementFlag: mock().mockResolvedValue(undefined),
            };
            Object.assign(mockContext, {
                promptLookupService: mockLookupService,
                flagManagementService: mockFlagService,
            });

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toContain('Prompt flagged for improvement');
            expect(mockFlagService.setImprovementFlag).toHaveBeenCalledWith(statementAccount, mockFile);
        });

        it('should flag when transaction is trashed', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(true), // Transaction is trashed
                getDate: mock().mockReturnValue('2025-01-15'),
                getDescription: mock().mockReturnValue('Transaction 1'),
                getAmount: mock().mockReturnValue({ toNumber: () => 100 }),
                getProperties: mock().mockReturnValue({}),
                getCreditAccount: mock().mockResolvedValue(undefined),
                getDebitAccount: mock().mockResolvedValue(undefined),
            } as unknown as Transaction;

            const mockAccount = {
                getName: mock().mockReturnValue('Test Account'),
                getProperty: mock().mockReturnValue(undefined),
                setProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Account;

            const mockFile = {
                getId: () => 'file123',
            } as File;

            spyOn(mockBook, 'getFile').mockResolvedValue(mockFile);

            const mockLookupService = {
                lookupPrompts: mock().mockResolvedValue({
                    getPrompt: () => ({ account: mockAccount, promptEntity: mockAccount, targetProperty: 'agent_parser_transactions' }),
                }),
                lookupTransactionsParserUrl: mock().mockResolvedValue(null),
                lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
            };
            (mockContext as any).promptLookupService = mockLookupService;

            const mockFlagService = {
                setImprovementFlag: mock().mockResolvedValue(undefined),
            };
            (mockContext as any).flagManagementService = mockFlagService;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toContain('Prompt flagged for improvement');
            expect(mockFlagService.setImprovementFlag).toHaveBeenCalledWith(mockAccount, mockFile);
        });
    });

    describe('Flag setting', () => {
        it('should set flag on account when prompt is on account', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
                getDate: mock().mockReturnValue('2025-01-15'),
                getDescription: mock().mockReturnValue('Transaction 1 CHANGED'), // Changed
                getAmount: mock().mockReturnValue({ toNumber: () => 100 }),
                getProperties: mock().mockReturnValue({}),
            } as unknown as Transaction;

            const mockAccount = {
                getName: mock().mockReturnValue('Test Account'),
                getProperty: mock().mockReturnValue(undefined),
                setProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Account;

            const mockFile = {
                getId: () => 'file123',
            } as File;

            spyOn(mockBook, 'getFile').mockResolvedValue(mockFile);

            const mockLookupService = {
                lookupPrompts: mock().mockResolvedValue({
                    getPrompt: () => ({ account: mockAccount, promptEntity: mockAccount, targetProperty: 'agent_parser_transactions' }),
                }),
                lookupTransactionsParserUrl: mock().mockResolvedValue(null),
                lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
            };
            (mockContext as any).promptLookupService = mockLookupService;

            const mockFlagService = {
                setImprovementFlag: mock().mockResolvedValue(undefined),
            };
            (mockContext as any).flagManagementService = mockFlagService;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toContain('Prompt flagged for improvement');
            expect(mockFlagService.setImprovementFlag).toHaveBeenCalledWith(mockAccount, mockFile);
        });

        it('should set flag on group when prompt is on group', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
                getDate: mock().mockReturnValue('2025-01-15'),
                getDescription: mock().mockReturnValue('Transaction 1 CHANGED'), // Changed
                getAmount: mock().mockReturnValue({ toNumber: () => 100 }),
                getProperties: mock().mockReturnValue({}),
            } as unknown as Transaction;

            const mockGroup = {
                getName: mock().mockReturnValue('Test Group'),
                getProperty: mock().mockReturnValue(undefined),
                setProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Group;

            const mockFile = {
                getId: () => 'file123',
            } as File;

            spyOn(mockBook, 'getFile').mockResolvedValue(mockFile);

            const mockLookupService = {
                lookupPrompts: mock().mockResolvedValue({
                    getPrompt: () => ({ group: mockGroup, promptEntity: mockGroup, targetProperty: 'agent_parser_transactions' }),
                }),
                lookupTransactionsParserUrl: mock().mockResolvedValue(null),
                lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
            };
            (mockContext as any).promptLookupService = mockLookupService;

            const mockFlagService = {
                setImprovementFlag: mock().mockResolvedValue(undefined),
            };
            (mockContext as any).flagManagementService = mockFlagService;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toContain('Prompt flagged for improvement');
            expect(mockFlagService.setImprovementFlag).toHaveBeenCalledWith(mockGroup, mockFile);
        });

        it('should skip flagging when transactions parser URL is configured', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
                getDate: mock().mockReturnValue('2025-01-15'),
                getDescription: mock().mockReturnValue('Transaction 1 CHANGED'),
                getAmount: mock().mockReturnValue({ toNumber: () => 100 }),
                getProperties: mock().mockReturnValue({}),
            } as unknown as Transaction;

            const mockAccount = {
                getName: mock().mockReturnValue('Test Account'),
                getProperty: mock().mockReturnValue(undefined),
            } as unknown as Account;

            const mockFile = {
                getId: () => 'file123',
            } as File;

            spyOn(mockBook, 'getFile').mockResolvedValue(mockFile);

            const mockLookupService = {
                lookupPrompts: mock().mockResolvedValue({
                    getPrompt: () => ({ account: mockAccount, promptEntity: mockAccount, targetProperty: 'agent_parser_transactions' }),
                }),
                lookupTransactionsParserUrl: mock().mockResolvedValue({ url: 'https://parser.example.com', source: 'account' as const, account: mockAccount }),
                lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
            };
            (mockContext as any).promptLookupService = mockLookupService;

            const mockFlagService = {
                setImprovementFlag: mock().mockResolvedValue(undefined),
            };
            (mockContext as any).flagManagementService = mockFlagService;

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toBe(null);
            expect(mockFlagService.setImprovementFlag).not.toHaveBeenCalled();
        });

        it('should return null when no prompt found', async () => {
            const aiExtracted = JSON.stringify({
                date: '2025-01-15',
                description: 'Transaction 1',
                amount: 100,
                properties: {},
            });

            const mockTransaction = {
                getProperty: mock((key: string) => {
                    if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                    if (key === AGENT_EXTRACTED_PROPERTY) return aiExtracted;
                    return undefined;
                }),
                isTrashed: mock().mockReturnValue(false),
                getDate: mock().mockReturnValue('2025-01-15'),
                getDescription: mock().mockReturnValue('Transaction 1 CHANGED'), // Changed
                getAmount: mock().mockReturnValue({ toNumber: () => 100 }),
                getProperties: mock().mockReturnValue({}),
            } as unknown as Transaction;

            spyOn(mockBook, 'getFile').mockResolvedValue({ getId: () => 'file123' } as File);

            const mockLookupService = {
                lookupPrompts: mock().mockResolvedValue(null),
                lookupTransactionsParserUrl: mock().mockResolvedValue(null),
                lookupPropertySkipKeys: mock().mockResolvedValue(new Set<string>()),
            };
            (mockContext as any).promptLookupService = mockLookupService; // No prompt found

            const result = await service.flagStatementForImprovement(mockBook, mockTransaction);

            expect(result).toBe(null);
        });
    });
});
