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

    describe('lookupPrompts', () => {
        it('migrates legacy account prompts to parser properties and removes the old properties in one update', async () => {
            const properties: Record<string, string> = {
                [AGENT_PARSER_TRANSACTION_PROPERTY]: 'Existing transaction instructions',
                [AGENT_PROMPT_TRANSACTION_PROPERTY]: 'Old transaction instructions',
                [AGENT_PROMPT_TRANSACTIONS_PROPERTY]: 'Old statement instructions',
                [AGENT_PROMPT_FILE_PROPERTY]: 'Old file instructions',
                [AGENT_PROMPT_PROPERTY]: 'Generic instructions',
            };
            const account = createMockAccount('acc_1', 'Bank', properties);
            mockAccounts.set('acc_1', account);

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { account_id_: 'acc_1' }) });
            const resolution = context?.getPrompt('transactions');

            expect(properties[AGENT_PARSER_TRANSACTION_PROPERTY]).toBe('Existing transaction instructions');
            expect(properties[AGENT_PARSER_TRANSACTIONS_PROPERTY]).toBe('Old statement instructions');
            expect(properties[AGENT_PARSER_FILE_PROPERTY]).toBe('Old file instructions');
            expect(properties).not.toHaveProperty(AGENT_PROMPT_TRANSACTION_PROPERTY);
            expect(properties).not.toHaveProperty(AGENT_PROMPT_TRANSACTIONS_PROPERTY);
            expect(properties).not.toHaveProperty(AGENT_PROMPT_FILE_PROPERTY);
            expect(properties).not.toHaveProperty(AGENT_PROMPT_PROPERTY);
            expect(account.update).toHaveBeenCalledTimes(1);
            expect(resolution?.prompt).toBe('Old statement instructions');
            expect(resolution?.sourceProperty).toBe(AGENT_PARSER_TRANSACTIONS_PROPERTY);
            expect(resolution?.targetProperty).toBe(AGENT_PARSER_TRANSACTIONS_PROPERTY);
        });

        it('migrates a generic prompt on an explicitly selected group', async () => {
            const properties: Record<string, string> = { [AGENT_PROMPT_PROPERTY]: 'Generic group instructions' };
            const group = createMockGroup('grp_1', 'Statements', properties);
            mockBook = {
                ...mockBook,
                getGroup: mock(async (id: string) => (id === 'grp_1' ? group : undefined)),
            } as unknown as Book;

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { group_id_: 'grp_1' }) });

            expect(context?.getPrompt('file').prompt).toBe('Generic group instructions');
            expect(properties[AGENT_PARSER_TRANSACTION_PROPERTY]).toBe('Generic group instructions');
            expect(properties[AGENT_PARSER_TRANSACTIONS_PROPERTY]).toBe('Generic group instructions');
            expect(properties[AGENT_PARSER_FILE_PROPERTY]).toBe('Generic group instructions');
            expect(properties).not.toHaveProperty(AGENT_PROMPT_PROPERTY);
            expect(group.update).toHaveBeenCalledTimes(1);
        });

        it('continues prompt lookup when lazy migration persistence fails', async () => {
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_PROMPT_TRANSACTIONS_PROPERTY]: 'Statement instructions',
            });
            account.update = mock(async () => {
                throw new Error('migration failed');
            });
            mockAccounts.set('acc_1', account);

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { account_id_: 'acc_1' }) });

            expect(context?.getPrompt('transactions').prompt).toBe('Statement instructions');
        });

        it('resolves purpose-specific parser instructions from the matched account', async () => {
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Extract many transactions',
            });
            mockAccounts.set('acc_1', account);

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { account_id_: 'acc_1' }) });
            const resolution = context?.getPrompt('transactions');

            expect(context?.account?.getId()).toBe('acc_1');
            expect(resolution?.prompt).toBe('Extract many transactions');
            expect(resolution?.promptEntity).toBe(account);
            expect(resolution?.sourceProperty).toBe(AGENT_PARSER_TRANSACTIONS_PROPERTY);
            expect(resolution?.targetProperty).toBe(AGENT_PARSER_TRANSACTIONS_PROPERTY);
        });

        it('migrates legacy agent_prompt while targeting the parser property', async () => {
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_PROMPT_PROPERTY]: 'Legacy prompt',
            });
            mockAccounts.set('acc_1', account);

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { account_id_: 'acc_1' }) });
            const resolution = context?.getPrompt('transactions');

            expect(resolution?.prompt).toBe('Legacy prompt');
            expect(resolution?.promptEntity).toBe(account);
            expect(resolution?.sourceProperty).toBe(AGENT_PARSER_TRANSACTIONS_PROPERTY);
            expect(resolution?.targetProperty).toBe(AGENT_PARSER_TRANSACTIONS_PROPERTY);
        });

        it('uses account parser instructions before inherited group instructions', async () => {
            const group = createMockGroup('grp_1', 'Banks', {
                [AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Group transactions prompt',
            });
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Account transactions prompt',
            }, [group]);
            mockAccounts.set('acc_1', account);

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { account_id_: 'acc_1' }) });
            const resolution = context?.getPrompt('transactions');

            expect(resolution?.prompt).toBe('Account transactions prompt');
            expect(resolution?.promptEntity).toBe(account);
            expect(resolution?.sourceProperty).toBe(AGENT_PARSER_TRANSACTIONS_PROPERTY);
        });

        it('writes back to the group that supplied inherited parser instructions', async () => {
            const group = createMockGroup('grp_1', 'Banks', {
                [AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Group transactions prompt',
            });
            const account = createMockAccount('acc_1', 'Bank', {}, [group]);
            mockAccounts.set('acc_1', account);

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { account_id_: 'acc_1' }) });
            const resolution = context?.getPrompt('transactions');

            expect(resolution?.account).toBe(account);
            expect(resolution?.prompt).toBe('Group transactions prompt');
            expect(resolution?.promptEntity).toBe(group);
            expect(resolution?.sourceProperty).toBe(AGENT_PARSER_TRANSACTIONS_PROPERTY);
        });

        it('returns the matched entity as writeback target when no stored instructions exist', async () => {
            const account = createMockAccount('acc_1', 'Bank');
            mockAccounts.set('acc_1', account);

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { account_id_: 'acc_1' }) });
            const resolution = context?.getPrompt('transaction');

            expect(resolution?.prompt).toBeUndefined();
            expect(resolution?.promptEntity).toBe(account);
            expect(resolution?.sourceProperty).toBeUndefined();
            expect(resolution?.targetProperty).toBe(AGENT_PARSER_TRANSACTION_PROPERTY);
        });

        it('resolves parser instructions from a transaction-side account', async () => {
            const creditAccount = createMockAccount('credit_1', 'Revenue');
            const debitAccount = createMockAccount('debit_1', 'Expenses', {
                [AGENT_PARSER_TRANSACTION_PROPERTY]: 'Debit transaction prompt',
            });

            const context = await service.lookupPrompts({ book: mockBook, transaction: createMockTransaction({}, creditAccount, debitAccount) });
            const resolution = context?.getPrompt('transaction');

            expect(resolution?.account).toBe(debitAccount);
            expect(resolution?.prompt).toBe('Debit transaction prompt');
            expect(resolution?.promptEntity).toBe(debitAccount);
            expect(resolution?.sourceProperty).toBe(AGENT_PARSER_TRANSACTION_PROPERTY);
        });

        it('returns explicit group context and purpose-specific writeback target', async () => {
            const group = createMockGroup('grp_1', 'Statements');
            mockBook = {
                ...mockBook,
                getGroup: mock(async (id: string) => (id === 'grp_1' ? group : undefined)),
            } as unknown as Book;

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { group_id_: 'grp_1' }) });
            const resolution = context?.getPrompt('transactions');

            expect(context?.group).toBe(group);
            expect(resolution?.prompt).toBeUndefined();
            expect(resolution?.promptEntity).toBe(group);
            expect(resolution?.targetProperty).toBe(AGENT_PARSER_TRANSACTIONS_PROPERTY);
        });

        it('does not expose filename account context when explicit group context wins', async () => {
            const group = createMockGroup('grp_1', 'Statements');
            const account = createMockAccount('acc_1', 'statement');
            mockAccounts.set('acc_1', account);
            mockBook = {
                ...mockBook,
                getGroup: mock(async (id: string) => (id === 'grp_1' ? group : undefined)),
            } as unknown as Book;

            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('statement.csv', { group_id_: 'grp_1' }) });
            const resolution = context?.getPrompt('transactions');

            expect(context?.account).toBeUndefined();
            expect(context?.group).toBe(group);
            expect(resolution?.promptEntity).toBe(group);
        });

        it('returns null when no account or group context matches', async () => {
            const context = await service.lookupPrompts({ book: mockBook, file: createMockFile('random.pdf') });
            expect(context).toBeNull();
        });
    });

    describe('lookupParserUrl', () => {
        it('resolves purpose-specific parser URLs by purpose', async () => {
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_PARSER_URL_TRANSACTION_PROPERTY]: 'https://transaction-parser.example.com',
                [AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://transactions-parser.example.com',
                [AGENT_PARSER_URL_FILE_PROPERTY]: 'https://file-parser.example.com',
            });

            const transactionParser = await service.lookupParserUrl({ book: mockBook, account, purpose: 'transaction' });
            const transactionsParser = await service.lookupParserUrl({ book: mockBook, account, purpose: 'transactions' });
            const fileParser = await service.lookupParserUrl({ book: mockBook, account, purpose: 'file' });

            expect(transactionParser?.url).toBe('https://transaction-parser.example.com');
            expect(transactionsParser?.url).toBe('https://transactions-parser.example.com');
            expect(fileParser?.url).toBe('https://file-parser.example.com');
        });

        it('finds parser URL from transaction side accounts even when no prompt exists', async () => {
            const creditAccount = createMockAccount('credit_1', 'Revenue', {
                [AGENT_PARSER_URL_TRANSACTION_PROPERTY]: 'https://invoice-parser.example.com',
            });
            const debitAccount = createMockAccount('debit_1', 'Bank');
            const transaction = createMockTransaction({}, creditAccount, debitAccount);

            const result = await service.lookupParserUrl({ book: mockBook, transaction, purpose: 'transaction' });

            expect(result?.url).toBe('https://invoice-parser.example.com');
            expect(result?.source).toBe('account');
            expect(result?.account).toBe(creditAccount);
        });

        it('carries transaction-side account context when falling back to a book parser URL', async () => {
            const creditAccount = createMockAccount('credit_1', 'Revenue');
            const debitAccount = createMockAccount('debit_1', 'Bank');
            const transaction = createMockTransaction({}, creditAccount, debitAccount);
            mockBookProperties[AGENT_PARSER_URL_TRANSACTION_PROPERTY] = 'https://book-invoice-parser.example.com';

            const result = await service.lookupParserUrl({ book: mockBook, transaction, purpose: 'transaction' });

            expect(result?.url).toBe('https://book-invoice-parser.example.com');
            expect(result?.source).toBe('book');
            expect(result?.account).toBe(creditAccount);
        });

        it('uses explicit group parser URL only when no account context is provided', async () => {
            const accountGroup = createMockGroup('grp_account', 'Account Group', {
                [AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://account-group-parser.example.com',
            });
            const explicitGroup = createMockGroup('grp_explicit', 'Explicit Group', {
                [AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://explicit-group-parser.example.com',
            });
            const account = createMockAccount('acc_1', 'Bank', {}, [accountGroup]);

            const accountScopedResult = await service.lookupParserUrl({ book: mockBook, account, group: explicitGroup, purpose: 'transactions' });
            const groupScopedResult = await service.lookupParserUrl({ book: mockBook, group: explicitGroup, purpose: 'transactions' });

            expect(accountScopedResult?.url).toBe('https://account-group-parser.example.com');
            expect(groupScopedResult?.url).toBe('https://explicit-group-parser.example.com');
        });
    });

    describe('lookupTransactionsParserUrl', () => {
        it('finds transactions parser URL from account, account group, then book', async () => {
            const group = createMockGroup('grp_1', 'Banks', {
                [AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://group-parser.example.com',
            });
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://account-parser.example.com',
            }, [group]);
            mockBookProperties[AGENT_PARSER_URL_TRANSACTIONS_PROPERTY] = 'https://book-parser.example.com';

            const result = await service.lookupTransactionsParserUrl({ book: mockBook, account });

            expect(result?.url).toBe('https://account-parser.example.com');
            expect(result?.source).toBe('account');
            expect(result?.account).toBe(account);
        });

        it('uses account group parser URL when account has none', async () => {
            const group = createMockGroup('grp_1', 'Banks', {
                [AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://group-parser.example.com',
            });
            const account = createMockAccount('acc_1', 'Bank', {}, [group]);

            const result = await service.lookupTransactionsParserUrl({ book: mockBook, account });

            expect(result?.url).toBe('https://group-parser.example.com');
            expect(result?.source).toBe('group');
            expect(result?.group).toBe(group);
        });

        it('uses explicit group parser URL for group-scoped checks', async () => {
            const group = createMockGroup('grp_1', 'Statements', {
                [AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://group-parser.example.com',
            });

            const result = await service.lookupTransactionsParserUrl({ book: mockBook, group });

            expect(result?.url).toBe('https://group-parser.example.com');
            expect(result?.source).toBe('group');
            expect(result?.group).toBe(group);
        });

        it('uses book parser URL when no account or group URL is configured', async () => {
            mockBookProperties[AGENT_PARSER_URL_TRANSACTIONS_PROPERTY] = 'https://book-parser.example.com';

            const result = await service.lookupTransactionsParserUrl({ book: mockBook });

            expect(result?.url).toBe('https://book-parser.example.com');
            expect(result?.source).toBe('book');
        });

        it('does not fall back to legacy agent_parser_url', async () => {
            const account = createMockAccount('acc_1', 'Bank', {
                [AGENT_PARSER_URL_PROPERTY]: 'https://legacy-parser.example.com',
            });
            mockBookProperties[AGENT_PARSER_URL_PROPERTY] = 'https://legacy-book-parser.example.com';

            const result = await service.lookupTransactionsParserUrl({ book: mockBook, account });

            expect(result).toBeNull();
        });
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
