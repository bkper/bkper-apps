import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { Discovery } from '../../src/services/DiscoveryService.js';
import { Book, Transaction, Account, TransactionList } from 'bkper-js';
import { ExtractorDescriptionParts } from '../../src/genai/ExtractorDescriptionParts.js';
import { AppContext } from '../../src/AppContext.js';
import { PromptLookupService } from '../../src/services/PromptLookupService.js';
import { AGENT_DISCOVERED_PROPERTIES_PROPERTY, PARSED_ACCOUNT_NAME_PROPERTY } from '../../src/constants.js';

declare global {
    interface Env {
        // Mock env for testing
    }
}

describe('Discovery', () => {
    let mockBook: Book;
    let mockAccounts: Map<string, Account>;
    let mockTransactions: Transaction[];
    let mockContext: AppContext;

    beforeEach(async () => {
        mockAccounts = new Map();
        mockTransactions = [];

        // Mock AppContext with required dependencies
        mockContext = {
            env: {} as Env,
            createExtractorDescriptionParts: () => ({
                extract: async (description: string) => {
                    // Simple mock that extracts basic words and hashtags, prioritizing hashtags
                    const words = description.split(' ').filter(word => word.length > 2);
                    const hashtags = words.filter(word => word.startsWith('#'));
                    const regularWords = words.filter(word => !word.startsWith('#'));
                    // Return hashtags first, then regular words
                    return [...hashtags, ...regularWords].slice(0, 3);
                },
            }),
            promptLookupService: new PromptLookupService(),
        } as unknown as AppContext;

        // Mock the ExtractorDescriptionParts.extract method to return meaningful parts
        spyOn(ExtractorDescriptionParts.prototype, 'extract').mockImplementation(
            async (description: string) => {
                // Simple mock that extracts basic words and hashtags, prioritizing hashtags
                const words = description.split(' ').filter(word => word.length > 2);
                const hashtags = words.filter(word => word.startsWith('#'));
                const regularWords = words.filter(word => !word.startsWith('#'));
                // Return hashtags first, then regular words
                return [...hashtags, ...regularWords].slice(0, 3);
            }
        );

        setupMockAccounts();
        await setupMockTransactions();

        mockBook = {
            getId: () => 'book_id',
            getAccount: mock(async (idOrName: string) => {
                if (mockAccounts.has(idOrName)) {
                    return mockAccounts.get(idOrName);
                }
                for (const account of mockAccounts.values()) {
                    if ((account.getName() as string).toLowerCase() === idOrName.toLowerCase()) {
                        return account;
                    }
                }
                return undefined;
            }),
            getProperty: () => undefined,
            listTransactions: mock(async (query: string, limit?: number) => {
                const maxLimit = limit || 5;
                const filtered = await filterTransactionsByQuery(query);
                const limitedResults = filtered.slice(0, maxLimit);
                return {
                    getItems: () => limitedResults,
                    getCursor: () => undefined,
                    getAccount: async () => undefined,
                    getFirst: () => limitedResults[0],
                    size: () => limitedResults.length,
                } as TransactionList;
            }),
        } as unknown as Book;
    });

    afterEach(() => {
        // Bun test handles mock cleanup automatically
    });

    function setupMockAccounts() {
        const accounts = [
            { id: 'bank_id', name: 'Bank' },
            { id: 'cash_id', name: 'Cash' },
            { id: 'credit_card_id', name: 'Credit Card' },
            { id: 'gas_id', name: 'Gas' },
            { id: 'job_id', name: 'My Day Job' },
            { id: 'auto_insurance_id', name: 'Auto Insurance' },
            { id: 'auto_repair_id', name: 'Auto Repair' },
            { id: 'stocks_id', name: 'Stocks' },
            { id: 'rental_id', name: 'Rental' },
            { id: 'client_a_id', name: 'Client A' },
            { id: 'clients_a_tax_id', name: 'Clients A Tax' },
        ];

        accounts.forEach(({ id, name }) => {
            const properties: { [key: string]: string } = {};
            const account = {
                getId: () => id,
                getName: () => name,
                getProperty: (key: string) => properties[key] || undefined,
                getGroups: async () => [],
                setProperty: (key: string, value: string) => {
                    properties[key] = value;
                    return account; // Return self to allow chaining
                },
                update: async () => account, // Mock update method
            } as unknown as Account;
            mockAccounts.set(id, account);
        });
    }

    async function setupMockTransactions() {
        const bankAcc = mockAccounts.get('bank_id')!;
        const gasAcc = mockAccounts.get('gas_id')!;
        const autoRepairAcc = mockAccounts.get('auto_repair_id')!;
        const jobAcc = mockAccounts.get('job_id')!;

        mockTransactions.push(
            createMockTransaction(
                'o rato roeu a roupa do rei de roma',
                bankAcc,
                gasAcc,
                'foo@example.com'
            ),
            createMockTransaction(
                'o rato roeu a roupa do rei da grecia',
                bankAcc,
                autoRepairAcc,
                'bar@example.com'
            ),
            createMockTransaction(
                'TBI 1654.25858-9     C/C',
                bankAcc,
                autoRepairAcc,
                'bar@example.com'
            ),
            createMockTransaction(
                'MOV TIT COB DISP 05/09S',
                bankAcc,
                autoRepairAcc,
                'bar@example.com'
            ),
            createMockTransaction('#granvitara', bankAcc, gasAcc),
            createMockTransaction('revisao #auto', bankAcc, autoRepairAcc),
            createMockTransaction(
                'montly payment without taxes',
                jobAcc,
                bankAcc,
                'test@example.com'
            ),
            createMockTransaction('MONTLY paYMent withOUT Taxes', jobAcc, bankAcc),
            createMockTransaction('montly payment without "Taxes"', jobAcc, bankAcc)
        );
    }

    function createMockTransaction(
        description: string,
        creditAccount?: Account,
        debitAccount?: Account,
        createdByUsername?: string,
        properties?: { [key: string]: string }
    ): Transaction {
        const tags = extractTags(description);

        const payload: any = {
            description,
            tags,
            creditAccount: creditAccount ? { id: creditAccount.getId() } : undefined,
            debitAccount: debitAccount ? { id: debitAccount.getId() } : undefined,
            properties: properties ? { ...properties } : {},
        };

        const transaction = {
            payload,
            getDescription: () => description,
            getTags: () => tags,
            getDate: () => '2025-01-01',
            getAmount: () => undefined,
            getCreditAccount: async () =>
                payload.creditAccount ? await mockBook.getAccount(payload.creditAccount.id) : undefined,
            getDebitAccount: async () =>
                payload.debitAccount ? await mockBook.getAccount(payload.debitAccount.id) : undefined,
            setCreditAccount: (account: Account) => {
                payload.creditAccount = { id: account.getId() };
                return transaction as Transaction;
            },
            setDebitAccount: (account: Account) => {
                payload.debitAccount = { id: account.getId() };
                return transaction as Transaction;
            },
            getBook: () => mockBook,
            getCreatedBy: () => createdByUsername,
            getVisibleProperties: () => {
                const visible: { [key: string]: string } = {};
                for (const [key, value] of Object.entries(payload.properties)) {
                    if (!key.endsWith('_') && typeof value === 'string') {
                        visible[key] = value;
                    }
                }
                return visible;
            },
            getProperty: (key: string) => {
                if (key === 'account_name' && (transaction as any).accountNameProperty) {
                    return (transaction as any).accountNameProperty;
                }
                return payload.properties[key] || undefined;
            },
            setProperty: (key: string, value: string) => {
                if (key === 'account_name') {
                    (transaction as any).accountNameProperty = value;
                } else {
                    payload.properties[key] = value;
                }
            },
            deleteProperty: (key: string) => {
                if (key === 'account_name') {
                    delete (transaction as any).accountNameProperty;
                } else {
                    delete payload.properties[key];
                }
            },
        } as unknown as Transaction;

        return transaction;
    }

    function extractTags(description: string): string[] {
        const tagMatches = description.match(/#\w+/g);
        return tagMatches ? tagMatches.map(tag => tag.substring(1)) : [];
    }

    async function filterTransactionsByQuery(query: string): Promise<Transaction[]> {
        const results: Transaction[] = [];

        for (const tx of mockTransactions) {
            const createdByMatch = query.match(/createdBy:(\S+)/);
            const accountMatch = query.match(/account:\s*'([^']+)'/);

            let mainQuery = query
                .replace(/createdBy:\S+/g, '')
                .replace(/account:\s*'[^']+'/g, '')
                .replace(/is:posted/g, '')
                .trim();

            const quotedMatch = mainQuery.match(/"([^"]+)"/);
            if (quotedMatch) {
                mainQuery = quotedMatch[1];
            }

            let matchesFilters = true;

            if (createdByMatch) {
                const requiredUsername = createdByMatch[1];
                if ((tx as any).getCreatedBy?.() !== requiredUsername) {
                    matchesFilters = false;
                }
            }

            if (matchesFilters && accountMatch) {
                const requiredAccountName = accountMatch[1];
                const creditAccount = await tx.getCreditAccount();
                const debitAccount = await tx.getDebitAccount();
                const hasAccountMatch =
                    (creditAccount &&
                        creditAccount.getName()?.toLowerCase() ===
                            requiredAccountName.toLowerCase()) ||
                    (debitAccount &&
                        debitAccount.getName()?.toLowerCase() ===
                            requiredAccountName.toLowerCase());
                if (!hasAccountMatch) {
                    matchesFilters = false;
                }
            }

            if (matchesFilters && mainQuery) {
                const description = tx.getDescription();
                if (!description) {
                    matchesFilters = false;
                } else {
                    const txTags = tx.getTags();
                    let hasTagMatch = false;
                    if (txTags && txTags.length > 0) {
                        const cleanQuery = mainQuery.replace('#', '').trim();
                        if (txTags.some(tag => tag.toLowerCase() === cleanQuery.toLowerCase())) {
                            hasTagMatch = true;
                        }
                    }

                    if (!hasTagMatch) {
                        const descLower = description.toLowerCase();
                        const queryLower = mainQuery.toLowerCase();

                        if (!descLower.includes(queryLower)) {
                            matchesFilters = false;
                        }
                    }
                }
            }

            if (matchesFilters) {
                results.push(tx);
            }
        }
        return results;
    }

    describe('find_accounts', () => {
        it('should find accounts for basic description', async () => {
            const draft = createMockTransaction('MONTLY paYMent withOUT Taxes');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBeDefined();
            expect((await draft.getDebitAccount())?.getId()).toBeDefined();
        });
    });

    describe('should_find_accounts', () => {
        it('should find accounts with quoted text', async () => {
            const draft = createMockTransaction('montly payment without "Taxes"');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBeDefined();
            expect((await draft.getDebitAccount())?.getId()).toBeDefined();
        });
    });

    describe('find_accounts_by_description', () => {
        it('should find accounts by description pattern', async () => {
            const draft = createMockTransaction('o rato roeu');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
            expect((await draft.getDebitAccount())?.getId()).toBeDefined();
        });

        it('should find accounts for TBI transaction', async () => {
            const draft = createMockTransaction('TBI 1654.25858-9     C/C');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
            expect((await draft.getDebitAccount())?.getId()).toBe('auto_repair_id');
        });

        it('should find accounts for MOV TIT COB DISP transaction', async () => {
            const draft = createMockTransaction('MOV TIT COB DISP');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
            expect((await draft.getDebitAccount())?.getId()).toBe('auto_repair_id');
        });
    });

    describe('do_NOT_change_account_side_credit_move_to_debit', () => {
        it('should not change existing credit account', async () => {
            const draft = createMockTransaction('Montly payment');
            draft.setCreditAccount(mockAccounts.get('bank_id')!);

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
            expect(await draft.getDebitAccount()).toBeUndefined();
        });
    });

    describe('discove_debit_side_when_credit_set', () => {
        it('should discover debit side when credit is set', async () => {
            const draft = createMockTransaction('Montly payment');
            draft.setCreditAccount(mockAccounts.get('job_id')!);

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBe('job_id');
            expect((await draft.getDebitAccount())?.getId()).toBe('bank_id');
        });
    });

    describe('discove_credit_side_when_debit_set', () => {
        it('should discover credit side when debit is set', async () => {
            const draft = createMockTransaction('Montly payment');
            draft.setDebitAccount(mockAccounts.get('bank_id')!);

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBe('job_id');
            expect((await draft.getDebitAccount())?.getId()).toBe('bank_id');
        });
    });

    describe('use_account_property', () => {
        it('should use account_name property', async () => {
            const draft = createMockTransaction('Montly payment');
            (draft as any).setProperty('account_name', 'Bank');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBe('job_id');
            expect((await draft.getDebitAccount())?.getId()).toBe('bank_id');
        });

        it('strips the parsed account name before searching the remaining description', async () => {
            const clientAccount = mockAccounts.get('client_a_id')!;
            const taxAccount = mockAccounts.get('clients_a_tax_id')!;
            mockTransactions.unshift(createMockTransaction('TESTE', taxAccount, clientAccount));
            const draft = createMockTransaction('Client A TESTE');
            draft.setProperty(PARSED_ACCOUNT_NAME_PROPERTY, 'Client A');
            const extract = mock(async (description: string) => description === 'TESTE' ? ['TESTE'] : ['Client A TESTE']);
            const customMockContext = {
                ...mockContext,
                createExtractorDescriptionParts: () => ({ extract }),
            } as unknown as AppContext;

            const discovery = new Discovery(customMockContext);
            await discovery.discover(draft);

            expect(extract).toHaveBeenCalledWith('TESTE', undefined);
            expect((await draft.getCreditAccount())?.getId()).toBe('clients_a_tax_id');
            expect((await draft.getDebitAccount())?.getId()).toBe('client_a_id');
        });
    });

    describe('discover_by_tag', () => {
        it('should discover by granvitara tag', async () => {
            const draft = createMockTransaction('#granvitara');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getDebitAccount())?.getId()).toBe('gas_id');
            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
        });

        it('should discover by auto tag in middle', async () => {
            const draft = createMockTransaction('revisao #auto granvitara');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
            expect((await draft.getDebitAccount())?.getId()).toBe('gas_id');
        });

        it('should discover by granvitara tag at end', async () => {
            const draft = createMockTransaction('revisao auto #granvitara');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getDebitAccount())?.getId()).toBe('gas_id');
            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
        });
    });

    describe('should_discover_by_word_tag_with_no_hash', () => {
        it('should discover by word tag without hash', async () => {
            const draft = createMockTransaction('granvitara');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
            expect((await draft.getDebitAccount())?.getId()).toBe('gas_id');
        });
    });

    describe('discover_by_potential_tag_and_tag', () => {
        it('should not discover when description is empty', async () => {
            const draft = createMockTransaction('');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect(await draft.getDebitAccount()).toBeUndefined();
            expect(await draft.getCreditAccount()).toBeUndefined();
        });

        it('should discover by potential tag and tag', async () => {
            const draft = createMockTransaction('granvitára ou #granvitara');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getDebitAccount())?.getId()).toBe('gas_id');
            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
        });
    });

    describe('discover_by_inside_tag', () => {
        it('should discover by tag inside description', async () => {
            const draft = createMockTransaction('jipe #granvitara');

            const discovery = new Discovery(mockContext);
            await discovery.discover(draft);

            expect((await draft.getDebitAccount())?.getId()).toBe('gas_id');
            expect((await draft.getCreditAccount())?.getId()).toBe('bank_id');
        });
    });

    describe('custom discovery examples', () => {
        it('passes examples resolved from the known account context to description extraction', async () => {
            const description = 'WF HOME MTG DES:AUTO PAY ID:XXXXX37704 INDN:AMIN MOGHADDAS GHOLAMI CO ID:XXXXX87461 WEB';
            const examples = `${description} -> WF HOME MTG DES`;
            const extract = mock(async () => ['WF HOME MTG DES']);
            const lookupDiscoveryExamples = mock(async () => examples);
            const customMockContext = {
                ...mockContext,
                createExtractorDescriptionParts: () => ({ extract }),
                promptLookupService: { lookupDiscoveryExamples },
            } as unknown as AppContext;
            const account = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction(description, account);

            const discovery = new Discovery(customMockContext);
            await discovery.discover(draft);

            expect(lookupDiscoveryExamples).toHaveBeenCalledWith({ book: mockBook, account });
            expect(extract).toHaveBeenCalledWith(description, examples);
        });
    });

    describe('avoid_duplicate_hashtag_queryparts', () => {
        it('should not duplicate queryParts when description contains hashtag that matches tags', async () => {
            const draft = createMockTransaction('#food payment');

            // Create a custom mock context with a spy-able extract method
            const mockExtract = mock(async () => ['#food', 'payment']);
            const customMockContext = {
                ...mockContext,
                createExtractorDescriptionParts: () => ({
                    extract: mockExtract,
                }),
            } as unknown as AppContext;

            const mockListTransactions = spyOn(mockBook, 'listTransactions');

            const discovery = new Discovery(customMockContext);
            await discovery.discover(draft);

            expect(mockExtract).toHaveBeenCalledWith('#food payment', undefined);

            const calls = mockListTransactions.mock.calls;
            const queryParts = calls.map(call => call[0]);

            const foodQueries = queryParts.filter(query => query && query.includes('food'));
            const uniqueFoodQueries = [...new Set(foodQueries)];

            expect(foodQueries.length).toBe(uniqueFoodQueries.length);
        });
    });

    describe('sanitizeQueryParts', () => {
        it('should remove case-insensitive duplicates from description parts', () => {
            const descriptionParts = ['Apple', 'banana', 'APPLE', 'Cherry'];
            const tags: string[] = [];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['banana', 'Cherry', 'Apple']);
        });

        it('should remove duplicates between description and tags', () => {
            const descriptionParts = ['Payment', 'Food'];
            const tags = ['food', 'grocery'];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['Payment', 'Food', 'grocery']);
        });

        it('should handle hashtag variations', () => {
            const descriptionParts = ['#food', 'Payment'];
            const tags = ['food', 'grocery'];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['Payment', '#food', 'grocery']);
        });

        it('should preserve order', () => {
            const descriptionParts = ['Zebra', 'Apple', 'Mango'];
            const tags = ['zebra', 'orange'];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['Zebra', 'Apple', 'Mango', 'orange']);
        });

        it('should respect max description parts limit', () => {
            const descriptionParts = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
            const tags = ['x'];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['A', 'B', 'C', 'D', 'E', 'x']);
        });

        it('should handle empty arrays', () => {
            const descriptionParts: string[] = [];
            const tags: string[] = [];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual([]);
        });

        it('should handle empty description parts with tags', () => {
            const descriptionParts: string[] = [];
            const tags = ['tag1', 'tag2'];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['tag1', 'tag2']);
        });

        it('should handle empty tags with description parts', () => {
            const descriptionParts = ['Part1', 'Part2'];
            const tags: string[] = [];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['Part1', 'Part2']);
        });

        it('should handle hashtag in description and tag without hashtag', () => {
            const descriptionParts = ['#grocery', 'store'];
            const tags = ['grocery', 'food'];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['#grocery', 'store', 'food']);
        });

        it('should handle mixed case hashtags', () => {
            const descriptionParts = ['#Food', 'Payment'];
            const tags = ['FOOD', 'grocery'];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['Payment', '#Food', 'grocery']);
        });

        it('should sort description parts by length descending', () => {
            const descriptionParts = ['PIX', 'Jhon Doe'];
            const tags: string[] = [];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['Jhon Doe', 'PIX']);
        });

        it('should sort description parts by length descending with tags', () => {
            const descriptionParts = ['a', 'very long description'];
            const tags = ['tag1'];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['very long description', 'a', 'tag1']);
        });

        it('should sort and deduplicate correctly', () => {
            const descriptionParts = ['aa', 'bb', 'aa'];
            const tags: string[] = [];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual(['aa', 'bb']);
        });

        it('should respect max parts after sorting', () => {
            const descriptionParts = [
                'short',
                'a very long description here',
                'medium length',
                'another long one',
                'tiny',
                'last one',
            ];
            const tags = ['x'];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual([
                'a very long description here',
                'another long one',
                'medium length',
                'last one',
                'short',
                'x',
            ]);
        });

        it('should prioritize longer parts when sorting before slice', () => {
            const descriptionParts = [
                'short',
                'a very long description here',
                'medium length',
                'another long one',
                'tiny',
                'last one',
            ];
            const tags: string[] = [];

            const discovery = new Discovery(mockContext);
            const result = (discovery as any).sanitizeQueryParts(descriptionParts, tags);

            expect(result).toEqual([
                'a very long description here',
                'another long one',
                'medium length',
                'last one',
                'short',
            ]);
        });
    });

    describe('external_request_counting', () => {
        it('should increment counter on cache miss for listTransactions', async () => {
            const discovery = new Discovery(mockContext);
            const initialCount = discovery.getExternalRequestCount();

            const draft = createMockTransaction('unique description for test');
            await discovery.discover(draft);

            const finalCount = discovery.getExternalRequestCount();
            expect(finalCount).toBeGreaterThan(initialCount);
        });

        it('should increment counter on cache miss for getAccount', async () => {
            const discovery = new Discovery(mockContext);

            const draft = createMockTransaction('test transaction');
            draft.setProperty('account_name', 'Bank');

            const initialCount = discovery.getExternalRequestCount();
            await discovery.discover(draft);
            const finalCount = discovery.getExternalRequestCount();

            expect(finalCount).toBeGreaterThan(initialCount);
        });

        it('should increment counter on cache miss for extractDescriptionParts', async () => {
            const discovery = new Discovery(mockContext);
            const initialCount = discovery.getExternalRequestCount();

            const draft = createMockTransaction('unique description xyz123');
            await discovery.discover(draft);

            const finalCount = discovery.getExternalRequestCount();
            expect(finalCount).toBeGreaterThan(initialCount);
        });

        it('should not increment counter on cache hit', async () => {
            const discovery = new Discovery(mockContext);

            const draft1 = createMockTransaction('same description');
            draft1.setCreditAccount(mockAccounts.get('job_id')!);
            await discovery.discover(draft1);

            const countAfterFirst = discovery.getExternalRequestCount();

            const draft2 = createMockTransaction('same description');
            draft2.setCreditAccount(mockAccounts.get('job_id')!);
            await discovery.discover(draft2);

            const countAfterSecond = discovery.getExternalRequestCount();
            expect(countAfterSecond).toBe(countAfterFirst);
        });

        it('should stop discovery when counter exceeds 950', async () => {
            const discovery = new Discovery(mockContext);

            for (let i = 0; i < 100; i++) {
                const draft = createMockTransaction(`unique transaction ${i}`);
                await discovery.discover(draft);
            }

            const countBefore = discovery.getExternalRequestCount();
            expect(countBefore).toBeGreaterThan(0);

            (discovery as any).externalRequestCount = 951;

            const draft = createMockTransaction('test after limit');
            const result = await discovery.discover(draft);

            expect(result.discovered).toBe(false);
            expect(await draft.getCreditAccount()).toBeUndefined();
            expect(await draft.getDebitAccount()).toBeUndefined();
            expect(discovery.getExternalRequestCount()).toBe(951);
        });

        it('should maintain counter across multiple discover calls', async () => {
            const discovery = new Discovery(mockContext);

            const draft1 = createMockTransaction('first unique transaction abc');
            await discovery.discover(draft1);
            const countAfterFirst = discovery.getExternalRequestCount();

            const draft2 = createMockTransaction('second unique transaction def');
            await discovery.discover(draft2);
            const countAfterSecond = discovery.getExternalRequestCount();

            expect(countAfterSecond).toBeGreaterThan(countAfterFirst);
        });

        it('should have independent counters for different Discovery instances', async () => {
            const discovery1 = new Discovery(mockContext);
            const discovery2 = new Discovery(mockContext);

            const draft1 = createMockTransaction('transaction for instance 1');
            await discovery1.discover(draft1);

            const count1 = discovery1.getExternalRequestCount();
            const count2 = discovery2.getExternalRequestCount();

            expect(count1).toBeGreaterThan(0);
            expect(count2).toBe(0);
        });
    });

    describe('cache_listTransactions', () => {
        it('should cache transactions for same query in same Discovery instance', async () => {
            const discovery = new Discovery(mockContext);
            const mockListTransactions = spyOn(mockBook, 'listTransactions');

            const draft1 = createMockTransaction('MONTLY paYMent withOUT Taxes');
            const draft2 = createMockTransaction('MONTLY paYMent withOUT Taxes');

            await discovery.discover(draft1);
            const firstCallCount = mockListTransactions.mock.calls.length;

            await discovery.discover(draft2);
            const secondCallCount = mockListTransactions.mock.calls.length;

            expect(secondCallCount).toBe(firstCallCount);
        });

        it('should use cache across multiple discover calls with overlapping queries', async () => {
            const discovery = new Discovery(mockContext);
            const mockListTransactions = spyOn(mockBook, 'listTransactions');

            const draft1 = createMockTransaction('montly payment');
            draft1.setCreditAccount(mockAccounts.get('job_id')!);

            const draft2 = createMockTransaction('montly payment');
            draft2.setCreditAccount(mockAccounts.get('job_id')!);

            await discovery.discover(draft1);
            const firstCallCount = mockListTransactions.mock.calls.length;

            mockListTransactions.mockClear();
            await discovery.discover(draft2);
            const secondCallCount = mockListTransactions.mock.calls.length;

            expect(secondCallCount).toBe(0);
        });

        it('should NOT share cache between different Discovery instances', async () => {
            const discovery1 = new Discovery(mockContext);
            const discovery2 = new Discovery(mockContext);
            const mockListTransactions = spyOn(mockBook, 'listTransactions');

            const draft1 = createMockTransaction('MONTLY paYMent withOUT Taxes');
            const draft2 = createMockTransaction('MONTLY paYMent withOUT Taxes');

            await discovery1.discover(draft1);
            const firstCallCount = mockListTransactions.mock.calls.length;

            mockListTransactions.mockClear();
            await discovery2.discover(draft2);
            const secondCallCount = mockListTransactions.mock.calls.length;

            expect(secondCallCount).toBeGreaterThan(0);
            expect(firstCallCount).toBeGreaterThan(0);
        });

        it('should handle cache with different books correctly', async () => {
            const mockBook2 = {
                getId: () => 'book2_id',
                getAccount: mockBook.getAccount,
                getProperty: () => undefined,
                listTransactions: mock(async (query: string, limit?: number) => {
                    return {
                        getItems: () => [],
                        getCursor: () => undefined,
                        getAccount: async () => undefined,
                        getFirst: () => undefined,
                        size: () => 0,
                    } as unknown as TransactionList;
                }),
            } as unknown as Book;

            const draft1 = createMockTransaction('test transaction');
            const draft2 = {
                ...createMockTransaction('test transaction'),
                getBook: () => mockBook2,
            } as unknown as Transaction;

            const discovery = new Discovery(mockContext);
            const mockListTransactions1 = spyOn(mockBook, 'listTransactions');
            const mockListTransactions2 = spyOn(mockBook2, 'listTransactions');

            await discovery.discover(draft1);
            const firstCallCount = mockListTransactions1.mock.calls.length;

            mockListTransactions1.mockClear();
            mockListTransactions2.mockClear();

            await discovery.discover(draft2);
            const secondCallCount = mockListTransactions2.mock.calls.length;

            expect(firstCallCount).toBeGreaterThan(0);
            expect(secondCallCount).toBeGreaterThan(0);
        });
    });

    describe('discoverProperties', () => {
        it('should return false when dataset is empty', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction');
            const dataSet: Transaction[] = [];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(false);
            expect(draft.getVisibleProperties()).toEqual({});
        });

        it('should return false when dataset has only one transaction', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction');
            const dataSet = [createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel' })];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(false);
            expect(draft.getVisibleProperties()).toEqual({});
        });

        it('should return false when no properties are common across all transactions', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction');
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { prop1: 'A' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { prop2: 'B' }),
                createMockTransaction('tx3', undefined, undefined, undefined, { prop3: 'C' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(false);
            expect(draft.getVisibleProperties()).toEqual({});
        });

        it('should return false when all common properties already exist in draft', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', undefined, undefined, undefined, { category: 'travel' });
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(false);
            const visibleProps = draft.getVisibleProperties();
            expect(visibleProps.category).toBe('travel');
            expect(Object.keys(visibleProps).length).toBe(1);
        });

        it('should add only common properties that don\'t exist in draft', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount, undefined, undefined, { description: 'Flight' });
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', id: '1' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', id: '2' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(true);
            const visibleProps = draft.getVisibleProperties();
            expect(visibleProps.category).toBe('travel');
            expect(visibleProps.vendor).toBe('airline');
            expect(visibleProps.id).toBeUndefined();
            expect(visibleProps.description).toBe('Flight');
        });

        // Confirms hidden keys remain excluded and account configuration is not mutated.
        it('should skip properties with keys ending in underscore', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount);
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', internal_: 'skip' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', internal_: 'skip' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(true);
            expect(draft.getVisibleProperties()).toEqual({ category: 'travel' });
            expect(testAccount.getProperty('agent_prompt_skip')).toBeUndefined();
        });

        // Confirms configured keys are case-insensitive exact matches and remain read-only.
        it('should honor configured skip keys without mutating the account', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount);
            testAccount.setProperty('agent_excluded_properties', 'CATEGORY, vendor');
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', type: 'recurring' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', type: 'recurring' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(true);
            expect(draft.getVisibleProperties()).toEqual({ type: 'recurring' });
            expect(testAccount.getProperty('agent_excluded_properties')).toBe('CATEGORY, vendor');
        });

        // Confirms the effective skip policy is cached for repeated lookups in one discovery batch.
        it('should cache the skip policy per account and book', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const lookupPropertySkipKeys = mock(async () => new Set<string>());
            (mockContext as unknown as { promptLookupService: { lookupPropertySkipKeys: typeof lookupPropertySkipKeys } }).promptLookupService = {
                lookupPropertySkipKeys,
            };
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel' }),
            ];
            const discovery = new Discovery(mockContext);

            await discovery.discoverProperties(testAccount, createMockTransaction('draft 1'), dataSet);
            await discovery.discoverProperties(testAccount, createMockTransaction('draft 2'), dataSet);

            expect(lookupPropertySkipKeys).toHaveBeenCalledTimes(1);
        });

        it('should discover and add common properties from dataset - full scenario', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount, undefined, undefined, { amount: '500' });
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', cost: '600' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', cost: '700' }),
                createMockTransaction('tx3', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', cost: '800' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(true);
            const visibleProps = draft.getVisibleProperties();
            expect(visibleProps.category).toBe('travel');
            expect(visibleProps.vendor).toBe('airline');
            expect(visibleProps.cost).toBeUndefined();
            expect(visibleProps.amount).toBe('500');
            expect(Object.keys(visibleProps)).toEqual(['amount', 'category', 'vendor']);

            expect(testAccount.getProperty('agent_prompt_skip')).toBeUndefined();
        });

        it('should require account parameter for properties discovery', async () => {
            const draft = createMockTransaction('test transaction');
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel' }),
            ];

            const discovery = new Discovery(mockContext);

            // Test with undefined account - should handle gracefully
            try {
                const result = await discovery.discoverProperties(undefined as any, draft, dataSet);
                // If it doesn't throw, it should return false or handle gracefully
                expect(result).toBe(false);
            } catch (error) {
                // If it throws, that's also acceptable - just verify it fails gracefully
                expect(error).toBeDefined();
            }
        });

        it('should only discover properties common across ALL transactions in dataset', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount);
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', amount: '500' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', payment: 'credit' }),
                createMockTransaction('tx3', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', date_type: 'departure' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(true);
            const visibleProps = draft.getVisibleProperties();
            // Only category and vendor are common across ALL 3 transactions
            expect(visibleProps.category).toBe('travel');
            expect(visibleProps.vendor).toBe('airline');
            // These properties are NOT common across all transactions
            expect(visibleProps.amount).toBeUndefined();
            expect(visibleProps.payment).toBeUndefined();
            expect(visibleProps.date_type).toBeUndefined();

            expect(testAccount.getProperty('agent_prompt_skip')).toBeUndefined();
        });

        it('should handle null and undefined property values correctly', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount);
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', status: null as any }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', status: undefined as any }),
                createMockTransaction('tx3', undefined, undefined, undefined, { category: 'travel', status: 'confirmed' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            // Only category should be discovered (status values differ: null !== undefined !== 'confirmed')
            const visibleProps = draft.getVisibleProperties();
            expect(visibleProps.category).toBe('travel');
            expect(visibleProps.status).toBeUndefined();

            // Result should be true because category was added
            expect(result).toBe(true);
        });

        // Confirms configured skip keys match exactly rather than by prefix.
        it('should not skip property keys that only share a prefix', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount);
            testAccount.setProperty('agent_excluded_properties', 'category');
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', category_code: 't1' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', category_code: 't1' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(true);
            expect(draft.getVisibleProperties()).toEqual({ category_code: 't1' });
        });

        it('should ignore hidden properties and not add them to draft', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount);
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', internal_: 'skip_me' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', internal_: 'skip_me' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(true);
            const visibleProps = draft.getVisibleProperties();
            // Visible property should be added
            expect(visibleProps.category).toBe('travel');
            // Hidden property (ending with _) should NOT be in visible properties
            expect(visibleProps.internal_).toBeUndefined();

            expect(testAccount.getProperty('agent_prompt_skip')).toBeUndefined();
        });

        it('should never overwrite existing draft properties', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount, undefined, undefined, { amount: '500', category: 'food', vendor: 'grocery' });
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', type: 'recurring' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', vendor: 'airline', type: 'recurring' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            const visibleProps = draft.getVisibleProperties();
            // Existing properties should NOT be changed
            expect(visibleProps.category).toBe('food'); // NOT 'travel'
            expect(visibleProps.vendor).toBe('grocery'); // NOT 'airline'
            expect(visibleProps.amount).toBe('500'); // Still there
            // New property should be added
            expect(visibleProps.type).toBe('recurring');

            // Result should be true because 'type' was added
            expect(result).toBe(true);

            expect(testAccount.getProperty('agent_prompt_skip')).toBeUndefined();
        });

        // Confirms newly added property keys are recorded in sorted order.
        it('should log newly discovered property keys', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount);
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { zeta: 'last', alpha: 'first' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { zeta: 'last', alpha: 'first' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(true);
            expect(draft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBe('["alpha","zeta"]');
        });

        // Confirms existing provenance is pruned and merged with newly added keys.
        it('should prune missing log keys and merge newly discovered keys', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount, undefined, undefined, {
                category: 'travel',
                [AGENT_DISCOVERED_PROPERTIES_PROPERTY]: '["category","removed"]',
            });
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel', vendor: 'Amazon' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel', vendor: 'Amazon' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(true);
            expect(draft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBe('["category","vendor"]');
        });

        // Confirms an initial no-op does not create an empty provenance log.
        it('should leave the provenance log absent when no property is added initially', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount, undefined, undefined, { category: 'travel' });
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { category: 'travel' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { category: 'travel' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(false);
            expect(draft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBeUndefined();
        });

        // Confirms an existing log is retained as an empty array after its keys are pruned.
        it('should retain an empty provenance log after all logged properties disappear', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount, undefined, undefined, {
                [AGENT_DISCOVERED_PROPERTIES_PROPERTY]: '["removed"]',
            });
            const dataSet = [
                createMockTransaction('tx1', undefined, undefined, undefined, { first_only: 'one' }),
                createMockTransaction('tx2', undefined, undefined, undefined, { second_only: 'two' }),
            ];

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, dataSet);

            expect(result).toBe(false);
            expect(draft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBe('[]');
        });

        // Confirms stale provenance is pruned even when the evidence set is too small.
        it('should prune stale provenance when there is insufficient evidence', async () => {
            const testAccount = mockAccounts.get('bank_id')!;
            const draft = createMockTransaction('test transaction', testAccount, undefined, undefined, {
                [AGENT_DISCOVERED_PROPERTIES_PROPERTY]: '["removed"]',
            });

            const discovery = new Discovery(mockContext);
            const result = await discovery.discoverProperties(testAccount, draft, []);

            expect(result).toBe(false);
            expect(draft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBe('[]');
        });
    });
});
