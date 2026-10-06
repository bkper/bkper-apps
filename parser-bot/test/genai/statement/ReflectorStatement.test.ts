/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';
import { File } from 'bkper-js';
import { ReflectorStatementIMG } from '../../../src/genai/statement/img/ReflectorStatementIMG.js';
import { ExtractedTransaction } from '../../../src/genai/ExtractedTransaction.js';

describe('ReflectorStatement', () => {
    let reflector: ReflectorStatementIMG;
    let mockFile: File;
    let env: Env;

    beforeEach(() => {
        env = {} as Env;
        mockFile = {
            id: 'file123',
            getName: () => 'bank-statement.pdf',
            getContentType: () => 'application/pdf',
            getContent: mock().mockResolvedValue('base64content'),
        } as unknown as File;

        reflector = new ReflectorStatementIMG(mockFile, env);
    });

    describe('Basic Structure', () => {
        it('should have system prompt for statement extraction analysis', () => {
            const systemPrompt = reflector.getSystemPrompt();
            expect(systemPrompt).toContain('bank statement extraction');
            expect(systemPrompt).toContain('Document structure');
            expect(systemPrompt).toContain('Column patterns');
        });
    });

    describe('Reflection Analysis', () => {
        it('should return ReflectionResult structure with all required fields', async () => {
            // Mock the extract method to return valid reflection
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: ['Date extraction was accurate'],
                whatFailed: ['Amount signs were incorrect'],
                suggestedImprovements: 'Add explicit guidance for debit/credit detection',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];

            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: -100, properties: {} },
            ];

            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result).toHaveProperty('whatWorked');
            expect(result).toHaveProperty('whatFailed');
            expect(result).toHaveProperty('suggestedImprovements');
            expect(Array.isArray(result!.whatWorked)).toBe(true);
            expect(Array.isArray(result!.whatFailed)).toBe(true);
            expect(typeof result!.suggestedImprovements).toBe('string');
        });

        it('should handle empty whatWorked array', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: [],
                whatFailed: ['Everything failed'],
                suggestedImprovements: 'Complete rewrite needed',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result!.whatWorked).toEqual([]);
        });

        it('should handle empty whatFailed array when extraction was perfect', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: ['All transactions extracted correctly'],
                whatFailed: [],
                suggestedImprovements: 'No improvements needed',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result!.whatFailed).toEqual([]);
        });

        it('should return undefined when extraction fails', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue(undefined);

            const aiExtracted: ExtractedTransaction[] = [];
            const userCorrected: ExtractedTransaction[] = [];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeUndefined();
        });
    });

    describe('Prompt Construction', () => {
        it('should include all three datasets in prompt', async () => {
            let capturedPrompt = '';
            spyOn(reflector as any, 'extract').mockImplementation(async (...args: any[]) => {
                const prompt = args[0] as string;
                capturedPrompt = prompt;
                return {
                    whatWorked: [],
                    whatFailed: [],
                    suggestedImprovements: '',
                };
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment 1', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment 1 Fixed', amount: 100, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [
                { date: '2025-01-11', description: 'False Positive', amount: 50, properties: {} },
            ];

            await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(capturedPrompt).toContain('AI Extracted Transactions');
            expect(capturedPrompt).toContain('User Corrected To');
            expect(capturedPrompt).toContain('Transactions Removed by User - TRASHED');
            expect(capturedPrompt).toContain('(1 total)'); // Count for each dataset
        });

        it('should include transaction counts in prompt', async () => {
            let capturedPrompt = '';
            spyOn(reflector as any, 'extract').mockImplementation(async (...args: any[]) => {
                capturedPrompt = args[0] as string;
                return {
                    whatWorked: [],
                    whatFailed: [],
                    suggestedImprovements: '',
                };
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment 1', amount: 100, properties: {} },
                { date: '2025-01-11', description: 'Payment 2', amount: 200, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment 1', amount: 100, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];

            await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(capturedPrompt).toContain('(2 total)'); // AI extracted
            expect(capturedPrompt).toContain('(1 total)'); // User corrected
            expect(capturedPrompt).toContain('(0 total)'); // User removed
        });

        it('should emphasize spatial and structural analysis in prompt', async () => {
            let capturedPrompt = '';
            spyOn(reflector as any, 'extract').mockImplementation(async (...args: any[]) => {
                capturedPrompt = args[0] as string;
                return {
                    whatWorked: [],
                    whatFailed: [],
                    suggestedImprovements: '',
                };
            });

            const aiExtracted: ExtractedTransaction[] = [];
            const userCorrected: ExtractedTransaction[] = [];
            const userRemoved: ExtractedTransaction[] = [];

            await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(capturedPrompt.toLowerCase()).toContain('where in the document');
            expect(capturedPrompt.toLowerCase()).toContain('which columns');
            expect(capturedPrompt.toLowerCase()).toContain('table structure');
            expect(capturedPrompt.toLowerCase()).toContain('transaction boundaries');
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty aiExtracted array', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: [],
                whatFailed: ['No transactions extracted'],
                suggestedImprovements: 'Find the correct table in document',
            });

            const aiExtracted: ExtractedTransaction[] = [];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result!.whatFailed).toContain('No transactions extracted');
        });

        it('should handle transactions with complex properties', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: ['Properties extracted correctly'],
                whatFailed: [],
                suggestedImprovements: 'None',
            });

            const aiExtracted: ExtractedTransaction[] = [
                {
                    date: '2025-01-10',
                    description: 'Payment',
                    amount: 100,
                    properties: { ref: '12345', category: 'food', merchant: 'Store ABC' },
                },
            ];
            const userCorrected: ExtractedTransaction[] = [
                {
                    date: '2025-01-10',
                    description: 'Payment',
                    amount: 100,
                    properties: { ref: '12345', category: 'food', merchant: 'Store ABC' },
                },
            ];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
        });

        it('should handle all transactions being removed (all false positives)', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: [],
                whatFailed: ['Extracted from wrong section of document'],
                suggestedImprovements: 'Specify correct document area for transactions',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Header', amount: 100, properties: {} },
                { date: '2025-01-11', description: 'Footer', amount: 200, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [];
            const userRemoved: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Header', amount: 100, properties: {} },
                { date: '2025-01-11', description: 'Footer', amount: 200, properties: {} },
            ];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result!.whatFailed[0]).toContain('wrong section');
        });
    });
});
