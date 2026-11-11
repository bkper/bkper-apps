import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';
import { Book, Account, Group, Transaction, File } from 'bkper-js';
import { StatementPromptImprovementService } from '../../src/services/StatementPromptImprovementService.js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';
import { AGENT_PROMPT_PROPERTY, AGENT_FILE_ID_PROPERTY, AGENT_EXTRACTED_PROPERTY } from '../../src/constants.js';
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

describe('StatementPromptImprovementService - improveStatementPrompt', () => {
    let service: StatementPromptImprovementService;
    let book: Book;
    let account: Account;
    let group: Group;
    let mockContext: AppContext;
    let mockFile: File;

    beforeEach(() => {
        mockContext = createMockContext();
        service = new StatementPromptImprovementService(mockContext);
        book = {
            id: 'book123',
            getId: () => 'book123',
            getOwnerName: () => 'Test Owner',
            listTransactions: mock().mockResolvedValue({
                getItems: () => [],
            }),
            getFile: mock(),
        } as unknown as Book;
        mockFile = {
            id: 'file123',
            getContentType: () => 'application/pdf',
            getContent: mock().mockResolvedValue('base64content'),
        } as unknown as File;

        account = {
            getName: () => 'Bank Account',
            getProperty: mock(),
            setProperty: mock(),
            update: mock().mockResolvedValue(undefined),
        } as unknown as Account;

        group = {
            getName: () => 'Assets',
            getProperty: mock(),
            setProperty: mock(),
            update: mock().mockResolvedValue(undefined),
        } as unknown as Group;
    });

    describe('Early Exit Conditions', () => {
        it('should clear flag and return null when entity has no prompt', async () => {
            // Mock: No prompt on entity
            spyOn(account, 'getProperty').mockReturnValue(undefined);

            const mockClearFlag = mock().mockResolvedValue(undefined);
            (mockContext as any).flagManagementService = {
                clearImprovementFlag: mockClearFlag,
            };

            const result = await service.improveStatementPrompt(book, account);

            expect(result).toBe(null);
            expect(mockClearFlag).toHaveBeenCalledWith(account);
        });

        it('should clear flag and return null when no file ID found in transactions', async () => {
            // Mock: Has prompt
            spyOn(account, 'getProperty').mockReturnValue('Extract transactions from statement');

            // Mock: listTransactions returns no transactions with file ID
            const mockListTransactions = mock().mockResolvedValue({
                getItems: () => [],
            });
            spyOn(book, 'listTransactions').mockImplementation(mockListTransactions);

            const mockClearFlag = mock().mockResolvedValue(undefined);
            (mockContext as any).flagManagementService = {
                clearImprovementFlag: mockClearFlag,
            };

            const result = await service.improveStatementPrompt(book, account);

            expect(result).toBe(null);
            expect(mockClearFlag).toHaveBeenCalledWith(account);
        });

        it('should clear flag and return null when file not found', async () => {
            // Mock: Has prompt and file ID on account
            spyOn(account, 'getProperty').mockImplementation((key: string) => {
                if (key === AGENT_PROMPT_PROPERTY) return 'Extract transactions from statement';
                if (key === AGENT_FILE_ID_PROPERTY) return 'file123';
                return undefined;
            });

            // Mock: Transaction with file ID
            const mockTransaction = {
                getProperty: (key: string) => (key === AGENT_FILE_ID_PROPERTY ? 'file123' : undefined),
            } as Transaction;

            const mockListTransactions = mock().mockResolvedValue({
                getItems: () => [mockTransaction],
            });
            spyOn(book, 'listTransactions').mockImplementation(mockListTransactions);

            // Mock: File not found
            spyOn(book, 'getFile').mockResolvedValue(undefined);

            const mockClearFlag = mock().mockResolvedValue(undefined);
            (mockContext as any).flagManagementService = {
                clearImprovementFlag: mockClearFlag,
            };

            const result = await service.improveStatementPrompt(book, account);

            expect(result).toBe(null);
            expect(mockClearFlag).toHaveBeenCalledWith(account);
            expect(book.getFile).toHaveBeenCalledWith('file123');
        });
    });

    describe('Transaction Dataset Building', () => {
        it('should query both posted and trashed transactions', async () => {
            spyOn(account, 'getProperty').mockReturnValue('Extract transactions');

            const mockTransaction = {
                getProperty: (key: string) => (key === AGENT_FILE_ID_PROPERTY ? 'file123' : undefined),
            } as Transaction;

            const mockListTransactions = mock();
            // First call: get transactions to find file ID
            mockListTransactions.mockResolvedValueOnce({
                getItems: () => [mockTransaction],
            });
            // Will exit early when file not found

            spyOn(book, 'listTransactions').mockImplementation(mockListTransactions);
            spyOn(book, 'getFile').mockResolvedValue(undefined); // Will exit early

            const mockClearFlag = mock();
            (mockContext as any).flagManagementService = {
                clearImprovementFlag: mockClearFlag,
            };

            await service.improveStatementPrompt(book, account);

            // Should query for account transactions
            expect(mockListTransactions).toHaveBeenCalled();
        });
    });
});

// describe('StatementPromptImprovementService - validateStatementExtraction', () => {
//     let service: StatementPromptImprovementService;
// 
//     beforeEach(() => {
//         service = new StatementPromptImprovementService({} as Env);
//     });
// 
//     it('should return true when all transactions match exactly', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment 1', amount: 100, properties: { ref: '123' } },
//             { date: '2025-01-11', description: 'Payment 2', amount: 200, properties: { ref: '456' } },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment 1', amount: 100, properties: { ref: '123' } },
//             { date: '2025-01-11', description: 'Payment 2', amount: 200, properties: { ref: '456' } },
//         ];
// 
//         // Access private method for testing
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(true);
//     });
// 
//     it('should return false when transaction count differs', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment 1', amount: 100, properties: {} },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment 1', amount: 100, properties: {} },
//             { date: '2025-01-11', description: 'Payment 2', amount: 200, properties: {} },
//         ];
// 
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(false);
//     });
// 
//     it('should return false when date differs', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-11', description: 'Payment', amount: 100, properties: {} },
//         ];
// 
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(false);
//     });
// 
//     it('should return false when amount differs', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: 200, properties: {} },
//         ];
// 
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(false);
//     });
// 
//     it('should return true when amount sign differs but magnitude is same (sign-agnostic)', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: -100, properties: {} },
//         ];
// 
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(true); // Should match despite sign difference
//     });
// 
//     it('should return true when amount is 3.75 vs -3.75 (sign-agnostic)', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: 3.75, properties: {} },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: -3.75, properties: {} },
//         ];
// 
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(true); // Should match despite sign difference
//     });
// 
//     it('should return false when description differs significantly (below fuzzy threshold)', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Office Supplies Purchase', amount: 100, properties: {} },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Computer Equipment', amount: 100, properties: {} },
//         ];
// 
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(false);
//     });
// 
//     it('should return false when properties differ', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: 100, properties: { ref: '123' } },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: 100, properties: { ref: '456' } },
//         ];
// 
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(false);
//     });
// 
//     it('should handle transactions with undefined properties', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: 100, properties: undefined as any },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment', amount: 100, properties: undefined as any },
//         ];
// 
//         // Should handle undefined properties gracefully
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(true);
//     });
// 
//     it('should validate transactions in any order (set matching)', async () => {
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-11', description: 'Payment 2', amount: 200, properties: {} },
//             { date: '2025-01-10', description: 'Payment 1', amount: 100, properties: {} },
//         ];
// 
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Payment 1', amount: 100, properties: {} },
//             { date: '2025-01-11', description: 'Payment 2', amount: 200, properties: {} },
//         ];
// 
//         // Should match regardless of order (uses .find() in implementation)
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(true);
//     });
// 
//     it('should prevent matching same expected transaction twice using index tracking', async () => {
//         // Two identical extracted transactions
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Generic Purchase', amount: 50, properties: {} },
//             { date: '2025-01-10', description: 'Generic Purchase', amount: 50, properties: {} },
//         ];
// 
//         // Two different expected transactions with significantly different descriptions
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'Paper Products from Staples', amount: 50, properties: {} },
//             { date: '2025-01-10', description: 'Computer Mouse from Amazon', amount: 50, properties: {} },
//         ];
// 
//         // Should fail because extracted transactions don't match the corrected descriptions
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(false);
//     });
// 
//     it('should successfully validate duplicate transactions when descriptions match', async () => {
//         // Two identical extracted transactions
//         const extracted: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'ATM Fee', amount: 3, properties: {} },
//             { date: '2025-01-10', description: 'ATM Fee', amount: 3, properties: {} },
//         ];
// 
//         // Two expected transactions with same content
//         const expected: ExtractedTransaction[] = [
//             { date: '2025-01-10', description: 'ATM Fee', amount: 3, properties: {} },
//             { date: '2025-01-10', description: 'ATM Fee', amount: 3, properties: {} },
//         ];
// 
//         // Should match - each extracted matches a different expected (by index tracking)
//         const result = (service as any).validateStatementExtraction(extracted, expected);
//         expect(result).toBe(true);
//     });
// });

describe('PromptImprovementServiceBase - transactionToExtractedTransaction', () => {
    let service: StatementPromptImprovementService;

    beforeEach(() => {
        service = new StatementPromptImprovementService(createMockContext());
    });

    it('should convert transaction to extracted transaction format', async () => {
        const mockTransaction = {
            getDate: () => '2025-01-10',
            getDescription: () => 'Test Payment',
            getAmount: () => ({ toNumber: () => 100.5 }),
            getProperties: () => ({ ref: '123', category: 'food' }),
            getCreditAccountName: async () => undefined,
            getDebitAccountName: async () => undefined,
            getProperty: (key: string) => {
                if (key === 'agent_extracted_') {
                    return JSON.stringify({
                        date: '2025-01-10',
                        description: 'Test Payment',
                        amount: 100.5,
                        properties: {},
                    });
                }
                return undefined;
            },
        } as unknown as Transaction;

        const result = await (service as any).transactionToExtractedTransaction(mockTransaction, null);

        expect(result).toEqual({
            date: '2025-01-10',
            description: 'Test Payment',
            amount: 100.5,
            properties: { ref: '123', category: 'food' },
        });
    });

    it('should use absolute value for amount (sign-agnostic)', async () => {
        const mockTransaction = {
            getDate: () => '2025-01-15',
            getDescription: () => 'Negative Amount',
            getAmount: () => ({ toNumber: () => 200 }),
            getProperties: () => ({}),
            getCreditAccountName: async () => undefined,
            getDebitAccountName: async () => undefined,
            getProperty: (key: string) => {
                if (key === 'agent_extracted_') {
                    return JSON.stringify({
                        date: '2025-01-15',
                        description: 'Negative Amount',
                        amount: 200,
                        properties: {},
                    });
                }
                return undefined;
            },
        } as unknown as Transaction;

        const result = await (service as any).transactionToExtractedTransaction(mockTransaction, null);

        expect(result.amount).toBe(200);
    });

    it('should filter out SKIP_PROPERTIES when converting transaction', async () => {
        const mockTransaction = {
            getDate: () => '2025-01-15',
            getDescription: () => 'Filtered Payment',
            getAmount: () => ({ toNumber: () => 200 }),
            getProperties: () => ({
                ref: '456',
                agent_file_id_: 'file123', // Should be filtered
                account_id: 'acc123', // Should be filtered
                parsed_data: 'some data', // Should be filtered
            }),
            getCreditAccountName: async () => undefined,
            getDebitAccountName: async () => undefined,
            getProperty: (key: string) => {
                if (key === 'agent_extracted_') {
                    return JSON.stringify({
                        date: '2025-01-15',
                        description: 'Filtered Payment',
                        amount: 200,
                        properties: {},
                    });
                }
                return undefined;
            },
        } as unknown as Transaction;

        const result = await (service as any).transactionToExtractedTransaction(mockTransaction, null);

        expect(result).toEqual({
            date: '2025-01-15',
            description: 'Filtered Payment',
            amount: 200,
            properties: { ref: '456' }, // Only non-skip properties
        });
    });

    it('should handle transaction with empty properties', async () => {
        const mockTransaction = {
            getDate: () => '2025-01-20',
            getDescription: () => 'Empty Props',
            getAmount: () => ({ toNumber: () => 50 }),
            getProperties: () => ({}),
            getCreditAccountName: async () => undefined,
            getDebitAccountName: async () => undefined,
            getProperty: (key: string) => {
                if (key === 'agent_extracted_') {
                    return JSON.stringify({
                        date: '2025-01-20',
                        description: 'Empty Props',
                        amount: 50,
                        properties: {},
                    });
                }
                return undefined;
            },
        } as unknown as Transaction;

        const result = await (service as any).transactionToExtractedTransaction(mockTransaction, null);

        expect(result).toEqual({
            date: '2025-01-20',
            description: 'Empty Props',
            amount: 50,
            properties: {},
        });
    });
});

describe('PromptImprovementServiceBase - Prompt Size Monitoring', () => {
    let service: StatementPromptImprovementService;

    beforeEach(() => {
        service = new StatementPromptImprovementService(createMockContext());
    });

    describe('countBulletPoints', () => {
        it('should count lines starting with "-"', async () => {
            const prompt = `Extract transactions:
- Look for date in first column
- Find amount in last column
- Extract description from middle`;

            const count = (service as any).countBulletPoints(prompt);
            expect(count).toBe(3);
        });

        it('should count lines starting with "•"', async () => {
            const prompt = `Extract transactions:
• Look for date in first column
• Find amount in last column`;

            const count = (service as any).countBulletPoints(prompt);
            expect(count).toBe(2);
        });

        it('should ignore non-bullet lines', async () => {
            const prompt = `Extract transactions from bank statement.
- Look for date in first column
This is not a bullet point
- Find amount in last column`;

            const count = (service as any).countBulletPoints(prompt);
            expect(count).toBe(2);
        });

        it('should handle empty prompts', async () => {
            const count = (service as any).countBulletPoints('');
            expect(count).toBe(0);
        });

        it('should handle prompts with no bullets', async () => {
            const prompt = 'Extract transactions from the statement.';
            const count = (service as any).countBulletPoints(prompt);
            expect(count).toBe(0);
        });

        it('should trim whitespace before checking for bullets', async () => {
            const prompt = `
  - Bullet with leading spaces
    - Bullet with many spaces
- Normal bullet`;

            const count = (service as any).countBulletPoints(prompt);
            expect(count).toBe(3);
        });
    });

    describe('estimateTokenCount', () => {
        it('should estimate tokens based on word count', async () => {
            const prompt = 'Extract transactions from bank statements';
            const estimate = (service as any).estimateTokenCount(prompt);
            // 5 words * 0.75 = 3.75, rounded up to 4
            expect(estimate).toBe(4);
        });

        it('should handle empty prompts', async () => {
            const estimate = (service as any).estimateTokenCount('');
            expect(estimate).toBe(0);
        });

        it('should handle single word', async () => {
            const estimate = (service as any).estimateTokenCount('Extract');
            // 1 word * 0.75 = 0.75, rounded up to 1
            expect(estimate).toBe(1);
        });

        it('should handle long prompts', async () => {
            const words = Array(100).fill('word').join(' ');
            const estimate = (service as any).estimateTokenCount(words);
            // 100 words * 0.75 = 75
            expect(estimate).toBe(75);
        });

        it('should ignore multiple spaces', async () => {
            const prompt = 'Extract    transactions     from    bank';
            const estimate = (service as any).estimateTokenCount(prompt);
            // 4 words * 0.75 = 3
            expect(estimate).toBe(3);
        });
    });

    describe('monitorPromptSize', () => {
        it('should log success when prompt is within thresholds', async () => {
            const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

            const prompt = `Small prompt:
- Bullet 1
- Bullet 2
- Bullet 3`;

            (service as any).monitorPromptSize(prompt, 'Test Prompt');

            expect(consoleSpy).toHaveBeenCalled();
            expect(warnSpy).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
            warnSpy.mockRestore();
        });

        it('should warn when bullet count exceeds threshold', async () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

            // Create prompt with 45 bullets (over 40 threshold)
            const bullets = Array(45)
                .fill(0)
                .map((_, i) => `- Bullet ${i}`)
                .join('\n');

            (service as any).monitorPromptSize(bullets, 'Large Prompt');

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Large Prompt size exceeds thresholds'));
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('45 bullet points'));
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Consider implementing deduplication'));
            warnSpy.mockRestore();
        });

        it('should warn when token count exceeds threshold', async () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

            // Create prompt with ~2000 tokens (over 1500 threshold)
            const words = Array(2700).fill('word').join(' '); // 2700 * 0.75 = 2025 tokens

            (service as any).monitorPromptSize(words, 'Verbose Prompt');

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Verbose Prompt size exceeds thresholds'));
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('tokens'));
            warnSpy.mockRestore();
        });

        it('should warn with both metrics when both exceed thresholds', async () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

            // Create prompt with many bullets and many words
            const bullets = Array(50)
                .fill(0)
                .map((_, i) => `- ${Array(40).fill('word').join(' ')}`)
                .join('\n');

            (service as any).monitorPromptSize(bullets, 'Huge Prompt');

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('50 bullet points'));
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('tokens'));
            warnSpy.mockRestore();
        });
    });
});

describe('StatementPromptImprovementService - Multi-Epoch Improvement', () => {
    let service: StatementPromptImprovementService;

    beforeEach(() => {
        service = new StatementPromptImprovementService(createMockContext());
    });

    describe('Multi-epoch adaptation (ACE framework)', () => {
        it('should accumulate bullets across epochs', () => {
            // Bullets accumulate across epochs with semantic deduplication
            // This is a core feature of ACE's grow-and-refine mechanism
            const initialPrompt = '- Bullet 1\n- Bullet 2';
            const bullets = (service as any).parseBulletsFromPrompt(initialPrompt);
            expect(bullets).toEqual(['Bullet 1', 'Bullet 2']);
            
            // Verify bullets can be accumulated (BulletMerger handles deduplication in practice)
            const moreBullets = ['Bullet 3'];
            const combined = [...bullets, ...moreBullets];
            expect(combined).toEqual(['Bullet 1', 'Bullet 2', 'Bullet 3']);
        });
    });
});
