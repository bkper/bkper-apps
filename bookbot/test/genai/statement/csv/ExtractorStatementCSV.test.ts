/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';
import { ExtractorStatementCSV } from '../../../../src/genai/statement/csv/ExtractorStatementCSV.js';
import { File } from 'bkper-js';
import { ExtractedStatement } from '../../../../src/genai/statement/ExtractedStatement.js';

describe('ExtractorStatementCSV', () => {
    let mockFile: File;
    let mockEnv: Env;
    let extractor: ExtractorStatementCSV;

    beforeEach(() => {
        mockEnv = {} as Env;
    });

    /**
     * Helper to create mock CSV file with base64 content
     */
    function createMockCSVFile(csvContent: string, contentType: string = 'text/csv'): File {
        const base64Content = btoa(csvContent);
        return {
            getId: () => 'csv123',
            getContentType: () => contentType,
            getContent: mock(async () => base64Content),
            json: () => ({ id: 'csv123' }),
        } as unknown as File;
    }

    describe('detectDelimiter', () => {
        it.each([
            ['date,description,amount\n2025-01-10,Test,100', ',', 'comma'],
            ['date;description;amount\n2025-01-10;Test;100', ';', 'semicolon'],
            ['date\tdescription\tamount\n2025-01-10\tTest\t100', '\t', 'tab'],
            ['no delimiters here', ',', 'default to comma'],
        ])('should detect %s delimiter: "%s"', (csvContent, expectedDelimiter) => {
            mockFile = createMockCSVFile(csvContent);
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);
            expect(extractor.detectDelimiter(csvContent)).toBe(expectedDelimiter);
        });
    });

    describe('detectEncoding', () => {
        it('should detect UTF-8 encoding', () => {
            const utf8Content = 'date,description,amount\n2025-01-10,Test,100';
            mockFile = createMockCSVFile(utf8Content);
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const encoding = extractor.detectEncoding(new TextEncoder().encode(utf8Content));

            expect(encoding).toBe('utf-8');
        });

        it('should detect Latin-1 encoding for extended characters', () => {
            // Latin-1 specific bytes (0xE9 = é, 0xE7 = ç)
            const latin1Bytes = new Uint8Array([0x64, 0x61, 0x74, 0x65, 0x2c, 0xe9, 0xe7]);
            mockFile = createMockCSVFile('');
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const encoding = extractor.detectEncoding(latin1Bytes);

            expect(encoding).toBe('latin1');
        });
    });

    describe('hasHeaderRow', () => {
        it('should detect header row with text columns', () => {
            mockFile = createMockCSVFile('date,description,amount\n2025-01-10,Test,100');
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const hasHeader = extractor.hasHeaderRow('date,description,amount\n2025-01-10,Test,100', ',');

            expect(hasHeader).toBe(true);
        });

        it('should detect no header when first row is data', () => {
            mockFile = createMockCSVFile('2025-01-10,100,Test\n2025-01-11,200,Test2');
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const hasHeader = extractor.hasHeaderRow('2025-01-10,100,Test\n2025-01-11,200,Test2', ',');

            expect(hasHeader).toBe(false);
        });
    });

    describe('convertCSVToText', () => {
        it('should convert base64 CSV to text with encoding and delimiter detection', async () => {
            const csvContent = 'date,description,amount\n2025-01-10,Salary,1000\n2025-01-15,Groceries,-50';
            mockFile = createMockCSVFile(csvContent);
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const text = await extractor.convertCSVToText();

            expect(text).toContain('date,description,amount');
            expect(text).toContain('2025-01-10,Salary,1000');
            expect(text).toContain('Delimiter: ,');
            expect(text).toContain('Has Headers: true');
        });

        it('should handle semicolon delimiter', async () => {
            const csvContent = 'date;description;amount\n2025-01-10;Test;100';
            mockFile = createMockCSVFile(csvContent);
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const text = await extractor.convertCSVToText();

            expect(text).toContain('Delimiter: ;');
        });
    });

    describe('extract', () => {
        it('should extract transactions from CSV using AI', async () => {
            const csvContent = 'date,description,amount\n2025-01-10,Salary,1000\n2025-01-15,Groceries,-50';
            mockFile = createMockCSVFile(csvContent);
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            // Mock the query method to return expected result
            const mockResult: ExtractedStatement = {
                transactions: [
                    { date: '2025-01-10', description: 'Salary', amount: 1000, properties: {} },
                    { date: '2025-01-15', description: 'Groceries', amount: -50, properties: {} },
                ],
            };
            spyOn(extractor as any, 'query').mockResolvedValue(mockResult);

            const result = await extractor.extract(undefined);

            expect(result?.transactions).toHaveLength(2);
            expect(result?.transactions[0].date).toBe('2025-01-10');
            expect(result?.transactions[1].amount).toBe(-50);
        });

        it('should handle custom prompt', async () => {
            const csvContent = 'date,description,amount\n2025-01-10,Test,100';
            mockFile = createMockCSVFile(csvContent);
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const mockResult: ExtractedStatement = {
                transactions: [{ date: '2025-01-10', description: 'Test', amount: 100, properties: {} }],
            };
            const querySpy = spyOn(extractor as any, 'query').mockResolvedValue(mockResult);

            const customPrompt = '- Map column A to date\n- Map column B to description';
            await extractor.extract(customPrompt);

            // Verify query was called with prompt including custom prompt, without coupling this test to logging flags.
            const [contents] = querySpy.mock.calls[0]!;
            expect(contents).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining(customPrompt) })]));
        });

        it('should extract properties from additional CSV columns', async () => {
            const csvContent = 'date,description,amount,category,reference\n2025-01-10,Test,100,Food,REF123';
            mockFile = createMockCSVFile(csvContent);
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const mockResult: ExtractedStatement = {
                transactions: [
                    {
                        date: '2025-01-10',
                        description: 'Test',
                        amount: 100,
                        properties: { category: 'Food', reference: 'REF123' },
                    },
                ],
            };
            spyOn(extractor as any, 'query').mockResolvedValue(mockResult);

            const result = await extractor.extract(undefined);

            expect(result?.transactions[0].properties).toEqual({ category: 'Food', reference: 'REF123' });
        });
    });

    describe('getSystemPrompt', () => {
        it('should return CSV-specific system prompt', () => {
            mockFile = createMockCSVFile('');
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const prompt = extractor.getSystemPrompt();

            expect(prompt).toContain('CSV');
            expect(prompt).toContain('column');
        });
    });

    describe('getDefaultUserPrompt', () => {
        it('should return CSV-specific default prompt', () => {
            mockFile = createMockCSVFile('');
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const prompt = extractor.getDefaultUserPrompt();

            expect(prompt).toContain('date');
            expect(prompt).toContain('description');
            expect(prompt).toContain('amount');
        });

        it('should instruct the model to preserve the source amount sign', () => {
            mockFile = createMockCSVFile('');
            extractor = new ExtractorStatementCSV(mockFile, mockEnv);

            const prompt = extractor.getDefaultUserPrompt();

            expect(prompt).toMatch(/preserve the amount sign/i);
            expect(prompt).toMatch(/do not flip/i);
        });
    });
});
