import { describe, it, expect } from 'bun:test';
import { stripAccountNamesFromDescription, replaceBreakLiterals } from '../src/utils.js';

describe('Description utilities', () => {
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
