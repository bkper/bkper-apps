import { describe, it, expect, mock } from 'bun:test';
import { Book, Transaction, TransactionList, Account } from 'bkper-js';
import { RediscoveryService } from '../../src/services/RediscoveryService.js';
import { AGENT_CREDIT_ACCOUNT_ID_PROPERTY, AGENT_DEBIT_ACCOUNT_ID_PROPERTY, AGENT_DISCOVERED_PROPERTIES_PROPERTY } from '../../src/constants.js';

type DiscoverFn = (draft: Transaction) => Promise<{ discovered: boolean; dataSet?: Transaction[] }>;
type DiscoverPropertiesFn = (account: Account, draft: Transaction, dataSet: Transaction[]) => Promise<boolean>;

function createMockTransaction(options: {
    id: string;
    description: string;
    creditAccountId?: string;
    debitAccountId?: string;
    properties?: Record<string, string>;
}): Transaction {
    const properties: Record<string, string> = { ...(options.properties || {}) };
    const payload: Record<string, unknown> = {
        id: options.id,
        description: options.description,
        creditAccount: options.creditAccountId ? { id: options.creditAccountId } : undefined,
        debitAccount: options.debitAccountId ? { id: options.debitAccountId } : undefined,
        properties,
    };

    const transaction = {
        payload,
        getId: () => options.id,
        getDescription: () => options.description,
        getProperty: (key: string) => properties[key] || undefined,
        getVisibleProperties: () => Object.fromEntries(Object.entries(properties).filter(([key]) => !key.endsWith('_'))),
        setProperty: (key: string, value: string) => {
            properties[key] = value;
        },
        deleteProperty: (key: string) => {
            delete properties[key];
        },
        setCreditAccount: (account: Account | null) => {
            payload.creditAccount = account ? { id: (account as unknown as { getId: () => string }).getId() } : undefined;
        },
        setDebitAccount: (account: Account | null) => {
            payload.debitAccount = account ? { id: (account as unknown as { getId: () => string }).getId() } : undefined;
        },
    } as unknown as Transaction;

    return transaction;
}

function createMockBook(drafts: Transaction[], accounts: Map<string, Account> = new Map()): Book {
    const batchUpdateTransactions = mock(async (transactions: Transaction[]) => transactions);

    const book = {
        getId: () => 'test-book-id',
        getAccount: mock(async (id: string) => accounts.get(id)),
        getBacklog: mock(async () => ({
            getCount: () => 10,
        })),
        listTransactions: mock(async () => ({
            getItems: () => drafts,
        } as unknown as TransactionList)),
        batchUpdateTransactions,
    } as unknown as Book;

    return book;
}

function createMockEvent(previousAttributes: Record<string, string>) {
    return {
        data: {
            previousAttributes,
        },
    };
}

function createMockContext(discoverFn: DiscoverFn, discoverPropertiesFn: DiscoverPropertiesFn = async () => false) {
    return {
        createDiscovery: () => ({
            discover: discoverFn,
            discoverProperties: discoverPropertiesFn,
        }),
    };
}

describe('RediscoveryService', () => {
    const eventWithAccountChange = createMockEvent({ creditAccId: 'old-credit-id' });

    it('should not include a draft in batch update when discover returns discovered:false', async () => {
        const draft = createMockTransaction({
            id: 'draft-1',
            description: 'PIX MINISTERIO DA FAZENDA',
            creditAccountId: 'old-credit-id',
            debitAccountId: 'debit-id',
            properties: {
                [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id',
                [AGENT_DEBIT_ACCOUNT_ID_PROPERTY]: 'debit-id',
            },
        });

        const book = createMockBook([draft]);
        const context = createMockContext(async () => ({ discovered: false }));

        const service = new RediscoveryService(context as never);
        const postedTransaction = createMockTransaction({
            id: 'posted-1',
            description: 'posted',
            properties: { [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id' },
        });
        const result = await service.rediscover(book, postedTransaction, eventWithAccountChange);

        expect(result).toBeNull();
        expect(book.batchUpdateTransactions).not.toHaveBeenCalled();
    });

    it('should never call batchUpdateTransactions when all drafts return discovered:false', async () => {
        const affectedProperties = { [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id' };
        const drafts = [
            createMockTransaction({ id: 'draft-1', description: 'Draft one', creditAccountId: 'c1', debitAccountId: 'd1', properties: affectedProperties }),
            createMockTransaction({ id: 'draft-2', description: 'Draft two', creditAccountId: 'c2', debitAccountId: 'd2', properties: affectedProperties }),
            createMockTransaction({ id: 'draft-3', description: 'Draft three', creditAccountId: 'c3', debitAccountId: 'd3', properties: affectedProperties }),
        ];

        const book = createMockBook(drafts);
        const context = createMockContext(async () => ({ discovered: false }));

        const service = new RediscoveryService(context as never);
        const postedTransaction = createMockTransaction({
            id: 'posted-1',
            description: 'posted',
            properties: { [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id' },
        });
        const result = await service.rediscover(book, postedTransaction, eventWithAccountChange);

        expect(result).toBeNull();
        expect(book.batchUpdateTransactions).not.toHaveBeenCalled();
    });

    it('should include only discovered drafts in batch update', async () => {
        const affectedProperties = { [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id' };
        const draftDiscovered = createMockTransaction({ id: 'draft-discovered', description: 'New draft', properties: affectedProperties });
        const draftNotDiscovered = createMockTransaction({
            id: 'draft-not-discovered',
            description: 'Existing draft',
            creditAccountId: 'c1',
            debitAccountId: 'd1',
            properties: affectedProperties,
        });

        const book = createMockBook([draftDiscovered, draftNotDiscovered]);
        const discoverFn: DiscoverFn = async (draft: Transaction) => {
            if (draft.getId() === 'draft-discovered') {
                return { discovered: true };
            }
            return { discovered: false };
        };
        const context = createMockContext(discoverFn);

        const service = new RediscoveryService(context as never);
        const postedTransaction = createMockTransaction({
            id: 'posted-1',
            description: 'posted',
            properties: { [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id' },
        });
        const result = await service.rediscover(book, postedTransaction, eventWithAccountChange);

        expect(result).toContain('1 draft(s)');
        expect(book.batchUpdateTransactions).toHaveBeenCalledTimes(1);
        const batchedDrafts = (book.batchUpdateTransactions as ReturnType<typeof mock>).mock.calls[0][0] as Transaction[];
        expect(batchedDrafts).toHaveLength(1);
        expect(batchedDrafts[0].getId()).toBe('draft-discovered');
    });

    it('should not update a fully-enriched draft across repeated rediscover calls', async () => {
        const fullyEnrichedDraft = createMockTransaction({
            id: 'draft-enriched',
            description: 'PIX MINISTERIO DA FAZENDA',
            creditAccountId: 'credit-id',
            debitAccountId: 'debit-id',
            properties: {
                [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'credit-id',
                [AGENT_DEBIT_ACCOUNT_ID_PROPERTY]: 'debit-id',
            },
        });

        const book = createMockBook([fullyEnrichedDraft]);

        // Simulate what real Discovery does: return { discovered: false } when both accounts are set
        const discoverFn: DiscoverFn = async (draft: Transaction) => {
            const hasBothAccounts = (draft as unknown as { payload: Record<string, unknown> }).payload.creditAccount
                && (draft as unknown as { payload: Record<string, unknown> }).payload.debitAccount;
            if (hasBothAccounts) {
                return { discovered: false };
            }
            return { discovered: true };
        };
        const context = createMockContext(discoverFn);

        const service = new RediscoveryService(context as never);
        const postedTransaction = createMockTransaction({ id: 'posted-1', description: 'posted' });

        // Simulate multiple rediscover calls (like the 80+ events in the incident)
        for (let i = 0; i < 5; i++) {
            const result = await service.rediscover(book, postedTransaction, eventWithAccountChange);
            expect(result).toBeNull();
        }

        expect(book.batchUpdateTransactions).not.toHaveBeenCalled();
    });

    // Confirms affected drafts clear old properties, infer the source account, and re-enrich after account discovery.
    it('should clear and rediscover properties only for drafts linked to the corrected account', async () => {
        const sourceAccount = { getId: () => 'source-account-id' } as unknown as Account;
        const affectedDraft = createMockTransaction({
            id: 'affected-draft',
            description: 'Affected draft',
            creditAccountId: 'old-credit-id',
            debitAccountId: 'source-account-id',
            properties: {
                [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id',
                [AGENT_DISCOVERED_PROPERTIES_PROPERTY]: '["category","vendor"]',
                category: 'old-category',
                vendor: 'old-vendor',
            },
        });
        const unrelatedDraft = createMockTransaction({
            id: 'unrelated-draft',
            description: 'Unrelated draft',
            creditAccountId: 'other-credit-id',
            debitAccountId: 'other-source-id',
            properties: {
                [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'other-credit-id',
                [AGENT_DISCOVERED_PROPERTIES_PROPERTY]: '["project"]',
                project: 'keep-project',
            },
        });
        const book = createMockBook([affectedDraft, unrelatedDraft], new Map([['source-account-id', sourceAccount]]));
        const observedAffectedProperties: Record<string, string> = {};
        const discoveredDraftIds: string[] = [];
        let propertiesDiscoveryAccount: Account | undefined;
        let propertiesDiscoveryCalls = 0;
        const context = createMockContext(
            async (draft: Transaction) => {
                discoveredDraftIds.push(draft.getId() || 'unknown');
                if (draft.getId() === 'affected-draft') {
                    Object.assign(observedAffectedProperties, draft.getVisibleProperties());
                }
                return { discovered: true, dataSet: [createMockTransaction({ id: 'history-1', description: 'history' }), createMockTransaction({ id: 'history-2', description: 'history' })] };
            },
            async (account: Account, draft: Transaction) => {
                propertiesDiscoveryCalls++;
                propertiesDiscoveryAccount = account;
                draft.setProperty('category', 'new-category');
                draft.setProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY, '["category"]');
                return true;
            }
        );

        const service = new RediscoveryService(context as never);
        const postedTransaction = createMockTransaction({
            id: 'posted-1',
            description: 'posted',
            properties: { [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id' },
        });
        const result = await service.rediscover(book, postedTransaction, eventWithAccountChange);

        expect(result).toContain('1 draft(s)');
        expect(discoveredDraftIds).toEqual(['affected-draft']);
        expect(propertiesDiscoveryCalls).toBe(1);
        expect(propertiesDiscoveryAccount).toBe(sourceAccount);
        expect(observedAffectedProperties.category).toBeUndefined();
        expect(observedAffectedProperties.vendor).toBeUndefined();
        expect(affectedDraft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBe('["category"]');
        expect(affectedDraft.getProperty('category')).toBe('new-category');
        expect(unrelatedDraft.getProperty('project')).toBe('keep-project');
        expect(unrelatedDraft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBe('["project"]');
    });

    // Confirms ambiguous source-account context skips property rediscovery while account rediscovery continues.
    it('should skip property rediscovery when the source account is ambiguous', async () => {
        const draft = createMockTransaction({
            id: 'ambiguous-draft',
            description: 'Ambiguous draft',
            creditAccountId: 'old-credit-id',
            debitAccountId: 'old-debit-id',
            properties: {
                [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id',
                [AGENT_DEBIT_ACCOUNT_ID_PROPERTY]: 'old-debit-id',
                [AGENT_DISCOVERED_PROPERTIES_PROPERTY]: '["category"]',
                category: 'old-category',
            },
        });
        const book = createMockBook([draft]);
        let propertiesDiscoveryCalls = 0;
        const context = createMockContext(
            async () => ({ discovered: true, dataSet: [createMockTransaction({ id: 'history-1', description: 'history' })] }),
            async () => {
                propertiesDiscoveryCalls++;
                return true;
            }
        );

        const service = new RediscoveryService(context as never);
        const postedTransaction = createMockTransaction({
            id: 'posted-1',
            description: 'posted',
            properties: {
                [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id',
                [AGENT_DEBIT_ACCOUNT_ID_PROPERTY]: 'old-debit-id',
            },
        });
        await service.rediscover(book, postedTransaction, createMockEvent({ creditAccId: 'old-credit-id', debitAccId: 'old-debit-id' }));

        expect(propertiesDiscoveryCalls).toBe(0);
        expect(draft.getProperty('category')).toBeUndefined();
        expect(draft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBe('[]');
        expect(book.batchUpdateTransactions).toHaveBeenCalledTimes(1);
    });

    // Confirms cleanup is not persisted when account rediscovery finds no replacement.
    it('should not persist property cleanup when account rediscovery returns false', async () => {
        const draft = createMockTransaction({
            id: 'unresolved-draft',
            description: 'Unresolved draft',
            creditAccountId: 'old-credit-id',
            debitAccountId: 'source-account-id',
            properties: {
                [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id',
                [AGENT_DISCOVERED_PROPERTIES_PROPERTY]: '["category"]',
                category: 'old-category',
            },
        });
        const sourceAccount = { getId: () => 'source-account-id' } as unknown as Account;
        const book = createMockBook([draft], new Map([['source-account-id', sourceAccount]]));
        const context = createMockContext(async () => ({ discovered: false }));

        const service = new RediscoveryService(context as never);
        const postedTransaction = createMockTransaction({
            id: 'posted-1',
            description: 'posted',
            properties: { [AGENT_CREDIT_ACCOUNT_ID_PROPERTY]: 'old-credit-id' },
        });
        await service.rediscover(book, postedTransaction, eventWithAccountChange);

        expect(book.batchUpdateTransactions).not.toHaveBeenCalled();
        expect(draft.getProperty('category')).toBeUndefined();
        expect(draft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY)).toBe('[]');
    });
});
