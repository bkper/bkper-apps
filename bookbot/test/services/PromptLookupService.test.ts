import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { PromptLookupService } from '../../src/services/PromptLookupService.js';
import { Book, Account, Transaction, File, Group } from 'bkper-js';
import {
    AGENT_PARSER_URL_FILE_PROPERTY,
    AGENT_PARSER_URL_PROPERTY,
    AGENT_PROMPT_SKIP_PROPERTY,
    AGENT_EXCLUDED_PROPERTIES_PROPERTY,
    AGENT_PARSER_URL_TRANSACTION_PROPERTY,
    AGENT_PARSER_URL_TRANSACTIONS_PROPERTY,
    AGENT_PROMPT_PROPERTY,
    AGENT_PROMPT_TRANSACTION_PROPERTY,
    AGENT_PROMPT_TRANSACTIONS_PROPERTY,
    AGENT_PROMPT_FILE_PROPERTY,
    AGENT_PARSER_TRANSACTION_PROPERTY,
    AGENT_PARSER_TRANSACTIONS_PROPERTY,
    AGENT_PARSER_FILE_PROPERTY,
} from '../../src/constants.js';

describe('PromptLookupService', () => {
    let service: PromptLookupService;
    let mockBook: Book;
    let mockAccounts: Map<string, Account>;
    let mockBookProperties: Record<string, string>;

    function createMockAccount(id: string, name: string, properties: Record<string, string> = {}, groups: Group[] = []): Account {
        return {
            getId: () => id,
            getName: () => name,
            getProperties: () => properties,
            getProperty: (key: string) => properties[key] || undefined,
            setProperty: mock((key: string, value: string | null | undefined) => {
                if (value) properties[key] = value;
                else delete properties[key];
            }),
            deleteProperty: mock((key: string) => delete properties[key]),
            update: mock(async () => undefined),
            getGroups: async () => groups,
        } as unknown as Account;
    }

    function createMockGroup(id: string, name: string, properties: Record<string, string> = {}): Group {
        return {
            getId: () => id,
            getName: () => name,
            getProperties: () => properties,
            getProperty: (key: string) => properties[key] || undefined,
            setProperty: mock((key: string, value: string | null | undefined) => {
                if (value) properties[key] = value;
                else delete properties[key];
            }),
            deleteProperty: mock((key: string) => delete properties[key]),
            update: mock(async () => undefined),
        } as unknown as Group;
    }

    function createMockFile(name: string, properties: Record<string, string> = {}): File {
        return {
            getName: () => name,
            getProperty: (key: string, ...fallbacks: string[]) => {
                if (properties[key]) return properties[key];
                for (const fallback of fallbacks) {
                    if (properties[fallback]) return properties[fallback];
                }
                return undefined;
            },
        } as unknown as File;
    }

    function createMockTransaction(properties: Record<string, string> = {}, creditAccount?: Account, debitAccount?: Account): Transaction {
        return {
            getProperty: (key: string) => properties[key] || undefined,
            getCreditAccount: async () => creditAccount,
            getDebitAccount: async () => debitAccount,
        } as unknown as Transaction;
    }

    beforeEach(() => {
        service = new PromptLookupService();
        mockAccounts = new Map();
        mockBookProperties = {};
        mockBook = {
            getAccount: mock(async (idOrName: string) => {
                if (mockAccounts.has(idOrName)) {
                    return mockAccounts.get(idOrName);
                }
                for (const account of mockAccounts.values()) {
                    if (account.getName()?.toLowerCase() === idOrName.toLowerCase()) {
                        return account;
                    }
                }
                return undefined;
            }),
            getAccounts: mock(async () => [...mockAccounts.values()]),
            getGroup: mock(async () => undefined),
            getProperty: (key: string) => mockBookProperties[key] || undefined,
        } as unknown as Book;
    });

    describe('lookupDiscoveryExamples', () => {
        it('uses the account examples before group and book examples', async () => {
            const group = createMockGroup('grp_1', 'Banks', {
                agent_discovery_examples: 'group input -> group output',
            });
            const account = createMockAccount('acc_1', 'Bank', {
                agent_discovery_examples: 'account input -> account output',
            }, [group]);
            mockBookProperties.agent_discovery_examples = 'book input -> book output';

            const result = await service.lookupDiscoveryExamples({ book: mockBook, account });

            expect(result).toBe('account input -> account output');
        });

        it('uses the first non-empty account group examples before the book examples', async () => {
            const emptyGroup = createMockGroup('grp_empty', 'Empty', {
                agent_discovery_examples: '   ',
            });
            const configuredGroup = createMockGroup('grp_configured', 'Configured', {
                agent_discovery_examples: 'group input -> group output',
            });
            const laterGroup = createMockGroup('grp_later', 'Later', {
                agent_discovery_examples: 'later input -> later output',
            });
            const account = createMockAccount('acc_1', 'Bank', {}, [emptyGroup, configuredGroup, laterGroup]);
            mockBookProperties.agent_discovery_examples = 'book input -> book output';

            const result = await service.lookupDiscoveryExamples({ book: mockBook, account });

            expect(result).toBe('group input -> group output');
        });

        it('uses book examples when no known account examples resolve', async () => {
            mockBookProperties.agent_discovery_examples = 'book input -> book output';

            const result = await service.lookupDiscoveryExamples({ book: mockBook });

            expect(result).toBe('book input -> book output');
        });
    });

    describe('lookupPropertySkipKeys', () => {
        // Confirms comma- and whitespace-separated keys are normalized and deduplicated.
        it('parses and normalizes agent_excluded_properties', async () => {
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_EXCLUDED_PROPERTIES_PROPERTY]: ' Category, VENDOR category ',
            });

            const result = await service.lookupPropertySkipKeys({ book: mockBook, account });

            expect([...result]).toEqual(['category', 'vendor']);
        });

        it('prefers agent_excluded_properties over the legacy property on the same entity without modifying either', async () => {
            const properties = {
                [AGENT_EXCLUDED_PROPERTIES_PROPERTY]: 'new_key',
                [AGENT_PROMPT_SKIP_PROPERTY]: 'legacy_key',
            };
            const account = createMockAccount('acc_1', 'Bank', properties);

            const result = await service.lookupPropertySkipKeys({ book: mockBook, account });

            expect([...result]).toEqual(['new_key']);
            expect(properties[AGENT_EXCLUDED_PROPERTIES_PROPERTY]).toBe('new_key');
            expect(properties[AGENT_PROMPT_SKIP_PROPERTY]).toBe('legacy_key');
            expect(account.update).not.toHaveBeenCalled();
        });

        it('falls back to legacy agent_prompt_skip', async () => {
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_PROMPT_SKIP_PROPERTY]: 'legacy_key',
            });

            const result = await service.lookupPropertySkipKeys({ book: mockBook, account });

            expect([...result]).toEqual(['legacy_key']);
            expect(account.update).not.toHaveBeenCalled();
        });

        // Confirms the account value overrides group and book values.
        it('uses the account value before group and book values', async () => {
            const group = createMockGroup('grp_1', 'Banks', {
                [AGENT_EXCLUDED_PROPERTIES_PROPERTY]: 'group_key',
            });
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_PROMPT_SKIP_PROPERTY]: 'account_legacy_key',
            }, [group]);
            mockBookProperties[AGENT_EXCLUDED_PROPERTIES_PROPERTY] = 'book_key';

            const result = await service.lookupPropertySkipKeys({ book: mockBook, account });

            expect([...result]).toEqual(['account_legacy_key']);
        });

        // Confirms the first account group with a non-empty value wins.
        it('uses the first configured account group before the book', async () => {
            const emptyGroup = createMockGroup('grp_empty', 'Empty Group');
            const configuredGroup = createMockGroup('grp_configured', 'Configured Group', {
                [AGENT_EXCLUDED_PROPERTIES_PROPERTY]: 'group_key',
            });
            const laterGroup = createMockGroup('grp_later', 'Later Group', {
                [AGENT_EXCLUDED_PROPERTIES_PROPERTY]: 'later_key',
            });
            const account = createMockAccount('acc_1', 'Bank', {}, [emptyGroup, configuredGroup, laterGroup]);
            mockBookProperties[AGENT_EXCLUDED_PROPERTIES_PROPERTY] = 'book_key';

            const result = await service.lookupPropertySkipKeys({ book: mockBook, account });

            expect([...result]).toEqual(['group_key']);
        });

        // Confirms the book value is used when account and account-group values are absent.
        it('falls back to the book value', async () => {
            const account = createMockAccount('acc_1', 'Bank');
            mockBookProperties[AGENT_EXCLUDED_PROPERTIES_PROPERTY] = 'book_key';

            const result = await service.lookupPropertySkipKeys({ book: mockBook, account });

            expect([...result]).toEqual(['book_key']);
        });

        // Confirms group-scoped callers can resolve a group value before the book.
        it('uses an explicitly supplied group when no account value wins', async () => {
            const group = createMockGroup('grp_1', 'Statements', {
                [AGENT_EXCLUDED_PROPERTIES_PROPERTY]: 'group_key',
            });
            mockBookProperties[AGENT_EXCLUDED_PROPERTIES_PROPERTY] = 'book_key';

            const result = await service.lookupPropertySkipKeys({ book: mockBook, group });

            expect([...result]).toEqual(['group_key']);
        });

        // Confirms missing configuration produces an empty normalized set.
        it('returns an empty set when no value is configured', async () => {
            const result = await service.lookupPropertySkipKeys({ book: mockBook });

            expect([...result]).toEqual([]);
        });
    });
});
