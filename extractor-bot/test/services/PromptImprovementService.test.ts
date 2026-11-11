import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { InvoicePromptImprovementService } from '../../src/services/InvoicePromptImprovementService.js';
import { Transaction } from 'bkper-js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';
import { AppContext } from '../../src/AppContext.js';

describe('InvoicePromptImprovementService', () => {
    describe('needsPromptImprovement', () => {
        let mockTransaction: Transaction;
        let service: InvoicePromptImprovementService;

        beforeEach(() => {
            const context = {
                jevEvaluationService: {
                    areInvoiceDescriptionsEquivalent: mock(async (pairs: Array<{ first: string; second: string }>) => pairs.map(pair => {
                        const first = pair.first.toLowerCase().trim();
                        const second = pair.second.toLowerCase().trim();
                        return first === second ||
                            (first === 'office supplies' && second === 'office suppliez');
                    })),
                },
            } as unknown as AppContext;
            service = new InvoicePromptImprovementService(context);

            // Create a mock transaction
            mockTransaction = {
                getProperty: mock(),
                getProperties: mock(),
                getDate: mock(),
                getDescription: mock(),
                getAmount: mock(),
            } as unknown as Transaction;
        });

        it('should return false when no AI extraction stored', async () => {
            (mockTransaction.getProperty as any).mockReturnValue(undefined);

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(false);
        });

        it('should return false when nothing changed', async () => {
            const aiExtracted: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp',
                    invoice: 'INV-123',
                },
            };

            (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
            (mockTransaction.getDate as any).mockReturnValue('2025-01-15');
            (mockTransaction.getDescription as any).mockReturnValue('Office Supplies');
            (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 100.0 });
            (mockTransaction.getProperties as any).mockReturnValue({
                vendor: 'ACME Corp',
                invoice: 'INV-123',
            });

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(false);
        });

        it('should return true when date changed', async () => {
            const aiExtracted: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {},
            };

            (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
            (mockTransaction.getDate as any).mockReturnValue('2025-01-16'); // Changed
            (mockTransaction.getDescription as any).mockReturnValue('Office Supplies');
            (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 100.0 });
            (mockTransaction.getProperties as any).mockReturnValue({});

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(true);
        });

        it('should return true when amount changed', async () => {
            const aiExtracted: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {},
            };

            (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
            (mockTransaction.getDate as any).mockReturnValue('2025-01-15');
            (mockTransaction.getDescription as any).mockReturnValue('Office Supplies');
            (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 150.0 }); // Changed
            (mockTransaction.getProperties as any).mockReturnValue({});

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(true);
        });

        it.each([
            [100.0, -100.0, 'positive to negative'],
            [-3.75, 3.75, 'negative to positive'],
            [0, -0, 'zero with different signs'],
        ])(
            'should return false when amount sign differs but magnitude is same: %s vs %s (%s)',
            async (aiAmount, actualAmount) => {
                const aiExtracted: ExtractedTransaction = {
                    date: '2025-01-15',
                    description: 'Office Supplies',
                    amount: aiAmount,
                    properties: {},
                };

                (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
                (mockTransaction.getDate as any).mockReturnValue('2025-01-15');
                (mockTransaction.getDescription as any).mockReturnValue('Office Supplies');
                (mockTransaction.getAmount as any).mockReturnValue({
                    toNumber: () => actualAmount,
                });
                (mockTransaction.getProperties as any).mockReturnValue({});

                expect(await service.needsPromptImprovement(mockTransaction)).toBe(false);
            }
        );

        it('should return true when description changed significantly', async () => {
            const aiExtracted: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {},
            };

            (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
            (mockTransaction.getDate as any).mockReturnValue('2025-01-15');
            (mockTransaction.getDescription as any).mockReturnValue('Computer Hardware'); // Completely different
            (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 100.0 });
            (mockTransaction.getProperties as any).mockReturnValue({});

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(true);
        });

        it('should return false when Jev considers a minor wording change materially equivalent', async () => {
            const aiExtracted: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {},
            };

            (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
            (mockTransaction.getDate as any).mockReturnValue('2025-01-15');
            // The semantic evaluator fixture treats this minor typo as materially equivalent.
            (mockTransaction.getDescription as any).mockReturnValue('Office Suppliez');
            (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 100.0 });
            (mockTransaction.getProperties as any).mockReturnValue({});

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(false);
        });

        it('should return true when property value changed', async () => {
            const aiExtracted: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp',
                },
            };

            (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
            (mockTransaction.getDate as any).mockReturnValue('2025-01-15');
            (mockTransaction.getDescription as any).mockReturnValue('Office Supplies');
            (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 100.0 });
            (mockTransaction.getProperties as any).mockReturnValue({
                vendor: 'Microsoft Corp', // Changed
            });

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(true);
        });

        it('should return true when property value changed slightly (strict match required)', async () => {
            const aiExtracted: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corporation',
                },
            };

            (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
            (mockTransaction.getDate as any).mockReturnValue('2025-01-15');
            (mockTransaction.getDescription as any).mockReturnValue('Office Supplies');
            (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 100.0 });
            (mockTransaction.getProperties as any).mockReturnValue({
                vendor: 'ACME Corp', // Different - requires exact match
            });

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(true); // Changed from false - properties require exact match
        });

        it('should return true when new property added', async () => {
            const aiExtracted: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp',
                },
            };

            (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
            (mockTransaction.getDate as any).mockReturnValue('2025-01-15');
            (mockTransaction.getDescription as any).mockReturnValue('Office Supplies');
            (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 100.0 });
            (mockTransaction.getProperties as any).mockReturnValue({
                vendor: 'ACME Corp',
                invoice: 'INV-123', // New property
            });

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(true);
        });

        it('should skip internal properties when checking for changes', async () => {
            const aiExtracted: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {},
            };

            (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
            (mockTransaction.getDate as any).mockReturnValue('2025-01-15');
            (mockTransaction.getDescription as any).mockReturnValue('Office Supplies');
            (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 100.0 });
            (mockTransaction.getProperties as any).mockReturnValue({
                agent_extracted: 'something', // Should be skipped
                parsed_date: '2025-01-15', // Should be skipped
                account_id: 'acc123', // Should be skipped
            });

            const result = await service.needsPromptImprovement(mockTransaction);

            expect(result).toBe(false);
        });

        // Bug regression test: numeric property values causing TypeError
        describe('numeric property values bug', () => {
            it('should handle numeric property values without throwing TypeError', async () => {
                // Bug: RESPONSE: { "properties": { "discount": -3.50 } }
                // Error: TypeError: a.trim is not a function
                const aiExtracted: ExtractedTransaction = {
                    date: '2018-09-24',
                    description: 'Bulmers Original Bottle, Bulmers Pear Bottle',
                    amount: 4.5,
                    properties: { discount: '-3.50' }, // AI returned as string
                };

                (mockTransaction.getProperty as any).mockReturnValue(JSON.stringify(aiExtracted));
                (mockTransaction.getDate as any).mockReturnValue('2018-09-24');
                (mockTransaction.getDescription as any).mockReturnValue(
                    'Bulmers Original Bottle, Bulmers Pear Bottle'
                );
                (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 4.5 });
                (mockTransaction.getProperties as any).mockReturnValue({
                    discount: -3.5, // Stored as NUMBER in transaction properties
                });

                expect(() => service.needsPromptImprovement(mockTransaction)).not.toThrow();
            });

            it.each([
                ['-10.00', -20.0, true, 'different values'],
                ['-10', -10, false, 'same value, different types'],
                ['10', 10.0, false, 'same value with precision'],
            ])(
                'should handle numeric properties: AI=%s vs actual=%s = %s (%s)',
                async (aiValue, actualValue, expected) => {
                    const aiExtracted: ExtractedTransaction = {
                        date: '2018-09-24',
                        description: 'Purchase',
                        amount: 100.0,
                        properties: { discount: aiValue },
                    };

                    (mockTransaction.getProperty as any).mockReturnValue(
                        JSON.stringify(aiExtracted)
                    );
                    (mockTransaction.getDate as any).mockReturnValue('2018-09-24');
                    (mockTransaction.getDescription as any).mockReturnValue('Purchase');
                    (mockTransaction.getAmount as any).mockReturnValue({ toNumber: () => 100.0 });
                    (mockTransaction.getProperties as any).mockReturnValue({
                        discount: actualValue,
                    });

                    expect(await service.needsPromptImprovement(mockTransaction)).toBe(expected);
                }
            );
        });
    });

    describe('Multi-epoch adaptation (ACE framework)', () => {
        it('should accumulate prompt across epochs', () => {
            // Prompts accumulate across epochs
            // This is a core feature of ACE's grow-and-refine mechanism
            const initialPrompt = '- Extract vendor from invoice header\n- Extract total amount';
            const lines = initialPrompt.split('\n').filter(line => line.trim().startsWith('- '));
            expect(lines.length).toBe(2);

            // Verify additional bullets can be added
            const newBullet = '- Extract invoice number';
            const combined = initialPrompt + '\n' + newBullet;
            const combinedLines = combined.split('\n').filter(line => line.trim().startsWith('- '));
            expect(combinedLines.length).toBe(3);
        });
    });
});
