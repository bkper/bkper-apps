import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { File } from 'bkper-js';
import { ExtractorAmount } from '../../src/genai/ExtractorAmount.js';
import { ExtractorDate } from '../../src/genai/ExtractorDate.js';
import { ExtractorDescriptionParts } from '../../src/genai/ExtractorDescriptionParts.js';
import { ExtractorFileClassification } from '../../src/genai/file/ExtractorFileClassification.js';
import { ExtractorStatementCSV } from '../../src/genai/statement/csv/ExtractorStatementCSV.js';
import { ExtractorStatementIMG } from '../../src/genai/statement/img/ExtractorStatementIMG.js';
import { ExtractorInvoice } from '../../src/genai/invoice/ExtractorInvoice.js';
import { ReflectorStatementIMG } from '../../src/genai/statement/img/ReflectorStatementIMG.js';
import { CuratorStatementIMG } from '../../src/genai/statement/img/CuratorStatementIMG.js';
import { JevEvaluationService } from '../../src/genai/JevEvaluationService.js';
import { ReflectorStatementCSV } from '../../src/genai/statement/csv/ReflectorStatementCSV.js';
import { CuratorStatementCSV } from '../../src/genai/statement/csv/CuratorStatementCSV.js';
import { ReflectionResult } from '../../src/genai/ace/ReflectionResult.js';
import { BkperAIEvaluationsClient } from '../../src/genai/BkperAIEvaluationsClient.js';
import { BkperAIResponsesClient } from '../../src/genai/BkperAIResponsesClient.js';

/**
 * Integration tests for GenAI extraction services.
 *
 * These tests make real API calls through Bkper AI
 * with synthetic data to validate that:
 * - Prompts produce correct structured output
 * - Schema validation works end-to-end
 * - Models handle real-world input patterns
 * - The ACE pipeline (reflector + curator) generates useful output
 *
 * No Bkper API calls are made — only GenAI services with mock File objects
 * and plain text inputs.
 *
 * Run manually:   bun run test:integration
 * CI:             Runs on weekly schedule + manual trigger
 *
 * Requires BKPER_AI_BASE_URL and BKPER_AI_OAUTH_TOKEN in the environment.
 * Skips gracefully when Bkper AI credentials are not set.
 */

const BKPER_AI_BASE_URL = process.env.BKPER_AI_BASE_URL;
const BKPER_AI_OAUTH_TOKEN = process.env.BKPER_AI_OAUTH_TOKEN;

const env = { BKPER_AI_BASE_URL } as unknown as Env;

// Attribute live test usage to a test source instead of the production `bookbot` source.
const testSourceFetch: typeof fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('bkper-ai-source', 'bkper-agent-test');
    return fetch(input, { ...init, headers });
}, { preconnect: fetch.preconnect });

const bkperAIClient = BKPER_AI_BASE_URL && BKPER_AI_OAUTH_TOKEN
    ? new BkperAIResponsesClient({
        baseUrl: BKPER_AI_BASE_URL,
        oauthToken: BKPER_AI_OAUTH_TOKEN,
        fetch: testSourceFetch,
    })
    : undefined;

const bkperAIEvaluationsClient = BKPER_AI_BASE_URL && BKPER_AI_OAUTH_TOKEN
    ? new BkperAIEvaluationsClient({
        baseUrl: BKPER_AI_BASE_URL,
        oauthToken: BKPER_AI_OAUTH_TOKEN,
        fetch: testSourceFetch,
    })
    : undefined;

// --- Helpers ---

function createMockCSVFile(csvContent: string): File {
    const base64Content = btoa(csvContent);
    return {
        getId: () => 'test-csv-file',
        getName: () => 'test-statement.csv',
        getContentType: () => 'text/csv',
        getContent: async () => base64Content,
        json: () => ({ id: 'test-csv-file' }),
    } as unknown as File;
}

const FIXTURES_DIR = join(import.meta.dir, 'fixtures');

function createMockFileFromFixture(filename: string, contentType: string): File {
    const filePath = join(FIXTURES_DIR, filename);
    const buffer = readFileSync(filePath);
    const base64Content = buffer.toString('base64');
    return {
        getId: () => `test-${filename}`,
        getName: () => filename,
        getContentType: () => contentType,
        getContent: async () => base64Content,
        json: () => ({ id: `test-${filename}` }),
    } as unknown as File;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// --- Test Data ---

const SIMPLE_CSV = `date,description,amount
2025-01-10,Grocery Store Purchase,-45.99
2025-01-12,Salary Deposit,3500.00
2025-01-15,Electric Bill Payment,-120.50
2025-01-18,Online Transfer from Savings,500.00
2025-01-20,Restaurant Dinner,-67.30`;

const SEMICOLON_CSV = `datum;beschreibung;betrag
2025-02-01;Miete Überweisung;-850,00
2025-02-03;Gehalt Eingang;2800,00
2025-02-05;Supermarkt Einkauf;-35,50
2025-02-10;Versicherung Lastschrift;-125,00`;

// --- Tests ---

describe('GenAI Extraction (Integration)', () => {
    // ========================================
    // Group 1: Field Extractors
    // ========================================

    describe.skipIf(!bkperAIClient)('ExtractorAmount through Bkper AI', () => {
        it(
            'extracts a clear monetary amount',
            async () => {
                const extractor = new ExtractorAmount(env, bkperAIClient);
                const result = await extractor.extract('Payment of $150.50 to vendor');

                expect(result).not.toBeNull();
                expect(result!.toNumber()).toBeCloseTo(150.5, 1);
            },
            { timeout: 30_000 }
        );

        it(
            'returns null when no amount is present',
            async () => {
                const extractor = new ExtractorAmount(env, bkperAIClient);
                const result = await extractor.extract('ABSCHLUSS PER 31.08.2025');

                expect(result).toBeNull();
            },
            { timeout: 30_000 }
        );

        it(
            'picks the main amount when multiple values are present',
            async () => {
                const extractor = new ExtractorAmount(env, bkperAIClient);
                const result = await extractor.extract('Transfer €1,234.56 processing fee €5');

                expect(result).not.toBeNull();
                expect(result!.toNumber()).toBeCloseTo(1234.56, 1);
            },
            { timeout: 30_000 }
        );
    });

    describe.skipIf(!bkperAIClient)('ExtractorDate through Bkper AI', () => {
        it(
            'extracts a date in European format',
            async () => {
                const extractor = new ExtractorDate(env, bkperAIClient);
                const result = await extractor.extract('ABSCHLUSS PER 31.08.2025');

                expect(result).toBeDefined();
                expect(result).toBe('2025-08-31');
            },
            { timeout: 30_000 }
        );

        it(
            'returns null/undefined when no date is present',
            async () => {
                const extractor = new ExtractorDate(env, bkperAIClient);
                const result = await extractor.extract('Monthly subscription payment');

                // Model may return null or undefined — both are acceptable
                expect(result == null).toBe(true);
            },
            { timeout: 30_000 }
        );
    });

    describe.skipIf(!bkperAIClient)('ExtractorDescriptionParts through Bkper AI', () => {
        it(
            'extracts stable searchable parts from a transaction description',
            async () => {
                const extractor = new ExtractorDescriptionParts(env, bkperAIClient);
                const result = await extractor.extract('Amazon AMAZON RETA* NJ1JM7QA0 #goodies');

                expect(result).toBeArray();
                expect(result.length).toBeGreaterThan(0);

                // Should contain something referencing AMAZON — the stable merchant identifier
                const joined = result.join(' ').toUpperCase();
                expect(joined).toContain('AMAZON');
            },
            { timeout: 30_000 }
        );
    });

    // ========================================
    // Group 2: CSV Statement Extraction
    // ========================================

    describe.skipIf(!bkperAIClient)('ExtractorStatementCSV through Bkper AI', () => {
        it(
            'extracts transactions from a comma-delimited bank statement CSV',
            async () => {
                const mockFile = createMockCSVFile(SIMPLE_CSV);
                const extractor = new ExtractorStatementCSV(mockFile, env, bkperAIClient);
                const result = await extractor.extract(undefined);

                expect(result).toBeDefined();
                expect(result!.transactions).toBeArray();
                expect(result!.transactions.length).toBe(5);

                for (const tx of result!.transactions) {
                    expect(tx.date).toMatch(DATE_PATTERN);
                    expect(typeof tx.description).toBe('string');
                    expect(tx.description.length).toBeGreaterThan(0);
                    expect(typeof tx.amount).toBe('number');
                }

                // Verify the model parsed actual values correctly
                const salaryTx = result!.transactions.find(tx =>
                    tx.description.toLowerCase().includes('salary')
                );
                expect(salaryTx).toBeDefined();
                expect(salaryTx!.amount).toBeCloseTo(3500, 0);
                expect(salaryTx!.date).toBe('2025-01-12');
            },
            { timeout: 120_000 }
        );

        it(
            'extracts transactions from a semicolon-delimited CSV',
            async () => {
                const mockFile = createMockCSVFile(SEMICOLON_CSV);
                const extractor = new ExtractorStatementCSV(mockFile, env, bkperAIClient);
                const result = await extractor.extract(undefined);

                expect(result).toBeDefined();
                expect(result!.transactions).toBeArray();
                expect(result!.transactions.length).toBe(4);

                for (const tx of result!.transactions) {
                    expect(tx.date).toMatch(DATE_PATTERN);
                    expect(typeof tx.description).toBe('string');
                    expect(typeof tx.amount).toBe('number');
                }

                // Verify the model handled European amount format (comma decimal)
                const rentTx = result!.transactions.find(tx =>
                    tx.description.toLowerCase().includes('miete')
                );
                expect(rentTx).toBeDefined();
                expect(rentTx!.amount).toBeCloseTo(-850, 0);
            },
            { timeout: 120_000 }
        );
    });

    // ========================================
    // Group 3: Jev Semantic Evaluation
    // ========================================

    describe.skipIf(!bkperAIEvaluationsClient)('Jev semantic evaluation through Bkper AI', () => {
        it(
            'distinguishes equivalent from materially different invoice descriptions',
            async () => {
                const service = new JevEvaluationService(bkperAIEvaluationsClient!);
                const equivalent = await service.areInvoiceDescriptionsEquivalent([
                    {
                        first: 'Cloud hosting services for March 2026',
                        second: 'March 2026 cloud-hosting service',
                    },
                    {
                        first: 'Cloud hosting services for March 2026',
                        second: 'Ergonomic office chair purchase',
                    },
                ]);

                expect(equivalent).toEqual([true, false]);
            },
            { timeout: 30_000 }
        );

        it(
            'detects redundant guidance without dropping distinct guidance',
            async () => {
                const service = new JevEvaluationService(bkperAIEvaluationsClient!);
                const redundant = await service.areAceBulletsRedundant(
                    ['Extract the transaction date from the first CSV column.'],
                    [
                        'Extract the transaction date from the first CSV column.',
                        'Skip rows whose description contains TOTAL.',
                    ]
                );

                expect(redundant).toEqual([true, false]);
            },
            { timeout: 30_000 }
        );
    });

    // ========================================
    // Group 4: ACE Pipeline (Reflector + Curator)
    // ========================================

    describe.skipIf(!bkperAIClient)('ACE Pipeline through Bkper AI', () => {
        // Synthetic data: AI extracted with wrong amounts, user corrected them
        const aiExtracted = [
            { date: '2025-03-01', description: 'Office Supplies', amount: 45.0, properties: {} },
            { date: '2025-03-05', description: 'Client Payment', amount: 1200.0, properties: {} },
            { date: '2025-03-10', description: 'Electricity Bill', amount: -89.0, properties: {} },
        ];

        const userCorrected = [
            { date: '2025-03-01', description: 'Office Supplies', amount: -45.0, properties: {} },
            {
                date: '2025-03-05',
                description: 'Client Payment Received',
                amount: 1200.0,
                properties: {},
            },
            { date: '2025-03-10', description: 'Electricity Bill', amount: -89.5, properties: {} },
            { date: '2025-03-12', description: 'Software License', amount: -299.0, properties: {} },
        ];

        const userRemoved = [
            { date: '2025-03-15', description: 'TOTAL BALANCE', amount: 0, properties: {} },
        ];

        // CSV that the reflector/curator will receive as file context
        const REFLECTION_CSV = `date,description,debit,credit
2025-03-01,Office Supplies,45.00,
2025-03-05,Client Payment Received,,1200.00
2025-03-10,Electricity Bill,89.50,
2025-03-12,Software License,299.00,
2025-03-15,TOTAL BALANCE,,`;

        it(
            'ReflectorStatementCSV identifies extraction failures',
            async () => {
                const mockFile = createMockCSVFile(REFLECTION_CSV);
                const reflector = new ReflectorStatementCSV(mockFile, env, bkperAIClient);
                const result = await reflector.reflect(aiExtracted, userCorrected, userRemoved);

                expect(result).toBeDefined();

                // Should identify failures (wrong sign on amounts, missing transaction, false positive)
                expect(result!.whatFailed).toBeArray();
                expect(result!.whatFailed.length).toBeGreaterThan(0);

                // Should also identify what worked (dates, some descriptions)
                expect(result!.whatWorked).toBeArray();

                // Should have suggestions
                expect(typeof result!.suggestedImprovements).toBe('string');
                expect(result!.suggestedImprovements.length).toBeGreaterThan(0);
            },
            { timeout: 120_000 }
        );

        it(
            'CuratorStatementCSV generates actionable bullets from reflection',
            async () => {
                // Use a concrete reflection result (simulating what the reflector would produce)
                const reflection: ReflectionResult = {
                    whatWorked: [
                        'Date extraction from column 1 is accurate',
                        'Description extraction from column 2 captures the merchant name',
                    ],
                    whatFailed: [
                        'Amount sign is wrong: debit amounts should be negative but are extracted as positive',
                        'Missing transaction: Software License on 2025-03-12 was not extracted',
                        'False positive: TOTAL BALANCE row was incorrectly extracted as a transaction',
                    ],
                    suggestedImprovements:
                        'Use separate debit/credit columns. Debit values should be negative. Exclude rows containing "TOTAL" or "BALANCE" keywords.',
                };

                const mockFile = createMockCSVFile(REFLECTION_CSV);
                const curator = new CuratorStatementCSV(reflection, env, bkperAIClient);
                const bullets = await curator.extractNewBullets();

                expect(bullets).toBeDefined();
                expect(bullets).toBeArray();
                expect(bullets!.length).toBeGreaterThan(0);

                // Each bullet should be a non-empty string
                for (const bullet of bullets!) {
                    expect(typeof bullet).toBe('string');
                    expect(bullet.length).toBeGreaterThan(0);
                }
            },
            { timeout: 120_000 }
        );
    });

    // ========================================
    // Group 5: Invoice/Receipt Image Extraction
    // ========================================

    describe('Invoice/Receipt Extraction (Image/PDF)', () => {
        it.skipIf(!bkperAIClient)(
            'classifies a PNG invoice as a single transaction through Bkper AI',
            async () => {
                const mockFile = createMockFileFromFixture('invoice.png', 'image/png');
                const classifier = new ExtractorFileClassification(mockFile, env, bkperAIClient);
                const result = await classifier.extract(undefined);

                expect(result).toBeDefined();
                expect(result!.kind).toBe('single_transaction');
            },
            { timeout: 120_000 }
        );

        it.skipIf(!bkperAIClient)(
            'extracts invoice details from PNG through Bkper AI',
            async () => {
                const mockFile = createMockFileFromFixture('invoice.png', 'image/png');
                const extractor = new ExtractorInvoice(mockFile, env, bkperAIClient);
                const result = await extractor.extract(undefined);

                expect(result).toBeDefined();
                // Date: 15/03/2025 → should be converted to 2025-03-15
                expect(result!.date).toMatch(DATE_PATTERN);
                expect(result!.date).toBe('2025-03-15');
                // Amount: total is 189.73
                expect(typeof result!.amount).toBe('number');
                expect(result!.amount).toBeCloseTo(189.73, 0);
                // Description: should mention the items (keyboard, hub, stand or office supplies)
                expect(typeof result!.description).toBe('string');
                expect(result!.description.length).toBeGreaterThan(0);
            },
            { timeout: 120_000 }
        );

        it.skipIf(!bkperAIClient)(
            'extracts receipt details from JPEG through Bkper AI',
            async () => {
                const mockFile = createMockFileFromFixture('receipt.jpeg', 'image/jpeg');
                const extractor = new ExtractorInvoice(mockFile, env, bkperAIClient);
                const result = await extractor.extract(undefined);

                expect(result).toBeDefined();
                // Date: 22.06.2025 → should be converted to 2025-06-22
                expect(result!.date).toMatch(DATE_PATTERN);
                expect(result!.date).toBe('2025-06-22');
                // Amount: total is 19.32
                expect(typeof result!.amount).toBe('number');
                expect(result!.amount).toBeCloseTo(19.32, 0);
                // Description: should reference café/food items
                expect(typeof result!.description).toBe('string');
                expect(result!.description.length).toBeGreaterThan(0);
            },
            { timeout: 120_000 }
        );

        it.skipIf(!bkperAIClient)(
            'extracts invoice details from PDF through Bkper AI',
            async () => {
                const mockFile = createMockFileFromFixture('invoice.pdf', 'application/pdf');
                const extractor = new ExtractorInvoice(mockFile, env, bkperAIClient);
                const result = await extractor.extract(undefined);

                expect(result).toBeDefined();
                // Date: 28/02/2025 → should be converted to 2025-02-28
                expect(result!.date).toMatch(DATE_PATTERN);
                expect(result!.date).toBe('2025-02-28');
                // Amount: total is 902.66
                expect(typeof result!.amount).toBe('number');
                expect(result!.amount).toBeCloseTo(902.66, 0);
                // Description: should reference cloud/hosting/services
                expect(typeof result!.description).toBe('string');
                expect(result!.description.length).toBeGreaterThan(0);
            },
            { timeout: 120_000 }
        );

        it.skipIf(!bkperAIClient)(
            'classifies a JPEG receipt as a single transaction through Bkper AI',
            async () => {
                const mockFile = createMockFileFromFixture('receipt.jpeg', 'image/jpeg');
                const classifier = new ExtractorFileClassification(mockFile, env, bkperAIClient);
                const result = await classifier.extract(undefined);

                expect(result).toBeDefined();
                expect(result!.kind).toBe('single_transaction');
            },
            { timeout: 120_000 }
        );
    });

    // ========================================
    // Group 6: Bank Statement PDF Extraction
    // ========================================

    describe('Bank Statement PDF Extraction', () => {
        it.skipIf(!bkperAIClient)(
            'extracts multiple transactions from a bank statement PDF through Bkper AI',
            async () => {
                const mockFile = createMockFileFromFixture('bank-statement.pdf', 'application/pdf');
                const extractor = new ExtractorStatementIMG(mockFile, env, bkperAIClient);
                const result = await extractor.extract(undefined);

                expect(result).toBeDefined();
                expect(result!.transactions).toBeArray();
                // The statement has 10 transaction rows (including Opening Balance)
                // Model may or may not include Opening Balance — expect at least 7 real transactions
                expect(result!.transactions.length).toBeGreaterThanOrEqual(7);

                for (const tx of result!.transactions) {
                    expect(tx.date).toMatch(DATE_PATTERN);
                    expect(typeof tx.description).toBe('string');
                    expect(tx.description.length).toBeGreaterThan(0);
                    expect(typeof tx.amount).toBe('number');
                }

                // Verify known transactions are present
                const salaryTx = result!.transactions.find(tx =>
                    tx.description.toLowerCase().includes('salary')
                );
                expect(salaryTx).toBeDefined();
                expect(salaryTx!.amount).toBeCloseTo(3850, 0);

                const rentTx = result!.transactions.find(tx =>
                    tx.description.toLowerCase().includes('rent')
                );
                expect(rentTx).toBeDefined();
                // Rent is a debit (1200) — may be negative depending on model interpretation
                expect(Math.abs(rentTx!.amount)).toBeCloseTo(1200, 0);
            },
            { timeout: 120_000 }
        );

        it.skipIf(!bkperAIClient)(
            'classifies invoice PDF as a single transaction through Bkper AI',
            async () => {
                const mockFile = createMockFileFromFixture('invoice.pdf', 'application/pdf');
                const classifier = new ExtractorFileClassification(mockFile, env, bkperAIClient);
                const result = await classifier.extract(undefined);

                expect(result).toBeDefined();
                expect(result!.kind).toBe('single_transaction');
            },
            { timeout: 120_000 }
        );
    });

    // ========================================
    // Group 7: ACE Pipeline for Image/PDF
    // ========================================

    describe.skipIf(!bkperAIClient)('ACE Pipeline through Bkper AI (Image/PDF)', () => {
        // Synthetic: AI extracted from bank-statement.pdf with errors, user corrected
        const aiExtractedIMG = [
            { date: '2025-04-03', description: 'Rent Payment', amount: 1200.0, properties: {} },
            { date: '2025-04-05', description: 'Salary', amount: 3850.0, properties: {} },
            { date: '2025-04-08', description: 'Grocery Store', amount: 87.35, properties: {} },
            { date: '2025-04-12', description: 'Electric', amount: 145.2, properties: {} },
        ];

        const userCorrectedIMG = [
            {
                date: '2025-04-03',
                description: 'Rent Payment - April',
                amount: -1200.0,
                properties: {},
            },
            { date: '2025-04-05', description: 'Salary Deposit', amount: 3850.0, properties: {} },
            {
                date: '2025-04-08',
                description: 'Grocery Store #4412',
                amount: -87.35,
                properties: {},
            },
            { date: '2025-04-12', description: 'Electric Company', amount: -145.2, properties: {} },
            {
                date: '2025-04-15',
                description: 'Online Transfer from Savings',
                amount: 500.0,
                properties: {},
            },
            {
                date: '2025-04-18',
                description: 'Restaurant La Piazza',
                amount: -62.8,
                properties: {},
            },
        ];

        it(
            'ReflectorStatementIMG identifies extraction failures from bank statement PDF',
            async () => {
                const mockFile = createMockFileFromFixture('bank-statement.pdf', 'application/pdf');
                const reflector = new ReflectorStatementIMG(mockFile, env, bkperAIClient);
                const result = await reflector.reflect(aiExtractedIMG, userCorrectedIMG);

                expect(result).toBeDefined();
                expect(result!.whatFailed).toBeArray();
                expect(result!.whatFailed.length).toBeGreaterThan(0);
                expect(result!.whatWorked).toBeArray();
                expect(typeof result!.suggestedImprovements).toBe('string');
                expect(result!.suggestedImprovements.length).toBeGreaterThan(0);
            },
            { timeout: 120_000 }
        );

        it(
            'CuratorStatementIMG generates actionable bullets for bank statement PDF',
            async () => {
                const reflection: ReflectionResult = {
                    whatWorked: [
                        'Date extraction from the main table is accurate',
                        'Salary deposit correctly identified as credit',
                    ],
                    whatFailed: [
                        'Debit amounts extracted as positive instead of negative',
                        'Missing transactions: Online Transfer and Restaurant not extracted',
                        'Descriptions truncated: missing store numbers and payment details',
                    ],
                    suggestedImprovements:
                        'Use the Debit column for negative amounts and Credit column for positive. Extract all rows from the transaction table, not just the first few.',
                };

                const mockFile = createMockFileFromFixture('bank-statement.pdf', 'application/pdf');
                const curator = new CuratorStatementIMG(reflection, env, bkperAIClient);
                const bullets = await curator.extractNewBullets();

                expect(bullets).toBeDefined();
                expect(bullets).toBeArray();
                expect(bullets!.length).toBeGreaterThan(0);

                for (const bullet of bullets!) {
                    expect(typeof bullet).toBe('string');
                    expect(bullet.length).toBeGreaterThan(0);
                }
            },
            { timeout: 120_000 }
        );
    });
});
