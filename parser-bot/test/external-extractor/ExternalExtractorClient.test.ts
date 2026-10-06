import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { ExternalExtractorClient } from '../../src/external-extractor/ExternalExtractorClient.js';
import { ExternalExtractorResponse } from '../../src/external-extractor/ExternalExtractorTypes.js';
import { Book, Account, File, Group } from 'bkper-js';

describe('ExternalExtractorClient', () => {
    let client: ExternalExtractorClient;
    const TEST_URL = 'https://extractor.example.com/extract';

    function createMockFile(name: string, content: string, contentType: string): File {
        return {
            getId: () => 'file_1',
            getName: () => name,
            getContent: async () => content,
            getContentType: () => contentType,
        } as unknown as File;
    }

    function createMockBook(
        overrides: Partial<{
            id: string;
            name: string;
            ownerName: string;
            datePattern: string;
            decimalSeparator: string;
            fractionDigits: number;
            timeZone: string;
            timeZoneOffset: number;
            period: string;
            periodStartMonth: string;
            autoPost: boolean;
            lockDate: string;
            closingDate: string;
            visibility: string;
            permission: string;
            collection: any;
            lastUpdateMs: number;
            pageSize: number;
            totalTransactions: number;
            totalTransactionsCurrentMonth: number;
            totalTransactionsCurrentYear: number;
            properties: Record<string, string>;
        }> = {}
    ): Book {
        return {
            getId: () => overrides.id || 'book_1',
            getName: () => overrides.name || 'My Book',
            getOwnerName: () => overrides.ownerName,
            getDatePattern: () => overrides.datePattern || 'dd/MM/yyyy',
            getDecimalSeparator: () => overrides.decimalSeparator || 'DOT',
            getFractionDigits: () => overrides.fractionDigits,
            getTimeZone: () => overrides.timeZone,
            getTimeZoneOffset: () => overrides.timeZoneOffset,
            getPeriod: () => overrides.period,
            getPeriodStartMonth: () => overrides.periodStartMonth,
            getAutoPost: () => overrides.autoPost,
            getLockDate: () => overrides.lockDate,
            getClosingDate: () => overrides.closingDate,
            getVisibility: () => overrides.visibility,
            getPermission: () => overrides.permission,
            getCollection: () => overrides.collection,
            getLastUpdateMs: () => overrides.lastUpdateMs,
            getPageSize: () => overrides.pageSize,
            getTotalTransactions: () => overrides.totalTransactions ?? 0,
            getTotalTransactionsCurrentMonth: () => overrides.totalTransactionsCurrentMonth ?? 0,
            getTotalTransactionsCurrentYear: () => overrides.totalTransactionsCurrentYear ?? 0,
            getVisibleProperties: () => overrides.properties || {},
            json: () => ({
                id: overrides.id || 'book_1',
                name: overrides.name || 'My Book',
                datePattern: overrides.datePattern || 'dd/MM/yyyy',
                decimalSeparator: (overrides.decimalSeparator || 'DOT') as 'DOT' | 'COMMA',
                ...(overrides.ownerName !== undefined && { ownerName: overrides.ownerName }),
                ...(overrides.fractionDigits !== undefined && { fractionDigits: overrides.fractionDigits }),
                ...(overrides.timeZone !== undefined && { timeZone: overrides.timeZone }),
                ...(overrides.timeZoneOffset !== undefined && { timeZoneOffset: overrides.timeZoneOffset }),
                ...(overrides.period !== undefined && { period: overrides.period as any }),
                ...(overrides.periodStartMonth !== undefined && { periodStartMonth: overrides.periodStartMonth as any }),
                ...(overrides.autoPost !== undefined && { autoPost: overrides.autoPost }),
                ...(overrides.lockDate !== undefined && { lockDate: overrides.lockDate }),
                ...(overrides.closingDate !== undefined && { closingDate: overrides.closingDate }),
                ...(overrides.visibility !== undefined && { visibility: overrides.visibility as any }),
                ...(overrides.permission !== undefined && { permission: overrides.permission as any }),
                ...(overrides.collection !== undefined && { collection: overrides.collection }),
                ...(overrides.lastUpdateMs !== undefined && { lastUpdateMs: overrides.lastUpdateMs.toString() }),
                ...(overrides.pageSize !== undefined && { pageSize: overrides.pageSize }),
                ...(overrides.totalTransactions !== undefined && { totalTransactions: overrides.totalTransactions }),
                ...(overrides.totalTransactionsCurrentMonth !== undefined && { totalTransactionsCurrentMonth: overrides.totalTransactionsCurrentMonth }),
                ...(overrides.totalTransactionsCurrentYear !== undefined && { totalTransactionsCurrentYear: overrides.totalTransactionsCurrentYear }),
                ...(overrides.properties !== undefined && { properties: overrides.properties }),
            }) as bkper.Book,
        } as unknown as Book;
    }

    function createMockAccount(id: string, name: string, properties: Record<string, string> = {}): Account {
        return {
            getId: () => id,
            getName: () => name,
            getNormalizedName: () => name.toLowerCase(),
            getType: () => 'ASSET',
            isCredit: () => false,
            isPermanent: () => true,
            isArchived: () => false,
            hasTransactionPosted: () => false,
            getGroups: async () => [],
            getVisibleProperties: () => properties,
            json: () => ({
                id,
                name,
                normalizedName: name.toLowerCase(),
                type: 'ASSET' as 'ASSET' | 'LIABILITY' | 'INCOMING' | 'OUTGOING',
                credit: false,
                permanent: true,
                archived: false,
                hasTransactionPosted: false,
                properties,
            }) as bkper.Account,
        } as unknown as Account;
    }

    function createMockGroup(id: string, name: string, properties: Record<string, string> = {}, accounts: Account[] = []): Group {
        return {
            getId: () => id,
            getName: () => name,
            getAccounts: async () => accounts,
            getVisibleProperties: () => properties,
            json: () => ({
                id,
                name,
                normalizedName: name.toLowerCase(),
                hidden: false,
                locked: false,
                hasAccounts: accounts.length > 0,
                properties,
            }) as bkper.Group,
        } as unknown as Group;
    }

    beforeEach(() => {
        client = new ExternalExtractorClient(TEST_URL);
    });

    describe('buildRequest', () => {
        it('should build correct request structure with all book fields', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook({
                ownerName: 'owner@example.com',
                fractionDigits: 2,
                timeZone: 'America/New_York',
                timeZoneOffset: -300,
                period: 'MONTH',
                periodStartMonth: 'JANUARY',
                autoPost: false,
                lockDate: '2024-01-01',
                closingDate: '2024-12-31',
                visibility: 'PRIVATE',
                permission: 'OWNER',
                collection: {
                    id: 'col_1',
                    name: 'My Collection',
                    ownerUsername: 'owner@example.com',
                    permission: 'OWNER',
                    books: [],
                },
                lastUpdateMs: 1704067200000,
                pageSize: 100,
                totalTransactions: 500,
                totalTransactionsCurrentMonth: 25,
                totalTransactionsCurrentYear: 200,
                properties: { company: 'Acme Corp' },
            });
            const account = createMockAccount('acc_1', 'Bank');

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.id).toBe('book_1');
            expect(request.book.name).toBe('My Book');
            expect(request.book.ownerName).toBe('owner@example.com');
            expect(request.book.datePattern).toBe('dd/MM/yyyy');
            expect(request.book.decimalSeparator).toBe('DOT');
            expect(request.book.fractionDigits).toBe(2);
            expect(request.book.timeZone).toBe('America/New_York');
            expect(request.book.timeZoneOffset).toBe(-300);
            expect(request.book.period).toBe('MONTH');
            expect(request.book.periodStartMonth).toBe('JANUARY');
            expect(request.book.autoPost).toBe(false);
            expect(request.book.lockDate).toBe('2024-01-01');
            expect(request.book.closingDate).toBe('2024-12-31');
            expect(request.book.visibility).toBe('PRIVATE');
            expect(request.book.permission).toBe('OWNER');
            expect(request.book.collection).toEqual({
                id: 'col_1',
                name: 'My Collection',
                ownerUsername: 'owner@example.com',
                permission: 'OWNER',
                books: [],
            });
            expect(request.book.accounts).toHaveLength(1);
            expect(request.book.accounts[0].id).toBe('acc_1');
            expect(request.book.groups).toBeUndefined();
            expect(request.book.properties).toEqual({ company: 'Acme Corp' });
            expect(request.book.createdAt).toBeUndefined();
            expect(request.book.updatedAt).toBeUndefined();
            expect(request.book.lastUpdateMs).toBe('1704067200000');
            expect(request.book.agentId).toBeUndefined();
            expect(request.book.pageSize).toBe(100);
            expect(request.book.totalTransactions).toBe(500);
            expect(request.book.totalTransactionsCurrentMonth).toBe(25);
            expect(request.book.totalTransactionsCurrentYear).toBe(200);

            expect(request.account).toEqual({
                id: 'acc_1',
                name: 'Bank',
                properties: {},
            });

            expect(request.file).toEqual({
                id: 'file_1',
                name: 'statement.csv',
                content: 'base64content==',
                contentType: 'text/csv',
            });
        });

        it('should build request with minimal book fields (no optional values)', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.id).toBe('book_1');
            expect(request.book.name).toBe('My Book');
            expect(request.book.ownerName).toBeUndefined();
            expect(request.book.datePattern).toBe('dd/MM/yyyy');
            expect(request.book.decimalSeparator).toBe('DOT');
            expect(request.book.fractionDigits).toBeUndefined();
            expect(request.book.timeZone).toBeUndefined();
            expect(request.book.timeZoneOffset).toBeUndefined();
            expect(request.book.period).toBeUndefined();
            expect(request.book.periodStartMonth).toBeUndefined();
            expect(request.book.autoPost).toBeUndefined();
            expect(request.book.lockDate).toBeUndefined();
            expect(request.book.closingDate).toBeUndefined();
            expect(request.book.visibility).toBeUndefined();
            expect(request.book.permission).toBeUndefined();
            expect(request.book.collection).toBeUndefined();
            expect(request.book.accounts).toHaveLength(1);
            expect(request.book.accounts[0].id).toBe('acc_1');
            expect(request.book.groups).toBeUndefined();
            expect(request.book.properties).toBeUndefined();
            expect(request.book.lastUpdateMs).toBeUndefined();
            expect(request.book.pageSize).toBeUndefined();
            expect(request.book.totalTransactions).toBeUndefined();
            expect(request.book.totalTransactionsCurrentMonth).toBeUndefined();
            expect(request.book.totalTransactionsCurrentYear).toBeUndefined();
        });

        it('should use COMMA decimal separator', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook({ decimalSeparator: 'COMMA' });
            const account = createMockAccount('acc_1', 'Bank');

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.decimalSeparator).toBe('COMMA');
        });

        it('should use book.json() datePattern in request', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook({ datePattern: 'MM/dd/yyyy' });
            const account = createMockAccount('acc_1', 'Bank');

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.datePattern).toBe('MM/dd/yyyy');
        });

        it('should include book properties from book.json()', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook({
                properties: {
                    company: 'Acme Corp',
                    fiscal_year: '2024',
                    currency: 'USD',
                },
            });
            const account = createMockAccount('acc_1', 'Bank');

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.properties).toEqual({
                company: 'Acme Corp',
                fiscal_year: '2024',
                currency: 'USD',
            });
        });

        it('should include account visible properties', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank', {
                bank_code: '001',
                branch: 'Main Street',
                account_type: 'checking',
            });

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.account.properties).toEqual({
                bank_code: '001',
                branch: 'Main Street',
                account_type: 'checking',
            });
        });

        it('should pass book.json() properties through as-is including agent_ prefixed keys', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook({
                properties: {
                    company: 'Acme Corp',
                    agent_prompt: 'Extract transactions',
                    fiscal_year: '2024',
                },
            });
            const account = createMockAccount('acc_1', 'Bank');

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.properties).toEqual({
                company: 'Acme Corp',
                agent_prompt: 'Extract transactions',
                fiscal_year: '2024',
            });
        });

        it('should filter out agent_ prefixed properties from account', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank', {
                bank_code: '001',
                agent_prompt: 'Custom prompt',
                account_type: 'checking',
                agent_parser_url: 'https://parser.example.com',
            });

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.account.properties).toEqual({
                bank_code: '001',
                account_type: 'checking',
            });
            expect(request.account.properties).not.toHaveProperty('agent_prompt');
            expect(request.account.properties).not.toHaveProperty('agent_parser_url');
        });

        // Verifies group-scoped parser requests include the group that owns the parser URL.
        it('should include group context when parser URL is configured on a group', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const otherAccount = createMockAccount('acc_2', 'Savings');
            const group = createMockGroup('grp_1', 'Banks', {
                bank_family: 'Safra',
                agent_parser_url_transactions: 'https://parser.example.com',
            }, [account, otherAccount]);

            const lookup = { url: TEST_URL, source: 'group' as const, account, group };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.accounts).toHaveLength(2);
            expect(request.book.accounts.map((bookAccount: bkper.Account) => bookAccount.id)).toEqual(['acc_1', 'acc_2']);
            expect(request.group).toEqual({
                id: 'grp_1',
                name: 'Banks',
                normalizedName: 'banks',
                hidden: false,
                locked: false,
                hasAccounts: true,
                properties: {
                    bank_family: 'Safra',
                },
            });
            expect(request.group.properties).not.toHaveProperty('agent_parser_url_transactions');
        });

        it('should handle empty properties', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook({ properties: {} });
            const account = createMockAccount('acc_1', 'Bank', {});

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.properties).toEqual({});
            expect(request.account.properties).toEqual({});
        });

        it('should pass book.json() properties through including agent_ prefixed keys', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook({
                properties: {
                    agent_prompt: 'Test',
                    agent_parser_url: 'https://example.com',
                },
            });
            const account = createMockAccount('acc_1', 'Bank');

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.properties).toEqual({
                agent_prompt: 'Test',
                agent_parser_url: 'https://example.com',
            });
        });

        it('should throw when file content is empty', async () => {
            const file = {
                getId: () => 'file_1',
                getName: () => 'empty.csv',
                getContent: async () => undefined,
                getContentType: () => 'text/csv',
            } as unknown as File;
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            await expect((client as any).buildRequest(file, book, account, lookup)).rejects.toThrow(
                'File content is empty'
            );
        });

        it('should use empty strings for missing account IDs and names', async () => {
            const file = createMockFile('statement.csv', 'base64content==', 'text/csv');
            const book = createMockBook();
            const account = {
                getId: () => undefined,
                getName: () => undefined,
                getNormalizedName: () => undefined,
                getType: () => undefined,
                isCredit: () => undefined,
                isPermanent: () => undefined,
                isArchived: () => false,
                hasTransactionPosted: () => undefined,
                getGroups: async () => [],
                getVisibleProperties: () => ({}),
                json: () => ({}) as bkper.Account,
            } as unknown as Account;

            const lookup = { url: TEST_URL, source: 'account' as const, account };
            const request = await (client as any).buildRequest(file, book, account, lookup);

            expect(request.book.id).toBe('book_1');
            expect(request.book.name).toBe('My Book');
            expect(request.account.id).toBe('');
            expect(request.account.name).toBe('');
        });
    });

    describe('mapToExtractedTransactions', () => {
        it('should map valid response to ExtractedTransaction array', () => {
            const response: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        {
                            date: '2025-01-15',
                            description: 'Payment received',
                            amount: 1500.0,
                            properties: { ref: 'INV-001' },
                        },
                        {
                            date: '2025-01-16',
                            description: 'Office supplies',
                            amount: -45.99,
                            properties: {},
                        },
                    ],
                },
            };

            const result = (client as any).mapToExtractedTransactions(response);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                date: '2025-01-15',
                description: 'Payment received',
                amount: 1500.0,
                properties: { ref: 'INV-001' },
            });
            expect(result[1]).toEqual({
                date: '2025-01-16',
                description: 'Office supplies',
                amount: -45.99,
                properties: {},
            });
        });

        it('should return empty array when response has no transactions', () => {
            const response: ExternalExtractorResponse = {
                success: true,
                data: { transactions: [] },
            };

            const result = (client as any).mapToExtractedTransactions(response);
            expect(result).toEqual([]);
        });

        it('should return empty array when data is undefined', () => {
            const response: ExternalExtractorResponse = {
                success: true,
            };

            const result = (client as any).mapToExtractedTransactions(response);
            expect(result).toEqual([]);
        });

        it('should default properties to empty object when undefined', () => {
            const response: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        {
                            date: '2025-01-15',
                            description: 'No props',
                            amount: 100,
                            properties: {},
                        },
                    ],
                },
            };

            const result = (client as any).mapToExtractedTransactions(response);
            expect(result[0].properties).toEqual({});
        });

        it('should preserve book_id when present in transaction', () => {
            const response: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        {
                            date: '2025-01-15',
                            description: 'Cross-book transaction',
                            amount: 1000.0,
                            properties: {},
                            book_id: 'other_book_123',
                        },
                    ],
                },
            };

            const result = (client as any).mapToExtractedTransactions(response);

            expect(result).toHaveLength(1);
            expect(result[0].book_id).toBe('other_book_123');
        });

        it('should preserve account_name when present in transaction', () => {
            const response: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        {
                            date: '2025-01-15',
                            description: 'Different account transaction',
                            amount: 500.0,
                            properties: {},
                            account_name: 'Savings Account',
                        },
                    ],
                },
            };

            const result = (client as any).mapToExtractedTransactions(response);

            expect(result).toHaveLength(1);
            expect(result[0].account_name).toBe('Savings Account');
        });

        it('should preserve both book_id and account_name when present', () => {
            const response: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        {
                            date: '2025-01-15',
                            description: 'Full override transaction',
                            amount: 2000.0,
                            properties: { ref: 'TX-001' },
                            book_id: 'target_book_456',
                            account_name: 'Checking Account',
                        },
                    ],
                },
            };

            const result = (client as any).mapToExtractedTransactions(response);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                date: '2025-01-15',
                description: 'Full override transaction',
                amount: 2000.0,
                properties: { ref: 'TX-001' },
                book_id: 'target_book_456',
                account_name: 'Checking Account',
            });
        });

        it('should not include book_id or account_name when not present in response', () => {
            const response: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        {
                            date: '2025-01-15',
                            description: 'No overrides',
                            amount: 100.0,
                            properties: {},
                        },
                    ],
                },
            };

            const result = (client as any).mapToExtractedTransactions(response);

            expect(result).toHaveLength(1);
            expect(result[0].book_id).toBeUndefined();
            expect(result[0].account_name).toBeUndefined();
        });

        it('should handle mixed transactions with and without overrides', () => {
            const response: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        {
                            date: '2025-01-15',
                            description: 'Normal transaction',
                            amount: 100.0,
                            properties: {},
                        },
                        {
                            date: '2025-01-16',
                            description: 'With book override',
                            amount: 200.0,
                            properties: {},
                            book_id: 'book_2',
                        },
                        {
                            date: '2025-01-17',
                            description: 'With account override',
                            amount: 300.0,
                            properties: {},
                            account_name: 'Account B',
                        },
                    ],
                },
            };

            const result = (client as any).mapToExtractedTransactions(response);

            expect(result).toHaveLength(3);
            expect(result[0].book_id).toBeUndefined();
            expect(result[0].account_name).toBeUndefined();
            expect(result[1].book_id).toBe('book_2');
            expect(result[1].account_name).toBeUndefined();
            expect(result[2].book_id).toBeUndefined();
            expect(result[2].account_name).toBe('Account B');
        });
    });

    describe('calculateBackoffDelay', () => {
        it('should calculate exponential backoff correctly', () => {
            expect((client as any).calculateBackoffDelay(1)).toBe(1000);
            expect((client as any).calculateBackoffDelay(2)).toBe(2000);
            expect((client as any).calculateBackoffDelay(3)).toBe(4000);
        });
    });

    describe('extract (retry behavior)', () => {
        let originalFetch: typeof globalThis.fetch;

        beforeEach(() => {
            originalFetch = globalThis.fetch;
            // Override sleep to avoid waiting in tests
            (client as any).sleep = async () => {};
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
        });

        it('should return one transaction from data.transaction for single-transaction parser', async () => {
            const successResponse: ExternalExtractorResponse = {
                success: true,
                data: {
                    transaction: { date: '2025-01-15', description: 'Invoice', amount: 100, properties: {} },
                },
            };

            globalThis.fetch = mock(
                async () =>
                    new Response(JSON.stringify(successResponse), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
            ) as unknown as typeof fetch;

            const file = createMockFile('invoice.pdf', 'base64==', 'application/pdf');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            const result = await client.extractTransaction(file, book, account, lookup);

            expect(result.description).toBe('Invoice');
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        });

        it('should reject single-transaction parser responses without data.transaction', async () => {
            const successResponse: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [{ date: '2025-01-15', description: 'Old shape', amount: 100, properties: {} }],
                },
            };

            globalThis.fetch = mock(
                async () =>
                    new Response(JSON.stringify(successResponse), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
            ) as unknown as typeof fetch;

            const file = createMockFile('invoice.pdf', 'base64==', 'application/pdf');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            await expect(client.extractTransaction(file, book, account, lookup)).rejects.toThrow('External transaction parser response missing data.transaction');
        });

        it('should return file properties from file.properties for file parser', async () => {
            const successResponse: ExternalExtractorResponse = {
                success: true,
                file: {
                    properties: {
                        invoice_number: 'INV-001',
                        total_pages: '2',
                    },
                },
            };

            globalThis.fetch = mock(
                async () =>
                    new Response(JSON.stringify(successResponse), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
            ) as unknown as typeof fetch;

            const file = createMockFile('invoice.pdf', 'base64==', 'application/pdf');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            const result = await client.extractFileProperties(file, book, account, lookup);

            expect(result).toEqual({ invoice_number: 'INV-001', total_pages: '2' });
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        });

        it('should return transactions on successful first attempt', async () => {
            const successResponse: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        { date: '2025-01-15', description: 'Test', amount: 100, properties: {} },
                    ],
                },
            };

            globalThis.fetch = mock(
                async () =>
                    new Response(JSON.stringify(successResponse), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
            ) as unknown as typeof fetch;

            const file = createMockFile('test.csv', 'base64==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            const result = await client.extract(file, book, account, lookup);

            expect(result!.transactions).toHaveLength(1);
            expect(result!.transactions[0].description).toBe('Test');
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure and succeed on second attempt', async () => {
            const successResponse: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        {
                            date: '2025-01-15',
                            description: 'Retry success',
                            amount: 200,
                            properties: {},
                        },
                    ],
                },
            };

            let callCount = 0;
            globalThis.fetch = mock(async () => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('Network error');
                }
                return new Response(JSON.stringify(successResponse), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }) as unknown as typeof fetch;

            const file = createMockFile('test.csv', 'base64==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            const result = await client.extract(file, book, account, lookup);

            expect(result!.transactions).toHaveLength(1);
            expect(result!.transactions[0].description).toBe('Retry success');
            expect(callCount).toBe(2);
        });

        it('should throw after exhausting all retries', async () => {
            globalThis.fetch = mock(async () => {
                throw new Error('Persistent failure');
            }) as unknown as typeof fetch;

            const file = createMockFile('test.csv', 'base64==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            await expect(client.extract(file, book, account, lookup)).rejects.toThrow(
                'External extractor failed after 4 attempts'
            );
        });

        it('should throw on HTTP error response', async () => {
            const errorResponse: ExternalExtractorResponse = {
                success: false,
                error: { code: 'PARSE_ERROR', message: 'Failed to parse file' },
            };

            globalThis.fetch = mock(
                async () =>
                    new Response(JSON.stringify(errorResponse), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' },
                    })
            ) as unknown as typeof fetch;

            const file = createMockFile('test.csv', 'base64==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            await expect(client.extract(file, book, account, lookup)).rejects.toThrow(
                'External extractor failed after 4 attempts'
            );
        });

        // Verifies client-side HTTP errors fail immediately without retries.
        it('should not retry on HTTP client error response', async () => {
            const errorResponse: ExternalExtractorResponse = {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid request' },
            };

            globalThis.fetch = mock(
                async () =>
                    new Response(JSON.stringify(errorResponse), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                    })
            ) as unknown as typeof fetch;

            const file = createMockFile('test.csv', 'base64==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            await expect(client.extract(file, book, account, lookup)).rejects.toThrow(
                'External service client error [BAD_REQUEST]: Invalid request'
            );
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        });

        // Verifies rate-limit responses remain retryable even though they are HTTP 4xx.
        it('should retry on HTTP 429 rate limit response', async () => {
            const rateLimitResponse: ExternalExtractorResponse = {
                success: false,
                error: { code: 'RATE_LIMITED', message: 'Too many requests' },
            };
            const successResponse: ExternalExtractorResponse = {
                success: true,
                data: {
                    transactions: [
                        { date: '2025-01-15', description: 'Retry after rate limit', amount: 100, properties: {} },
                    ],
                },
            };

            let callCount = 0;
            globalThis.fetch = mock(async () => {
                callCount++;
                if (callCount === 1) {
                    return new Response(JSON.stringify(rateLimitResponse), {
                        status: 429,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                return new Response(JSON.stringify(successResponse), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }) as unknown as typeof fetch;

            const file = createMockFile('test.csv', 'base64==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            const result = await client.extract(file, book, account, lookup);

            expect(result.transactions[0].description).toBe('Retry after rate limit');
            expect(callCount).toBe(2);
        });

        // Verifies application-level parser errors fail immediately without retries.
        it('should throw on success:false response', async () => {
            const errorResponse: ExternalExtractorResponse = {
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Invalid file format' },
            };

            globalThis.fetch = mock(
                async () =>
                    new Response(JSON.stringify(errorResponse), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
            ) as unknown as typeof fetch;

            const file = createMockFile('test.csv', 'base64==', 'text/csv');
            const book = createMockBook();
            const account = createMockAccount('acc_1', 'Bank');
            const lookup = { url: TEST_URL, source: 'account' as const, account };

            await expect(client.extract(file, book, account, lookup)).rejects.toThrow(
                'External service returned error [VALIDATION_ERROR]: Invalid file format'
            );
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        });
    });
});
