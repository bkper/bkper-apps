import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';
import { File } from 'bkper-js';
import { ReflectorInvoice } from '../../../src/genai/invoice/ReflectorInvoice.js';
import { ExtractedTransaction } from '../../../src/genai/ExtractedTransaction.js';

describe('ReflectorInvoice', () => {
    let reflector: ReflectorInvoice;
    let mockFile: File;
    let env: Env;

    beforeEach(() => {
        env = {} as Env;
        mockFile = {
            id: 'file123',
            getName: () => 'invoice.pdf',
            getContentType: () => 'application/pdf',
            getContent: mock().mockResolvedValue('base64content'),
        } as unknown as File;

        reflector = new ReflectorInvoice(mockFile, env);
    });

    describe('Basic Structure', () => {
        it('should have system prompt for invoice/receipt extraction analysis', () => {
            const systemPrompt = reflector.getSystemPrompt();
            expect(systemPrompt).toContain('invoice');
            expect(systemPrompt).toContain('receipt');
            expect(systemPrompt).toContain('extraction quality');
        });
    });

    describe('Reflection Analysis', () => {
        it('should return ReflectionResult structure with all required fields', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: ['Date correctly extracted'],
                whatFailed: ['Amount incorrect'],
                suggestedImprovements: 'Extract total amount, not subtotal',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 100, properties: {} },
            ];

            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 110, properties: {} },
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

        it('should handle invoice-specific issues like missing properties', async () => {
            spyOn(reflector as any, 'extract').mockResolvedValue({
                whatWorked: ['Amount and date correct'],
                whatFailed: ['Missing vendor property'],
                suggestedImprovements: 'Extract vendor name from invoice header',
            });

            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 100, properties: { vendor: 'ACME Corp' } },
            ];
            const userRemoved: ExtractedTransaction[] = [];

            const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

            expect(result).toBeDefined();
            expect(result!.whatFailed[0]).toContain('vendor');
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
                { date: '2025-01-10', description: 'Office Supplies', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 110, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];

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
                { date: '2025-01-10', description: 'Office Supplies', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 110, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];
            const currentPrompt = '- Extract vendor from top of invoice\n- Extract invoice number';

            await reflector.reflect(aiExtracted, userCorrected, userRemoved, currentPrompt);

            expect(buildPromptSpy).toHaveBeenCalledWith(aiExtracted, userCorrected, userRemoved, currentPrompt);
        });

        it('should include current prompt instructions in the user prompt text', () => {
            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 110, properties: { vendor: 'ACME' } },
            ];
            const userRemoved: ExtractedTransaction[] = [];
            const currentPrompt = '- Extract total amount including tax\n- Extract vendor from header';

            const prompt = (reflector as any).buildUserPrompt(aiExtracted, userCorrected, userRemoved, currentPrompt);

            expect(prompt).toContain('CURRENT INSTRUCTIONS (already in effect):');
            expect(prompt).toContain('- Extract total amount including tax');
            expect(prompt).toContain('- Extract vendor from header');
            expect(prompt).toContain('These instructions are already in effect');
            expect(prompt).toContain('DO NOT contradict these existing instructions');
        });

        it('should not include current prompt section when currentPrompt is undefined', () => {
            const aiExtracted: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 100, properties: {} },
            ];
            const userCorrected: ExtractedTransaction[] = [
                { date: '2025-01-10', description: 'Office Supplies', amount: 110, properties: {} },
            ];
            const userRemoved: ExtractedTransaction[] = [];

            const prompt = (reflector as any).buildUserPrompt(aiExtracted, userCorrected, userRemoved);

            expect(prompt).not.toContain('CURRENT INSTRUCTIONS');
            expect(prompt).not.toContain('already in effect');
        });
    });
});
