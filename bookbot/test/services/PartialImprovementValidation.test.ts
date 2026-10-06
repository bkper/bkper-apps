import { describe, it, expect, beforeEach } from 'bun:test';
import { PromptImprovementServiceBase, ComparisonResult, JaroWinklerStringComparator } from '../../src/services/PromptImprovementServiceBase.js';
import { ExtractedTransaction } from '../../src/genai/ExtractedTransaction.js';

// Create a concrete test class to access protected methods
class TestPromptImprovementService extends PromptImprovementServiceBase {
    constructor() {
        super(new JaroWinklerStringComparator());
    }

    /**
     * Compare three extractions to detect improvements and regressions.
     *
     * @param original - Original AI extraction (before prompt improvement)
     * @param improved - New AI extraction (after prompt improvement)
     * @param expected - User corrections (the correct values)
     * @param descriptionSimilarityThreshold - Similarity threshold for description matching (0-1, default: 0.8)
     * @returns ComparisonResult with improvement details
     */
    public async testCompareExtractions(original: ExtractedTransaction, improved: ExtractedTransaction, expected: ExtractedTransaction, descriptionSimilarityThreshold: number = 0.8): Promise<ComparisonResult> {
        return this.compareExtractions(original, improved, expected, descriptionSimilarityThreshold);
    }
}

describe('PartialImprovementValidation - compareExtractions (3-way comparison)', () => {
    let service: TestPromptImprovementService;

    beforeEach(() => {
        service = new TestPromptImprovementService();
    });

    describe('Perfect Match Scenarios', () => {
        it('should detect complete improvement when all properties fixed', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-14', // Wrong
                description: 'Wrong Description', // Wrong
                amount: 50.0, // Wrong
                properties: {}, // Missing properties
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15', // Now correct
                description: 'Office Supplies', // Now correct
                amount: 100.0, // Now correct
                properties: { vendor: 'ACME Corp', invoice: 'INV-123' }, // Now present
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp', invoice: 'INV-123' },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            // All properties were wrong, now all are correct
            expect(result.improvements).toBe(5); // date, amount, description, vendor, invoice
            expect(result.matches).toBe(0); // Nothing was already correct
            expect(result.regressions).toBe(0); // Nothing got worse
            expect(result.stillWrong).toBe(0); // Nothing is still wrong
            expect(result.isImprovement).toBe(true); // improvements > 0 AND regressions === 0
        });

        it('should return no improvement when already perfect (pre-validation catches this)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' },
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' },
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(0); // Nothing improved
            expect(result.matches).toBe(4); // Everything was already correct
            expect(result.regressions).toBe(0);
            expect(result.stillWrong).toBe(0);
            expect(result.isImprovement).toBe(false); // No improvement (already perfect)
        });
    });

    describe('Single Property Improvement (Core User Requirement)', () => {
        it('should accept date-only improvement - user example: "fixed only the date"', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15', // Wrong
                description: 'Wrong Description', // Wrong
                amount: 100.0, // Already correct
                properties: {}, // Missing property
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-16', // NOW CORRECT (only this fixed)
                description: 'Wrong Description', // Still wrong
                amount: 100.0, // Still correct
                properties: {}, // Still missing
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-16',
                description: 'Correct Description',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            // Date: improved (was wrong, now correct)
            // Amount: match (was correct, still correct)
            // Description: still wrong (was wrong, still wrong)
            // Property: still missing (was missing, still missing)
            expect(result.improvements).toBe(1); // Date fixed
            expect(result.matches).toBe(1); // Amount stayed correct
            expect(result.regressions).toBe(0); // Nothing got worse
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT! (1 improvement, 0 regressions)
        });

        it('should accept amount-only improvement', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0, // Wrong
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 150.0, // NOW CORRECT
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 150.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(1); // Amount fixed
            expect(result.matches).toBe(2); // Date and description stayed correct
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT
        });

        it('should accept description-only improvement', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Wrong Description', // Wrong
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Computer Hardware', // NOW CORRECT
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Computer Hardware',
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(1);
            expect(result.matches).toBe(2);
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT
        });

        it('should accept custom property addition (was missing, now present)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {}, // Missing vendor
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' }, // NOW PRESENT
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(1); // vendor added
            expect(result.matches).toBe(3); // date, description, amount stayed correct
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT
        });

        it('should accept custom property value fix (was wrong, now correct)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'Wrong Vendor' }, // Wrong
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' }, // NOW CORRECT
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(1); // vendor fixed
            expect(result.matches).toBe(3); // date, description, amount stayed correct
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT
        });
    });

    describe('Multiple Property Improvements', () => {
        it('should accept when 2 properties improve', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15', // Wrong
                description: 'Wrong Description', // Wrong
                amount: 100.0, // Correct
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-16', // NOW CORRECT
                description: 'Computer Hardware', // NOW CORRECT
                amount: 100.0, // Still correct
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-16',
                description: 'Computer Hardware',
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(2); // Date and description fixed
            expect(result.matches).toBe(1); // Amount stayed correct
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT
        });

        it('should accept when date + property improve', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15', // Wrong
                description: 'Office Supplies',
                amount: 100.0,
                properties: {}, // Missing vendor
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-16', // NOW CORRECT
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' }, // NOW PRESENT
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-16',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp', invoice: 'INV-123' },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(2); // Date and vendor fixed
            expect(result.matches).toBe(2); // Description and amount stayed correct
            expect(result.regressions).toBe(0);
            expect(result.stillWrong).toBeGreaterThan(0); // Invoice still missing
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT (partial improvement)
        });
    });

    describe('Regression Detection (MUST REJECT)', () => {
        it('should reject when date regresses (was correct, now wrong)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-16', // Correct
                description: 'Office Supplies',
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15', // NOW WRONG (regression!)
                description: 'Office Supplies',
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-16',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(0);
            expect(result.regressions).toBe(1); // Date got worse
            expect(result.isImprovement).toBe(false); // ❌ REJECT (regression occurred)
        });

        it('should reject when amount regresses', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 150.0, // Correct
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0, // NOW WRONG
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 150.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.regressions).toBe(1);
            expect(result.isImprovement).toBe(false); // ❌ REJECT
        });

        it('should reject when description regresses', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Computer Hardware', // Correct
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Wrong Description', // NOW WRONG
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Computer Hardware',
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.regressions).toBe(1);
            expect(result.isImprovement).toBe(false); // ❌ REJECT
        });

        it('should reject when custom property value regresses', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' }, // Correct
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'Wrong Vendor' }, // NOW WRONG
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.regressions).toBe(1);
            expect(result.isImprovement).toBe(false); // ❌ REJECT
        });

        it('should reject when property is removed (was present, now missing)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' }, // Present
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {}, // NOW MISSING (regression!)
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: { vendor: 'ACME Corp' },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.regressions).toBe(1); // vendor removed
            expect(result.isImprovement).toBe(false); // ❌ REJECT
        });

        it('should reject even if one property improves but another regresses', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15', // Wrong
                description: 'Computer Hardware', // Correct
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-16', // NOW CORRECT (improvement!)
                description: 'Wrong Description', // NOW WRONG (regression!)
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-16',
                description: 'Computer Hardware',
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(1); // Date fixed
            expect(result.regressions).toBe(1); // Description broke
            expect(result.isImprovement).toBe(false); // ❌ REJECT (any regression = reject)
        });
    });

    describe('Sign-Agnostic Amount Comparison', () => {
        it('should match amounts with different signs (100 vs -100)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 50.0, // Wrong
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0, // Correct (sign doesn't matter)
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: -100.0, // Opposite sign but same magnitude
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(1); // Amount fixed (sign-agnostic)
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT
        });

        it('should match 3.75 with -3.75 (precision test)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 5.0, // Wrong
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 3.75, // Correct
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: -3.75, // Opposite sign
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(1);
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true);
        });
    });

    describe('Fuzzy Description Matching (80% threshold)', () => {
        it('should match similar descriptions above 80% threshold', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Wrong Description',
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Suppliesz', // Similar to expected (93% similar, ~6% length diff)
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies', // Fuzzy match with improved
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(1); // Description improved (fuzzy match)
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true);
        });

        it('should not match descriptions below 80% threshold', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Old Wrong Description',
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies', // Not similar enough
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Computer Equipment', // Very different
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            // Both descriptions don't match expected (below 80% threshold)
            expect(result.improvements).toBe(0);
            expect(result.regressions).toBe(0);
            expect(result.stillWrong).toBeGreaterThan(0);
            expect(result.isImprovement).toBe(false); // No improvement
        });
    });

    describe('Property Filtering (SKIP_PROPERTIES)', () => {
        it('should skip internal properties in comparison', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0,
                properties: {
                    vendor: 'Wrong Vendor',
                    agent_extracted: 'should be ignored',
                    parsed_date: 'should be ignored',
                },
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp', // Fixed
                    agent_extracted: 'different value',
                    parsed_date: 'different value',
                    account_id: 'should be ignored',
                },
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp',
                },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            // Should only compare vendor, not internal properties
            expect(result.improvements).toBe(1); // vendor fixed
            expect(result.regressions).toBe(0); // Internal properties ignored
            expect(result.isImprovement).toBe(true);
        });
    });

    describe('Complex Multi-Property Scenarios', () => {
        it('should handle mix of improvements and still-wrong properties', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15', // Wrong
                description: 'Wrong Description', // Wrong
                amount: 100.0, // Correct
                properties: { vendor: 'Wrong Vendor' }, // Wrong, invoice missing
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-16', // NOW CORRECT
                description: 'Wrong Description', // Still wrong
                amount: 100.0, // Still correct
                properties: { vendor: 'ACME Corp' }, // NOW CORRECT, invoice still missing
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-16',
                description: 'Correct Description',
                amount: 100.0,
                properties: { vendor: 'ACME Corp', invoice: 'INV-123' },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(2); // date and vendor fixed
            expect(result.matches).toBe(1); // amount stayed correct
            expect(result.regressions).toBe(0); // nothing got worse
            expect(result.stillWrong).toBeGreaterThan(0); // description still wrong, invoice missing
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT (2 improvements, 0 regressions)
        });

        it('should handle numeric property values', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Purchase',
                amount: 100.0,
                properties: {
                    discount: -5.0, // Wrong
                },
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Purchase',
                amount: 100.0,
                properties: {
                    discount: -10.0, // NOW CORRECT (numeric)
                },
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Purchase',
                amount: 100.0,
                properties: {
                    discount: '-10', // String value (should still match)
                },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            // Should match despite type difference (numeric -10.0 vs string "-10")
            expect(result.improvements).toBe(1); // discount fixed
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true);
        });
    });

    describe('Property Count Reduction (Fixing False Positives)', () => {
        it('should accept improvement when reducing property count (AI over-extracted, user removed incorrect properties)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp', // Correct
                    invoice: 'INV-WRONG', // Incorrect (AI hallucinated)
                    category: 'Office', // Incorrect (AI hallucinated)
                },
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp', // Still correct
                    // invoice and category correctly NOT extracted (AI learned to avoid false positives)
                },
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp', // User kept only this
                    // User REMOVED invoice and category (they were wrong)
                },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            // vendor: match (was correct, still correct)
            // invoice: improvement (was wrongly present in original, correctly absent in improved)
            // category: improvement (was wrongly present in original, correctly absent in improved)
            expect(result.improvements).toBe(2); // invoice and category removal
            expect(result.matches).toBe(4); // date, description, amount, vendor
            expect(result.regressions).toBe(0); // Nothing got worse
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT (AI learned to not extract false positives)
        });

        it('should accept when all properties are removed (AI was completely wrong)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0,
                properties: {
                    vendor: 'Wrong Corp', // All wrong
                    invoice: 'WRONG-123',
                    category: 'Wrong',
                },
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0,
                properties: {}, // Correctly extracted nothing (learned not to hallucinate)
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0,
                properties: {}, // User removed all (they were all wrong)
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(3); // All 3 false positives removed
            expect(result.matches).toBe(3); // date, description, amount
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true); // ✅ ACCEPT
        });

        it('should reject when improved adds back a property that user removed', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp',
                    invoice: 'WRONG-123', // Was wrong
                },
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp',
                    invoice: 'STILL-WRONG', // Still extracting (didn't learn)
                },
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Payment',
                amount: 100.0,
                properties: {
                    vendor: 'ACME Corp',
                    // invoice was REMOVED by user (was wrong)
                },
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            // vendor: match
            // invoice: still wrong (was present and wrong, still present)
            expect(result.improvements).toBe(0);
            expect(result.stillWrong).toBe(1); // invoice still being extracted
            expect(result.isImprovement).toBe(false); // ❌ REJECT (no improvement)
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty properties in all three extractions', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15', // Wrong
                description: 'Payment',
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-16', // NOW CORRECT
                description: 'Payment',
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-16',
                description: 'Payment',
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(1); // date fixed
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(true);
        });

        it('should handle when nothing changes (no improvement, no regression)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15', // Wrong
                description: 'Wrong Description', // Wrong
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15', // Still wrong
                description: 'Wrong Description', // Still wrong
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-16',
                description: 'Correct Description',
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(0); // Nothing fixed
            expect(result.regressions).toBe(0); // Nothing broke
            expect(result.matches).toBe(1); // Amount stayed correct
            expect(result.stillWrong).toBe(2); // Date and description still wrong
            expect(result.isImprovement).toBe(false); // ❌ REJECT (no improvement)
        });
    });

    describe('Context-Specific Similarity Thresholds', () => {
        it('should accept 75% similar descriptions with 60% threshold (curation)', async () => {
            // Real example from user regression test
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Artículos de limpieza, papel y comestibles', // Original
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Comestibles y artículos de limpieza', // 75.80% similar (reordered, missing "papel")
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Artículos de limpieza, papel y comestibles',
                amount: 100.0,
                properties: {},
            };

            // With 60% threshold (curation) - should PASS
            const result60 = await service.testCompareExtractions(original, improved, expected, 0.6);
            // Description similarity is 75.80%, which is > 60%, so it should match
            expect(result60.improvements).toBe(0); // Description matches at 60% threshold
            expect(result60.matches).toBe(3); // date, amount, description all match
            expect(result60.regressions).toBe(0);
        });

        it('should reject 75% similar descriptions with 80% threshold (statement)', async () => {
            // Same example but with 80% threshold
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Artículos de limpieza, papel y comestibles',
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Comestibles y artículos de limpieza', // 75.80% similar
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Artículos de limpieza, papel y comestibles',
                amount: 100.0,
                properties: {},
            };

            // At default 80% threshold - descriptions don't match
            // Original description doesn't match expected (both are same)
            // Improved description doesn't match expected (75.80% < 80%)
            const result80 = await service.testCompareExtractions(original, improved, expected);
            // Original matches expected (same), improved doesn't match (75.80% < 80%)
            expect(result80.regressions).toBe(1); // Description regressed
            expect(result80.isImprovement).toBe(false);
        });

        it('should handle 70% threshold for invoice validation (moderate)', async () => {
            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Hardware Purchase', // Wrong (56% similar)
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies and Hardware', // Now correct (100% similar)
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies and Hardware',
                amount: 100.0,
                properties: {},
            };

            // Original description: 55.88% similar (below 70% threshold)
            // Improved description: 100% similar (above 70% threshold)
            // With 70% threshold, original should NOT match, improved should match
            const result70 = await service.testCompareExtractions(original, improved, expected, 0.7);
            // Original doesn't match, improved matches -> improvement
            expect(result70.improvements).toBe(1); // Description improved
            expect(result70.regressions).toBe(0); // No regressions
            expect(result70.isImprovement).toBe(true);
        });
    });

    describe('Account Name Handling in Descriptions', () => {
        it('should note that account names are stripped during Transaction conversion, not during comparison', async () => {
            // NOTE: Account name stripping happens in transactionToExtractedTransaction(),
            // which is called when converting a bkper.Transaction to ExtractedTransaction.
            //
            // This test documents that ExtractedTransaction objects passed to compareExtractions()
            // should already have account names stripped.
            //
            // Example flow:
            // 1. User corrects transaction in Bkper UI, which may append account name: "Office Supplies [Cash]"
            // 2. transactionToExtractedTransaction() strips "Cash": description becomes "Office Supplies []"
            // 3. AI re-extracts: "Office Supplies"
            // 4. Comparison succeeds because both are normalized

            const original: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies', // AI extracted (no account name)
                amount: 100.0,
                properties: {},
            };

            const improved: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies', // AI re-extracted (no account name)
                amount: 100.0,
                properties: {},
            };

            const expected: ExtractedTransaction = {
                date: '2025-01-15',
                description: 'Office Supplies', // User-corrected, account name already stripped
                amount: 100.0,
                properties: {},
            };

            const result = await service.testCompareExtractions(original, improved, expected);

            expect(result.improvements).toBe(0);
            expect(result.matches).toBe(3); // date, amount, description
            expect(result.regressions).toBe(0);
            expect(result.isImprovement).toBe(false); // Already perfect
        });
    });
});
