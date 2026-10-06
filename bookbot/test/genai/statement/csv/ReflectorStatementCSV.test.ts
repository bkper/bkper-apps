import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';
import { File } from 'bkper-js';
import { ReflectorStatementCSV } from '../../../../src/genai/statement/csv/ReflectorStatementCSV.js';
import { ExtractedTransaction } from '../../../../src/genai/ExtractedTransaction.js';

describe('ReflectorStatementCSV', () => {
    let reflector: ReflectorStatementCSV;
    let mockFile: File;
    let env: Env;

    beforeEach(() => {
        env = {} as Env;
        mockFile = {
            id: 'file123',
            getName: () => 'bank-statement.csv',
            getContentType: () => 'text/csv',
            getContent: mock().mockResolvedValue('base64content'),
        } as unknown as File;

        reflector = new ReflectorStatementCSV(mockFile, env);
    });

    describe('Basic Structure', () => {
        it('should have system prompt for CSV extraction analysis', () => {
            const systemPrompt = reflector.getSystemPrompt();
            expect(systemPrompt).toContain('CSV');
            expect(systemPrompt).toContain('Column mapping');
            expect(systemPrompt).toContain('Delimiter');
        });

        it('should focus on column mapping, not spatial layout', () => {
            const systemPrompt = reflector.getSystemPrompt();
            expect(systemPrompt).toContain('column');
            expect(systemPrompt).toContain('delimiter');
            expect(systemPrompt).toContain('header');
            expect(systemPrompt).not.toContain('page');
            expect(systemPrompt).not.toContain('spatial');
        });
    });

    describe('Reflection Analysis', () => {
        it('should return ReflectionResult structure with all required fields', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: ['Date column correctly identified as column 1'],
                whatFailed: ['Amount in column 4, not column 3'],
                suggestedImprovements: 'Map amount to column 4 instead of column 3',
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

        it('should handle CSV-specific issues like wrong column mapping', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: ['Delimiter correctly detected as comma'],
                whatFailed: ['Description extracted from column 2, should be column 3'],
                suggestedImprovements: 'Use column 3 for description, not column 2',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Wrong', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Correct', amount: 100, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result!.whatFailed[0]).toContain('column');
        });

        it('should handle header row issues', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: ['Transaction rows correctly extracted'],
                whatFailed: ['Header row was included as a transaction'],
                suggestedImprovements: 'Skip the first row (header row)',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: 'Date', description: 'Description', amount: 0, properties: {} },
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result!.whatFailed[0]).toContain('Header');
        });

        it('should handle delimiter detection issues', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: [],
                whatFailed: ['Delimiter incorrectly detected as comma, should be semicolon'],
                suggestedImprovements: 'Use semicolon as delimiter, not comma',
            });

            const aiExtracted: ExtractedTransaction[] = [];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result!.whatFailed[0]).toContain('Delimiter');
        });

        it('should handle empty arrays', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: [],
                whatFailed: ['All transactions missed'],
                suggestedImprovements: 'Review column mappings',
            });

            const aiExtracted: ExtractedTransaction[] = [];
            const userCorrected: ExtractedTransaction[] = [];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result!.whatWorked).toEqual([]);
        });
    });

    describe('Prompt Construction', () => {
        it('should include all three datasets in prompt', async () => {
            const buildPromptSpy = spyOn(reflector as any, 'buildUserPrompt');
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: [],
                whatFailed: [],
                suggestedImprovements: '',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: -100, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [
                { date: '2025-01-11', description: 'Header', amount: 0, properties: {} },
            ];

            await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(buildPromptSpy).toHaveBeenCalledWith(aiExtracted, userCorrected, userRemoved, undefined);
        });

        it('should include current prompt when provided for multi-epoch context', async () => {
            const buildPromptSpy = spyOn(reflector as any, 'buildUserPrompt');
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: [],
                whatFailed: [],
                suggestedImprovements: '',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Payment', amount: -100, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];
            const currentPrompt = '- Map column A to date\n- Map column B to description';

            await reflector.reflect(aiExtracted, userCorrected, userRemoved, currentPrompt);

            expect(buildPromptSpy).toHaveBeenCalledWith(aiExtracted, userCorrected, userRemoved, currentPrompt);
        });

        it('should include current prompt instructions in the user prompt text', () => {
            const aiExtracted: ExtractedTransaction[] = [];
            const userCorrected: ExtractedTransaction[] = [];
            const userRemoved: ExtractedTransaction[] = [];
            const currentPrompt = '- Only extract rows where column C is zero\n- Skip header row';

            const prompt = (reflector as any).buildUserPrompt(aiExtracted, userCorrected, userRemoved, currentPrompt);

            expect(prompt).toContain('Current Extraction Instructions Being Used:');
            expect(prompt).toContain('- Only extract rows where column C is zero');
            expect(prompt).toContain('- Skip header row');
            expect(prompt).toContain('IMPORTANT CONTEXT: These instructions are already in effect');
            expect(prompt).toContain('WITHOUT contradicting these existing instructions');
        });
    });
});
