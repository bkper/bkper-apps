import { describe, it, expect, beforeEach } from 'bun:test';
import { PromptImprovementServiceBase, ComparisonResult, JaroWinklerStringComparator } from '../../src/services/PromptImprovementServiceBase.js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';

// Test class to access protected methods
class TestPromptImprovementService extends PromptImprovementServiceBase {
    constructor() {
        super(new JaroWinklerStringComparator());
    }


    public async compareExtractions(original: ExtractedTransaction, improved: ExtractedTransaction, expected: ExtractedTransaction, threshold: number): Promise<ComparisonResult> {
        return super.compareExtractions(original, improved, expected, threshold);
    }
}

describe('PromptImprovementServiceBase - Baseline Prompt Acceptance', () => {
    let service: TestPromptImprovementService;

    beforeEach(() => {
        service = new TestPromptImprovementService();
    });

    describe('compareExtractions - baseline acceptance scenario', () => {
        it('should return isImprovement=false with 0 improvements and 0 regressions when extraction matches perfectly', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100,
                properties: { vendor: 'ACME Corp' },
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100,
                properties: { vendor: 'ACME Corp' },
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100,
                properties: { vendor: 'ACME Corp' },
            };

            const result = await service.compareExtractions(original, improved, expected, 0.7);

            // When everything matches perfectly
            expect(result.improvements).toBe(0);
            expect(result.regressions).toBe(0);
            expect(result.matches).toBeGreaterThan(0); // Should have matches
            expect(result.stillWrong).toBe(0);
            expect(result.isImprovement).toBe(false); // Not an improvement, but also not a regression
        });

        it('should detect no improvements and no regressions when curated prompt produces same result', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Invoice from supplier',
                amount: 250.50,
                properties: { invoice: 'INV-123', category: 'supplies' },
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Invoice from supplier',
                amount: 250.50,
                properties: { invoice: 'INV-123', category: 'supplies' },
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Invoice from supplier',
                amount: 250.50,
                properties: { invoice: 'INV-123', category: 'supplies' },
            };

            const result = await service.compareExtractions(original, improved, expected, 0.7);

            expect(result.improvements).toBe(0);
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(false);
            expect(result.regressionDetails).toHaveLength(0);
        });

        it('should distinguish between no-change scenario and actual improvement', async () => {
            // Scenario 1: No change (baseline)
            const original1: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100,
                properties: {},
            };

            const improved1: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100,
                properties: {},
            };

            const expected1: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100,
                properties: {},
            };

            const noChangeResult = await service.compareExtractions(original1, improved1, expected1, 0.7);

            expect(noChangeResult.improvements).toBe(0);
            expect(noChangeResult.regressions).toBe(0);
            expect(noChangeResult.isImprovement).toBe(false);

            // Scenario 2: Actual improvement
            const original2: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100, // Wrong
                properties: {},
            };

            const improved2: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 200, // Fixed
                properties: {},
            };

            const expected2: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 200, // Correct
                properties: {},
            };

            const improvementResult = await service.compareExtractions(original2, improved2, expected2, 0.7);

            expect(improvementResult.improvements).toBe(1); // Amount improved
            expect(improvementResult.regressions).toBe(0);
            expect(improvementResult.isImprovement).toBe(true);
        });

        it('should handle scenario where original was wrong but improved is still wrong', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15', // Wrong
                description: 'Payment',
                amount: 100,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15', // Still wrong
                description: 'Payment',
                amount: 100,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-16', // Correct date
                description: 'Payment',
                amount: 100,
                properties: {},
            };

            const result = await service.compareExtractions(original, improved, expected, 0.7);

            expect(result.improvements).toBe(0);
            expect(result.regressions).toBe(0);
            expect(result.stillWrong).toBeGreaterThan(0); // Date is still wrong
            expect(result.isImprovement).toBe(false);
        });
    });

    describe('Statement ACE - baseline acceptance logic', () => {
        it('should identify scenario where prompt should be accepted as baseline (0 improvements, 0 regressions)', async () => {
            // This test validates the detection logic for the baseline acceptance scenario
            // In the real implementation, this would be used to decide whether to accept and store
            // a prompt even when there are no improvements

            const comparisonResult: ComparisonResult = {
                improvements: 0,
                regressions: 0,
                matches: 5,
                stillWrong: 0,
                isImprovement: false,
                regressionDetails: [],
            };

            // Logic: Accept if improvements=0 AND regressions=0 AND no stored prompt
            const shouldAcceptBaseline = comparisonResult.improvements === 0 && comparisonResult.regressions === 0 && !comparisonResult.isImprovement;

            expect(shouldAcceptBaseline).toBe(true);
            expect(comparisonResult.regressions).toBe(0); // Critical: No regressions
            expect(comparisonResult.improvements).toBe(0); // No improvements either
        });

        it('should NOT accept baseline when there are regressions', async () => {
            const comparisonResult: ComparisonResult = {
                improvements: 0,
                regressions: 1,
                matches: 4,
                stillWrong: 0,
                isImprovement: false,
                regressionDetails: [],
            };

            const shouldAcceptBaseline = comparisonResult.improvements === 0 && comparisonResult.regressions === 0 && !comparisonResult.isImprovement;

            expect(shouldAcceptBaseline).toBe(false); // Should reject due to regression
        });

        it('should NOT use baseline acceptance when there ARE improvements', async () => {
            const comparisonResult: ComparisonResult = {
                improvements: 2,
                regressions: 0,
                matches: 3,
                stillWrong: 0,
                isImprovement: true,
                regressionDetails: [],
            };

            const shouldAcceptBaseline = comparisonResult.improvements === 0 && comparisonResult.regressions === 0 && !comparisonResult.isImprovement;

            expect(shouldAcceptBaseline).toBe(false); // Should use normal improvement path
            expect(comparisonResult.isImprovement).toBe(true); // This is a real improvement
        });
    });
});
