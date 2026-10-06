import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ExternalExtractorClient } from '../../src/external-extractor/ExternalExtractorClient.js';
import { ExternalExtractorResponse } from '../../src/external-extractor/ExternalExtractorTypes.js';
import { Book, Account, File } from 'bkper-js';

describe('ExternalExtractorClient - file properties', () => {
    let client: ExternalExtractorClient;
    const TEST_URL = 'https://extractor.example.com/extract';

    function createMockFile(): File {
        return {
            getId: () => 'file_1',
            getName: () => 'statement.csv',
            getContent: async () => 'base64content==',
            getContentType: () => 'text/csv',
        } as unknown as File;
    }

    function createMockBook(): Book {
        return {
            getId: () => 'book_1',
            getName: () => 'My Book',
            getOwnerName: () => undefined,
            getDatePattern: () => 'dd/MM/yyyy',
            getDecimalSeparator: () => 'DOT',
            getFractionDigits: () => undefined,
            getTimeZone: () => undefined,
            getTimeZoneOffset: () => undefined,
            getPeriod: () => undefined,
            getPeriodStartMonth: () => undefined,
            getAutoPost: () => undefined,
            getLockDate: () => undefined,
            getClosingDate: () => undefined,
            getVisibility: () => undefined,
            getPermission: () => undefined,
            getCollection: () => undefined,
            getLastUpdateMs: () => undefined,
            getPageSize: () => undefined,
            getTotalTransactions: () => 0,
            getTotalTransactionsCurrentMonth: () => 0,
            getTotalTransactionsCurrentYear: () => 0,
            getVisibleProperties: () => ({}),
            json: () => ({
                id: 'book_1',
                name: 'My Book',
                datePattern: 'dd/MM/yyyy',
                decimalSeparator: 'DOT' as 'DOT' | 'COMMA',
            }),
        } as unknown as Book;
    }

    function createMockAccount(): Account {
        return {
            getId: () => 'acc_1',
            getName: () => 'Bank',
            getNormalizedName: () => 'bank',
            getType: () => 'ASSET',
            isCredit: () => false,
            isPermanent: () => true,
            isArchived: () => false,
            hasTransactionPosted: () => false,
            getGroups: async () => [],
            getVisibleProperties: () => ({}),
            json: () => ({
                id: 'acc_1',
                name: 'Bank',
                normalizedName: 'bank',
                type: 'ASSET' as 'ASSET' | 'LIABILITY' | 'INCOMING' | 'OUTGOING',
                credit: false,
                permanent: true,
                archived: false,
                hasTransactionPosted: false,
                properties: {},
            }) as bkper.Account,
        } as unknown as Account;
    }

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        client = new ExternalExtractorClient(TEST_URL);
        originalFetch = globalThis.fetch;
        // Override sleep to avoid waiting in tests
        (client as any).sleep = async () => {};
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    // Verifies that the file parser consumes file.properties.
    it('returns file properties when response includes file.properties', async () => {
        const response: ExternalExtractorResponse = {
            success: true,
            data: {
                transactions: [{ date: '2024-01-02', description: 'TREASURY BILL', amount: 179000.0, properties: {} }],
            },
            file: {
                properties: {
                    statement_period: '2024-01',
                    bank_name: 'Safra',
                    account_number: '3384',
                },
            },
        };

        globalThis.fetch = mock(async () => new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

        const result = await client.extractFileProperties(createMockFile(), createMockBook(), createMockAccount(), { url: TEST_URL, source: 'account' as const, account: createMockAccount() });

        expect(result).toEqual({
            statement_period: '2024-01',
            bank_name: 'Safra',
            account_number: '3384',
        });
    });

    // Distinguishes a deliberate empty object from absence — the client passes it
    // through as-is and leaves the decision of whether to call update() to the caller.
    it('returns empty object when response has file.properties as empty object', async () => {
        const response: ExternalExtractorResponse = {
            success: true,
            data: {
                transactions: [{ date: '2024-01-02', description: 'TREASURY BILL', amount: 179000.0, properties: {} }],
            },
            file: {
                properties: {},
            },
        };

        globalThis.fetch = mock(async () => new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

        const result = await client.extractFileProperties(createMockFile(), createMockBook(), createMockAccount(), { url: TEST_URL, source: 'account' as const, account: createMockAccount() });

        expect(result).toEqual({});
    });

    // Simulates the real-world risk: response.json() deserialises JSON without enforcing types,
    // so file.properties may contain numbers, booleans, or null even though the TypeScript type
    // declares Record<string, string>. The client must coerce every value to a string via String()
    // so that downstream callers (e.g. file.setProperty()) always receive the required string type.
    it('coerces non-string file property values to strings before returning', async () => {
        const responseWithMixedTypes = {
            success: true,
            data: {
                transactions: [{ date: '2024-01-02', description: 'TREASURY BILL', amount: 179000.0, properties: {} }],
            },
            file: {
                properties: {
                    statement_period: '2024-01',   // already a string — must stay unchanged
                    total_amount: 179000,           // number
                    is_final: true,                 // boolean
                    closing_date: null,             // null
                    fraction_digits: 2,             // integer
                    ratio: 0.075,                  // float
                },
            },
        } as unknown as ExternalExtractorResponse;

        globalThis.fetch = mock(async () => new Response(JSON.stringify(responseWithMixedTypes), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

        const result = await client.extractFileProperties(createMockFile(), createMockBook(), createMockAccount(), { url: TEST_URL, source: 'account' as const, account: createMockAccount() });

        expect(typeof result!['statement_period']).toBe('string');
        expect(typeof result!['total_amount']).toBe('string');
        expect(typeof result!['is_final']).toBe('string');
        expect(typeof result!['closing_date']).toBe('string');
        expect(typeof result!['fraction_digits']).toBe('string');
        expect(typeof result!['ratio']).toBe('string');

        expect(result).toEqual({
            statement_period: '2024-01',
            total_amount: '179000',
            is_final: 'true',
            closing_date: 'null',
            fraction_digits: '2',
            ratio: '0.075',
        });
    });

    // Confirms the transactions parser consumes only transaction data and ignores file.properties.
    it('returns transactions without file metadata from the transactions operation', async () => {
        const response: ExternalExtractorResponse = {
            success: true,
            data: {
                transactions: [
                    { date: '2024-01-02', description: 'TREASURY BILL', amount: 179000.0, properties: { quantity: '179000' } },
                    { date: '2024-01-30', description: 'BUY T-BILL', amount: -449837.67, properties: { quantity: '455000' } },
                ],
            },
            file: {
                properties: {
                    statement_period: '2024-01',
                    bank_name: 'Safra',
                },
            },
        };

        globalThis.fetch = mock(async () => new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

        const result = await client.extract(createMockFile(), createMockBook(), createMockAccount(), { url: TEST_URL, source: 'account' as const, account: createMockAccount() });

        expect(result.transactions).toHaveLength(2);
        expect(result.transactions[0].description).toBe('TREASURY BILL');
        expect(result.transactions[1].description).toBe('BUY T-BILL');
        expect(result).not.toHaveProperty('fileProperties');
    });
});
