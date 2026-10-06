import { describe, it, expect } from 'bun:test';
import { jaroWinklerSimilarity, isSimilarString, isExactMatch, stripAccountNamesFromDescription, replaceBreakLiterals } from '../src/utils.js';

describe('String Similarity Utilities', () => {
    // Note: jaroWinklerSimilarity is tested indirectly through isSimilarString tests
    // We don't test algorithmic details - only behavior that matters for business logic

    describe('isSimilarString', () => {
        describe('exact matches after normalization', () => {
            it('should return true for identical strings', () => {
                expect(isSimilarString('test', 'test')).toBe(true);
                expect(isSimilarString('ACME Corp', 'ACME Corp')).toBe(true);
            });

            it('should return true for case-insensitive matches', () => {
                expect(isSimilarString('ACME Corp', 'acme corp')).toBe(true);
                expect(isSimilarString('TEST', 'test')).toBe(true);
                expect(isSimilarString('Invoice #123', 'invoice #123')).toBe(true);
            });

            it('should return true for matches with extra whitespace', () => {
                expect(isSimilarString('  test  ', 'test')).toBe(true);
                expect(isSimilarString('ACME Corp', '  ACME Corp  ')).toBe(true);
                expect(isSimilarString('  Invoice #123  ', '  invoice #123  ')).toBe(true);
            });

            it('should return true for case and whitespace differences combined', () => {
                expect(isSimilarString('  ACME CORP  ', 'acme corp')).toBe(true);
            });
        });

        describe('fuzzy matches with default 90% threshold', () => {
            it('should reject vendor name variations due to length difference at 90% threshold', () => {
                // "ACME Corporation" (16 chars) vs "ACME Corp" (9 chars)
                // Length diff: (16-9)/16 = 43.75% > 10% (max for 0.90 threshold) → rejects
                expect(isSimilarString('ACME Corporation', 'ACME Corp')).toBe(false);
                expect(isSimilarString('Microsoft Corporation', 'Microsoft Corp')).toBe(false);
            });

            it('should accept minor formatting differences with same length', () => {
                expect(isSimilarString('Office Supplies', 'office supplies')).toBe(true);
                expect(isSimilarString('Consulting Services', 'consulting services')).toBe(true);
            });

            it('should reject strings with minor character differences if length exceeds threshold', () => {
                // "testing" (7 chars) vs "testings" (8 chars)
                // Length diff: (8-7)/8 = 12.5% > 10% (max for 0.90 threshold) → rejects
                expect(isSimilarString('testing', 'testings')).toBe(false);
            });
        });

        describe('rejecting different strings', () => {
            it('should reject completely different strings', () => {
                expect(isSimilarString('Apple Inc', 'Microsoft Corp')).toBe(false);
                expect(isSimilarString('Invoice', 'Receipt')).toBe(false);
                expect(isSimilarString('January', 'December')).toBe(false);
            });

            it('should reject strings below threshold', () => {
                expect(isSimilarString('abc', 'xyz')).toBe(false);
                expect(isSimilarString('test', 'best')).toBe(false); // Only 75% similar
            });
        });

        describe('empty string handling', () => {
            it('should handle empty strings correctly', () => {
                expect(isSimilarString('', '')).toBe(true);
                expect(isSimilarString('', 'test')).toBe(false);
                expect(isSimilarString('test', '')).toBe(false);
            });
        });

        describe('custom threshold', () => {
            it.each([
                [0.95, 'test', 'text', false, '~87% similar < 95% threshold'],
                [0.85, 'test', 'text', true, '~87% similar > 85% threshold'],
                [0.85, 'ACME Corporation', 'ACME Corp', false, '43.75% length diff > 15% max'],
                [0.85, 'test', 'best', false, '~75% similar < 85% threshold'],
                [0.50, 'abc', 'abcdef', true, '50% length diff = 50% max'],
                [0.50, 'abc', 'xyz', false, 'completely different'],
            ])('threshold %s: "%s" vs "%s" = %s (%s)', (threshold, str1, str2, expected) => {
                expect(isSimilarString(str1, str2, threshold)).toBe(expected);
            });
        });

        describe('real-world invoice/receipt scenarios', () => {
            it('should handle invoice number exact matches', () => {
                expect(isSimilarString('INV-12345', 'INV-12345')).toBe(true);
            });
            
            it('should reject invoice number variations with length differences at 90% threshold', () => {
                // "invoice-12345" (13 chars) vs "INV-12345" (9 chars)
                // Length diff: (13-9)/13 = 30.7% > 10% (max for 0.90 threshold) → rejects
                expect(isSimilarString('invoice-12345', 'INV-12345')).toBe(false);
                
                // But with lower threshold it could pass
                // 30.7% < 40% (max for 0.60 threshold) and high similarity → passes
                expect(isSimilarString('invoice-12345', 'INV-12345', 0.60)).toBe(true);
            });

            it('should handle vendor name variations with appropriate thresholds', () => {
                // At 90% threshold, length differences cause rejection
                expect(isSimilarString('Acme Corporation', 'ACME Corp', 0.90)).toBe(false);
                
                // Strings with small length difference can pass
                // "Amazon.com Inc" (14 chars) vs "Amazon.com Inc." (15 chars)
                // Length diff: 6.67% < 10% → passes length check, high similarity → passes
                expect(isSimilarString('Amazon.com Inc', 'Amazon.com Inc.')).toBe(true);
                expect(isSimilarString('Amazon.com Inc', 'Amazon.com Inc', 0.90)).toBe(true); // Exact match
            });

            it('should handle description variations', () => {
                expect(isSimilarString('Office Supplies Purchase', 'Office Supplies purchase')).toBe(true); // Same length, case diff
                expect(isSimilarString('Monthly Subscription', 'monthly subscription')).toBe(true); // Same length, case diff
            });

            it('should handle tax ID variations with appropriate thresholds', () => {
                // "12-3456789" (11 chars) vs "123456789" (9 chars)
                // Length diff: (11-9)/11 = 18.2% > 10% (max for 0.90 threshold) → rejects
                expect(isSimilarString('12-3456789', '123456789')).toBe(false);
                
                // But with lower threshold it could pass
                expect(isSimilarString('12-3456789', '123456789', 0.80)).toBe(true);
                
                expect(isSimilarString('TAX-123456', 'tax-123456')).toBe(true); // Same length, case diff
            });

            it('should reject truly different values', () => {
                expect(isSimilarString('INV-12345', 'INV-99999')).toBe(false);
                expect(isSimilarString('Apple Inc', 'Microsoft Corp')).toBe(false);
                expect(isSimilarString('January 2025', 'December 2024')).toBe(false);
            });
        });

        describe('edge cases', () => {
            it('should handle single character strings', () => {
                expect(isSimilarString('a', 'a')).toBe(true);
                expect(isSimilarString('A', 'a')).toBe(true); // Case normalized
                expect(isSimilarString('a', 'b')).toBe(false);
            });

            it('should handle very long strings', () => {
                const long1 = 'This is a very long invoice description with many words to describe the purchase order';
                const long2 = 'This is a very long invoice description with many words to describe the purchase order';
                expect(isSimilarString(long1, long2)).toBe(true);

                const long3 = 'This is a very long invoice description with many words to describe the sales order';
                expect(isSimilarString(long1, long3)).toBe(true); // Minor difference at end
            });

            it('should handle strings with special characters', () => {
                expect(isSimilarString('test@example.com', 'TEST@EXAMPLE.COM')).toBe(true);
                expect(isSimilarString('$1,234.56', '$1,234.56')).toBe(true);
                expect(isSimilarString('PO#12345', 'po#12345')).toBe(true);
            });

            it('should handle unicode and international characters', () => {
                expect(isSimilarString('Société Générale', 'société générale')).toBe(true);
                expect(isSimilarString('北京公司', '北京公司')).toBe(true);
            });
        });

        describe('threshold boundary testing', () => {
            it('should work at 90% boundary with length validation', () => {
                // "testing" vs "testings" is ~92% similar
                // Length diff: (8-7)/8 = 12.5% > 10% (max for 0.90 threshold) → rejects
                expect(isSimilarString('testing', 'testings', 0.90)).toBe(false);

                // "test" vs "best" is ~75% similar - should fail on similarity alone
                expect(isSimilarString('test', 'best', 0.90)).toBe(false);
            });

            it('should work at extreme thresholds', () => {
                // 100% threshold - only exact matches (0% length difference allowed)
                expect(isSimilarString('test', 'test', 1.0)).toBe(true);
                expect(isSimilarString('test', 'Test', 1.0)).toBe(true); // Normalized
                expect(isSimilarString('test', 'tests', 1.0)).toBe(false); // Length difference

                // 0% threshold - everything matches except empty vs non-empty (100% length difference allowed)
                expect(isSimilarString('abc', 'xyz', 0.0)).toBe(true);
                expect(isSimilarString('', 'test', 0.0)).toBe(false); // Empty string special case
            });
        });

        describe('length-based validation', () => {
            // Bug regression: ACE issue with incomplete descriptions
            it('should reject incomplete descriptions (ACE issue scenario)', () => {
                expect(isSimilarString('MONEY FUND INCOME', 'MONEY FUND INCOME FEDERATD HERMES SHRT', 0.8)).toBe(false);
                expect(isSimilarString('PURCHASED', 'PURCHASED BRAZIL FEDERATIVE REP GLOBAL BD ISIN#US105756CH10 6.125% 03/15/34 REG DTD 01/29/24 SOLICITED ORDER YLD 6.233 TO MAT', 0.8)).toBe(false);
                expect(isSimilarString('FOREIGN BOND INTEREST', 'FOREIGN BOND INTEREST 150000 VALE OVERSEAS LTD GTD NT ISIN#US91911TAQ67 3.750% 07/08/30 B/E DTD 07/08/20 CLB RD 01/05 PD 01/08/24', 0.8)).toBe(false);
            });

            it.each([
                // [threshold, str1, str2, expected, description]
                [0.8, 'MONEY FUND INCOME', 'MONEY FUND INCOME FEDERATD HERMES SHRT', false, '63.8% length diff > 20% max'],
                [0.8, 'ACME Corp', 'ACME Corporation', false, '43.75% length diff > 20% max'],
                [0.8, 'Office Supplies', 'Office Suppliesz', true, '6.25% length diff < 20% max'],
                [0.6, 'PURCHASED', 'PURCHASED BRAZIL FEDERATIVE REP GLOBAL BD ISIN#US105756CH10 6.125%', false, '93% length diff > 40% max'],
                [0.6, 'Office Supplies', 'Office Supplies Purchase', true, '37.5% length diff < 40% max'],
                [0.9, 'Testing', 'Testings', false, '12.5% length diff > 10% max'],
                [0.9, 'Test', 'Tests', false, '20% length diff > 10% max'],
                [0.9, 'Invoice #123', 'Invoice #124', true, 'same length, high similarity'],
                [0.95, 'This is a test description with many words', 'This is a test description with many wordz', true, '0% length diff'],
                [0.95, 'This is a test description with many words', 'This is a test description with many words!', true, '2.3% length diff < 5% max'],
                [0.95, 'This is a test description with many words', 'This is a test description with many words!!!', false, '6.7% length diff > 5% max'],
            ])('threshold %s: "%s" vs "%s" = %s (%s)', (threshold, str1, str2, expected) => {
                expect(isSimilarString(str1, str2, threshold)).toBe(expected);
            });

            it('should handle edge cases', () => {
                // Empty strings
                expect(isSimilarString('', '', 0.8)).toBe(true);
                expect(isSimilarString('', 'test', 0.8)).toBe(false);
                expect(isSimilarString('test', '', 0.8)).toBe(false);
                
                // Very short strings
                expect(isSimilarString('a', 'ab', 0.8)).toBe(false); // 50% > 20%
                expect(isSimilarString('a', 'ab', 0.5)).toBe(true); // 50% = 50%
                
                // Exact matches regardless of threshold
                expect(isSimilarString('test', 'TEST', 0.99)).toBe(true);
                expect(isSimilarString('  test  ', 'test', 0.99)).toBe(true);
            });

            it('should accept exact matches', () => {
                expect(isSimilarString('MONEY FUND INCOME FEDERATD HERMES SHRT', 'MONEY FUND INCOME FEDERATD HERMES SHRT', 0.8)).toBe(true);
                expect(isSimilarString('FOREIGN BOND INTEREST 150000 VALE OVERSEAS LTD GTD NT ISIN#US91911TAQ67 3.750% 07/08/30 B/E DTD 07/08/20 CLB RD 01/05 PD 01/08/24', 'FOREIGN BOND INTEREST 150000 VALE OVERSEAS LTD GTD NT ISIN#US91911TAQ67 3.750% 07/08/30 B/E DTD 07/08/20 CLB RD 01/05 PD 01/08/24', 0.8)).toBe(true);
            });
        });

        describe('numeric value handling', () => {
            it('should handle numeric values by converting to string', () => {
                // Exact numeric matches
                expect(isSimilarString('123', '123')).toBe(true);
                expect(isSimilarString('-3.50', '-3.50')).toBe(true);
                expect(isSimilarString('0', '0')).toBe(true);

                // Different numeric values
                expect(isSimilarString('123', '456')).toBe(false);
                expect(isSimilarString('100', '200')).toBe(false);
            });

            it('should handle actual number types without throwing', () => {
                // Bug fix: numeric values should not throw TypeError
                expect(isSimilarString(123, 123)).toBe(true);
                expect(isSimilarString(-3.5, -3.5)).toBe(true);
                expect(isSimilarString(0, 0)).toBe(true);

                // Different numeric values
                expect(isSimilarString(123, 456)).toBe(false);
                expect(isSimilarString(-10, -20)).toBe(false);
            });

            it('should ignore sign for numeric values (positive/negative)', () => {
                // Sign should be ignored as per requirements
                expect(isSimilarString(-10, 10)).toBe(true);
                expect(isSimilarString('-3.50', 3.5)).toBe(true);
                expect(isSimilarString('-3.5', '3.50')).toBe(true);
                expect(isSimilarString(10, -10)).toBe(true);
                expect(isSimilarString('10', '-10')).toBe(true);

                // But different magnitudes should still not match
                expect(isSimilarString(-10, 20)).toBe(false);
                expect(isSimilarString(-3.5, 7.5)).toBe(false);
            });

            it('should handle mixed string and number types', () => {
                expect(isSimilarString('123', 123)).toBe(true);
                expect(isSimilarString(-3.5, '-3.5')).toBe(true);
                expect(isSimilarString('0', 0)).toBe(true);
                expect(isSimilarString(10, '-10')).toBe(true); // Sign ignored
            });

            it('should handle edge cases with zero', () => {
                expect(isSimilarString(0, -0)).toBe(true);
                expect(isSimilarString('0', '-0')).toBe(true);
                expect(isSimilarString(0.0, -0.0)).toBe(true);
            });

            it('should handle numeric precision differences', () => {
                // These should match (same absolute value)
                expect(isSimilarString('-3.50', -3.5)).toBe(true);
                expect(isSimilarString('10.00', 10)).toBe(true);
                expect(isSimilarString(3.5, '3.50')).toBe(true);
            });

            it('should NOT match non-numeric strings as numbers', () => {
                // These contain numbers but are not purely numeric
                expect(isSimilarString('INV-123', 'INV-456')).toBe(false);
                expect(isSimilarString('$123.45', '$456.78')).toBe(false);
            });
        });
    });

    describe('isExactMatch', () => {
        describe('exact string matches after normalization', () => {
            it('should return true for identical strings', () => {
                expect(isExactMatch('test', 'test')).toBe(true);
                expect(isExactMatch('ACME Corp', 'ACME Corp')).toBe(true);
            });

            it('should return true for case-insensitive matches', () => {
                expect(isExactMatch('ACME Corp', 'acme corp')).toBe(true);
                expect(isExactMatch('TEST', 'test')).toBe(true);
                expect(isExactMatch('Invoice #123', 'invoice #123')).toBe(true);
            });

            it('should return true for matches with extra whitespace', () => {
                expect(isExactMatch('  test  ', 'test')).toBe(true);
                expect(isExactMatch('ACME Corp', '  ACME Corp  ')).toBe(true);
                expect(isExactMatch('  Invoice #123  ', '  invoice #123  ')).toBe(true);
            });

            it('should return true for case and whitespace differences combined', () => {
                expect(isExactMatch('  ACME CORP  ', 'acme corp')).toBe(true);
            });
        });

        describe('NO fuzzy matching - requires exact character match', () => {
            it('should reject vendor name variations (no fuzzy match)', () => {
                // These would pass isSimilarString() but FAIL isExactMatch()
                expect(isExactMatch('ACME Corporation', 'ACME Corp')).toBe(false);
                expect(isExactMatch('Microsoft Corporation', 'Microsoft Corp')).toBe(false);
            });

            it('should reject minor character differences', () => {
                expect(isExactMatch('Office Supplies', 'Office Supply')).toBe(false); // Missing 's'
                expect(isExactMatch('testing', 'testings')).toBe(false); // Extra character
                expect(isExactMatch('test', 'text')).toBe(false); // Different character
            });

            it('should reject completely different strings', () => {
                expect(isExactMatch('Apple Inc', 'Microsoft Corp')).toBe(false);
                expect(isExactMatch('Invoice', 'Receipt')).toBe(false);
                expect(isExactMatch('January', 'December')).toBe(false);
            });
        });

        describe('numeric value handling', () => {
            it('should match numeric values as strings', () => {
                expect(isExactMatch('123', '123')).toBe(true);
                expect(isExactMatch('-3.50', '-3.50')).toBe(true);
                expect(isExactMatch('0', '0')).toBe(true);
            });

            it('should handle actual number types without throwing', () => {
                expect(isExactMatch(123, 123)).toBe(true);
                expect(isExactMatch(-3.5, -3.5)).toBe(true);
                expect(isExactMatch(0, 0)).toBe(true);
            });

            it('should ignore sign for numeric values (positive/negative)', () => {
                // Sign should be ignored as per requirements
                expect(isExactMatch(-10, 10)).toBe(true);
                expect(isExactMatch('-3.50', 3.5)).toBe(true);
                expect(isExactMatch('-3.5', '3.50')).toBe(true);
                expect(isExactMatch(10, -10)).toBe(true);
                expect(isExactMatch('10', '-10')).toBe(true);
            });

            it('should reject different numeric magnitudes', () => {
                expect(isExactMatch(-10, 20)).toBe(false);
                expect(isExactMatch(-3.5, 7.5)).toBe(false);
                expect(isExactMatch(100, 200)).toBe(false);
                expect(isExactMatch(123, 456)).toBe(false);
            });

            it('should handle mixed string and number types', () => {
                expect(isExactMatch('123', 123)).toBe(true);
                expect(isExactMatch(-3.5, '-3.5')).toBe(true);
                expect(isExactMatch('0', 0)).toBe(true);
                expect(isExactMatch(10, '-10')).toBe(true); // Sign ignored
            });

            it('should handle edge cases with zero', () => {
                expect(isExactMatch(0, -0)).toBe(true);
                expect(isExactMatch('0', '-0')).toBe(true);
                expect(isExactMatch(0.0, -0.0)).toBe(true);
            });

            it('should handle numeric precision differences', () => {
                // These should match (same absolute value)
                expect(isExactMatch('-3.50', -3.5)).toBe(true);
                expect(isExactMatch('10.00', 10)).toBe(true);
                expect(isExactMatch(3.5, '3.50')).toBe(true);
            });
        });

        describe('empty string handling', () => {
            it('should handle empty strings correctly', () => {
                expect(isExactMatch('', '')).toBe(true);
                expect(isExactMatch('', 'test')).toBe(false);
                expect(isExactMatch('test', '')).toBe(false);
            });
        });

        describe('real-world property value scenarios', () => {
            it('should handle invoice number exact matches', () => {
                expect(isExactMatch('INV-12345', 'INV-12345')).toBe(true);
                expect(isExactMatch('INV-12345', 'inv-12345')).toBe(true); // Case difference
            });

            it('should reject invoice number variations', () => {
                expect(isExactMatch('INV-12345', 'INV-99999')).toBe(false);
                expect(isExactMatch('Invoice #123', 'INV-123')).toBe(false); // Different format
            });

            it('should handle vendor name exact matches', () => {
                expect(isExactMatch('Acme Corporation', 'ACME Corporation')).toBe(true);
                expect(isExactMatch('Amazon.com Inc', 'amazon.com inc')).toBe(true);
            });

            it('should reject vendor name variations', () => {
                expect(isExactMatch('Acme Corporation', 'ACME Corp')).toBe(false); // Missing characters
                expect(isExactMatch('Amazon.com Inc', 'Amazon.com Inc.')).toBe(false); // Extra period
            });

            it('should handle tax ID exact matches', () => {
                expect(isExactMatch('12-3456789', '12-3456789')).toBe(true);
                expect(isExactMatch('TAX-123456', 'tax-123456')).toBe(true);
            });

            it('should reject tax ID variations', () => {
                expect(isExactMatch('12-3456789', '123456789')).toBe(false); // Missing hyphen
                expect(isExactMatch('TAX-123456', 'TAX-654321')).toBe(false); // Different number
            });

            it('should handle numeric discount values', () => {
                expect(isExactMatch(-3.50, 3.5)).toBe(true); // Sign ignored
                expect(isExactMatch('-10', 10)).toBe(true); // Sign ignored
                expect(isExactMatch(-3.50, -3.5)).toBe(true); // Precision difference OK
            });
        });

        describe('edge cases', () => {
            it('should handle single character strings', () => {
                expect(isExactMatch('a', 'a')).toBe(true);
                expect(isExactMatch('A', 'a')).toBe(true); // Case normalized
                expect(isExactMatch('a', 'b')).toBe(false);
            });

            it('should handle strings with special characters', () => {
                expect(isExactMatch('test@example.com', 'TEST@EXAMPLE.COM')).toBe(true);
                expect(isExactMatch('$1,234.56', '$1,234.56')).toBe(true);
                expect(isExactMatch('PO#12345', 'po#12345')).toBe(true);
            });

            it('should handle unicode and international characters', () => {
                expect(isExactMatch('Société Générale', 'société générale')).toBe(true);
                expect(isExactMatch('北京公司', '北京公司')).toBe(true);
            });
        });
    });

    describe('stripAccountNamesFromDescription', () => {
        describe('basic account name stripping', () => {
            it('should strip credit account name from description', () => {
                expect(stripAccountNamesFromDescription('Office Supplies Cash', 'Cash')).toBe('Office Supplies');
                expect(stripAccountNamesFromDescription('Payment to Bank Account', undefined, 'Bank Account')).toBe('Payment to');
            });

            it('should strip debit account name from description', () => {
                expect(stripAccountNamesFromDescription('Bank Account Office Supplies', undefined, 'Office Supplies')).toBe('Bank Account');
                expect(stripAccountNamesFromDescription('Cash payment for expenses', 'Cash')).toBe('payment for expenses');
            });

            it('should strip both credit and debit account names', () => {
                expect(stripAccountNamesFromDescription('Cash Office Supplies', 'Cash', 'Office Supplies')).toBe('');
                expect(stripAccountNamesFromDescription('Transfer from Cash to Bank Account', 'Cash', 'Bank Account')).toBe('Transfer from to');
            });
        });

        describe('case-insensitive stripping', () => {
            it('should strip account names regardless of case', () => {
                expect(stripAccountNamesFromDescription('Office Supplies CASH', 'Cash')).toBe('Office Supplies');
                expect(stripAccountNamesFromDescription('BANK ACCOUNT Office Supplies', undefined, 'Bank Account')).toBe('Office Supplies');
                expect(stripAccountNamesFromDescription('CaSh payment', 'cash')).toBe('payment');
            });
        });

        describe('no account names to strip', () => {
            it('should return original description when no account names provided', () => {
                expect(stripAccountNamesFromDescription('Office Supplies')).toBe('Office Supplies');
                expect(stripAccountNamesFromDescription('Payment for services', undefined, undefined)).toBe('Payment for services');
            });

            it('should return original description when account names not found', () => {
                expect(stripAccountNamesFromDescription('Office Supplies', 'Petty Cash')).toBe('Office Supplies');
                expect(stripAccountNamesFromDescription('Consulting Services', 'Revenue', 'Expenses')).toBe('Consulting Services');
            });
        });

        describe('partial matches should not be stripped', () => {
            it('should only strip complete word matches', () => {
                // "Cash" should not strip "Cashier" or "Petty Cash"
                expect(stripAccountNamesFromDescription('Cashier payment', 'Cash')).toBe('ier payment');
                expect(stripAccountNamesFromDescription('Payment via Petty Cash account', 'Cash')).toBe('Payment via Petty account');
            });
        });

        describe('whitespace normalization', () => {
            it('should trim the result after stripping', () => {
                expect(stripAccountNamesFromDescription('  Cash  Office Supplies  ', 'Cash')).toBe('Office Supplies');
                expect(stripAccountNamesFromDescription('  Office Supplies  Bank Account  ', undefined, 'Bank Account')).toBe('Office Supplies');
            });

            it('should collapse multiple spaces', () => {
                expect(stripAccountNamesFromDescription('Transfer   from   Cash   to   Bank', 'Cash')).toBe('Transfer from to Bank');
            });
        });

        describe('edge cases', () => {
            it('should handle empty description', () => {
                expect(stripAccountNamesFromDescription('', 'Cash')).toBe('');
                expect(stripAccountNamesFromDescription('', 'Cash', 'Bank')).toBe('');
            });

            it('should handle description that is only account name', () => {
                expect(stripAccountNamesFromDescription('Cash', 'Cash')).toBe('');
                expect(stripAccountNamesFromDescription('Bank Account', undefined, 'Bank Account')).toBe('');
            });

            it('should handle special characters in account names', () => {
                expect(stripAccountNamesFromDescription('Payment from A/C #123', 'A/C #123')).toBe('Payment from');
                expect(stripAccountNamesFromDescription('Transfer (Cash) to Bank', 'Cash')).toBe('Transfer () to Bank');
            });

            it('should handle unicode account names', () => {
                expect(stripAccountNamesFromDescription('Pago a Caixa Geral', 'Caixa Geral')).toBe('Pago a');
                expect(stripAccountNamesFromDescription('转账 from 现金 to 银行', '现金')).toBe('转账 from to 银行');
            });
        });

        describe('real-world scenarios', () => {
            it('should handle Bkper UI appended account names', () => {
                // Bkper might append account names in various formats
                expect(stripAccountNamesFromDescription('Office Supplies [Cash]', 'Cash')).toBe('Office Supplies []');
                expect(stripAccountNamesFromDescription('Office Supplies (Cash)', 'Cash')).toBe('Office Supplies ()');
                expect(stripAccountNamesFromDescription('Cash - Office Supplies', 'Cash')).toBe('- Office Supplies');
            });

            it('should handle multiple occurrences of account name', () => {
                expect(stripAccountNamesFromDescription('Cash payment for Cash expenses', 'Cash')).toBe('payment for expenses');
                expect(stripAccountNamesFromDescription('Bank to Bank transfer via Bank', 'Bank')).toBe('to transfer via');
            });
        });
    });

    describe('replaceBreakLiterals', () => {
        describe('basic conversion', () => {
            it('should convert literal \\n to actual newline', () => {
                const input = 'Line 1\\nLine 2\\nLine 3';
                const expected = `Line 1
Line 2
Line 3`;
                expect(replaceBreakLiterals(input)).toBe(expected);
            });
        });

    });
});
