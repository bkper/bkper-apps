import { Book, Transaction, Account } from 'bkper-js';
import { AGENT_CREDIT_ACCOUNT_ID_PROPERTY, AGENT_DEBIT_ACCOUNT_ID_PROPERTY, AGENT_DESCRIPTION_PART_PROPERTY, AGENT_DISCOVERED_PROPERTIES_PROPERTY, PARSED_ACCOUNT_NAME_PROPERTY } from '../constants.js';
import { AppContext } from '../AppContext.js';
import { stripAccountNamesFromDescription } from '../utils.js';

const NUMBER_OF_TRANSACTIONS = 3;
const MIN_PROPERTY_DISCOVERY_TRANSACTIONS = Math.ceil(NUMBER_OF_TRANSACTIONS / 2);
const MAX_DESCRIPTION_PARTS = 5;
export const MAX_EXTERNAL_REQUESTS = 950;

interface DiscoveryResult {
    creditAccDiscovered: boolean;
    debitAccDiscovered: boolean;
}

export class Discovery {
    private context: AppContext;
    private transactionCache: Map<string, Transaction[]>;
    private accountCache: Map<string, Account | undefined>;
    private descriptionPartsCache: Map<string, string[]>;
    private propertySkipKeysCache: Map<string, Set<string>>;
    private externalRequestCount: number;

    constructor(context: AppContext, private readonly onError?: (error: unknown) => void) {
        this.context = context;
        this.transactionCache = new Map();
        this.accountCache = new Map();
        this.descriptionPartsCache = new Map();
        this.propertySkipKeysCache = new Map();
        this.externalRequestCount = 0;
    }

    getExternalRequestCount(): number {
        return this.externalRequestCount;
    }

    async discover(draft: Transaction): Promise<{ discovered: boolean, dataSet?: Transaction[] }> {
        try {
            const result = await this.run(draft);
            return result;
        } catch (error) {
            if (this.onError) {
                this.onError(error);
            } else {
                console.error('Discovery error:', error);
            }
            return { discovered: false };
        }
    }

    private async run(draft: Transaction): Promise<{ discovered: boolean, dataSet?: Transaction[] }> {
        const book = draft.getBook();

        if (this.externalRequestCount > MAX_EXTERNAL_REQUESTS) {
            return { discovered: false };
        }

        if (draft.payload.creditAccount?.id && draft.payload.debitAccount?.id) {
            return { discovered: false };
        }

        const description = draft.getDescription();
        if (!description || description.trim() === '') {
            return { discovered: false };
        }

        let discoveryDescription = description;
        let account: Account | undefined;
        if (draft.payload.creditAccount?.id) {
            account = await this.getAccount(book, draft.payload.creditAccount.id);
        } else if (draft.payload.debitAccount?.id) {
            account = await this.getAccount(book, draft.payload.debitAccount.id);
        } else {
            const accountName = draft.getProperty(PARSED_ACCOUNT_NAME_PROPERTY);
            if (accountName) {
                account = await this.getAccount(book, accountName);
                if (account) {
                    discoveryDescription = stripAccountNamesFromDescription(description, account.getName() || accountName);
                    draft.deleteProperty(PARSED_ACCOUNT_NAME_PROPERTY);
                }
            }
        }

        if (!discoveryDescription) {
            return { discovered: false };
        }

        const discoveryExamples = await this.context.promptLookupService.lookupDiscoveryExamples({ book, account });
        const descriptionParts = await this.extractDescriptionParts(discoveryDescription, discoveryExamples);
        const tags = draft.getTags() || [];
        const queryParts = this.sanitizeQueryParts(descriptionParts, tags);
        if (discoveryDescription.length < 50 && !queryParts.includes(discoveryDescription)) {
            queryParts.unshift(discoveryDescription);
        }

        const createdBy = draft.getCreatedBy();
        if (account && createdBy) {
            for (const queryPart of queryParts) {
                const searchQuery = `account: '${account.getName()}' "${queryPart}" createdBy:${createdBy}`;
                const transactions = await this.listTransactions(book, searchQuery);
                const discoveryResult = this.discoverAccounts(transactions, draft);

                if (discoveryResult.creditAccDiscovered || discoveryResult.debitAccDiscovered) {
                    this.logDiscovery(discoveryResult.creditAccDiscovered, discoveryResult.debitAccDiscovered, draft, queryPart);
                    return { discovered: true, dataSet: transactions };
                }
            }
        }

        if (account) {
            for (const queryPart of queryParts) {
                const searchQuery = `account: '${account.getName()}' "${queryPart}"`;
                const transactions = await this.listTransactions(book, searchQuery);
                const discoveryResult = this.discoverAccounts(transactions, draft);
                if (discoveryResult.creditAccDiscovered || discoveryResult.debitAccDiscovered) {
                    this.logDiscovery(discoveryResult.creditAccDiscovered, discoveryResult.debitAccDiscovered, draft, queryPart);
                    return { discovered: true, dataSet: transactions };
                }
            }
        }

        for (const queryPart of queryParts) {
            const transactions = await this.listTransactions(book, `"${queryPart}"`);
            const discoveryResult = this.discoverAccounts(transactions, draft);
            if (discoveryResult.creditAccDiscovered || discoveryResult.debitAccDiscovered) {
                this.logDiscovery(discoveryResult.creditAccDiscovered, discoveryResult.debitAccDiscovered, draft, queryPart);
                return { discovered: true, dataSet: transactions };
            }
        }
        this.logDiscovery(false, false, draft, null);
        return { discovered: false };
    }

    private async listTransactions(book: Book, searchQuery: string): Promise<Transaction[]> {
        const bookId = book.getId();
        const cacheKey = `${bookId}:${searchQuery} is:posted`;

        if (this.transactionCache.has(cacheKey)) {
            return this.transactionCache.get(cacheKey)!;
        }

        this.externalRequestCount++;

        try {
            const transactions = (await book.listTransactions(`${searchQuery} is:posted`, NUMBER_OF_TRANSACTIONS)).getItems();
            this.transactionCache.set(cacheKey, transactions);
            return transactions;
        } catch (error) {
            if (this.onError) {
                this.onError(error);
            } else {
                console.warn('Error listing transactions:', error);
            }
            return [];
        }
    }

    private async extractDescriptionParts(description: string, discoveryExamples?: string): Promise<string[]> {
        const cacheKey = `${discoveryExamples ?? ''}\u0000${description}`;
        if (this.descriptionPartsCache.has(cacheKey)) {
            return this.descriptionPartsCache.get(cacheKey)!;
        }

        this.externalRequestCount++;

        const parts = await this.context.createExtractorDescriptionParts(this.onError).extract(description, discoveryExamples);
        this.descriptionPartsCache.set(cacheKey, parts);
        return parts;
    }

    private async getAccount(book: Book, accountIdOrName: string): Promise<Account | undefined> {
        const bookId = book.getId();
        const cacheKey = `${bookId}:${accountIdOrName}`;

        if (this.accountCache.has(cacheKey)) {
            return this.accountCache.get(cacheKey);
        }

        this.externalRequestCount++;

        const account = await book.getAccount(accountIdOrName);
        this.accountCache.set(cacheKey, account);
        return account;
    }

    private discoverAccounts(transactions: Transaction[], draft: Transaction): DiscoveryResult {
        if (!transactions || transactions.length === 0) {
            return { creditAccDiscovered: false, debitAccDiscovered: false };
        }

        const countCredit = new Map<string, number>();
        const countDebit = new Map<string, number>();
        let discovered = { creditAccDiscovered: false, debitAccDiscovered: false };

        for (const tx of transactions) {
            const creditAccountId = tx.payload.creditAccount?.id;
            const debitAccountId = tx.payload.debitAccount?.id;

            this.count(countCredit, creditAccountId);
            this.count(countDebit, debitAccountId);
        }

        const highestCreditKey = this.getHighestFrequencyKey(countCredit);
        const highestDebitKey = this.getHighestFrequencyKey(countDebit);

        if (highestCreditKey && this.setCreditAccountId(draft, highestCreditKey)) {
            discovered.creditAccDiscovered = true;
        }

        if (highestDebitKey && this.setDebitAccountId(draft, highestDebitKey)) {
            discovered.debitAccDiscovered = true;
        }

        return discovered;
    }

    private setCreditAccountId(draft: Transaction, accountId: string): boolean {
        if (!accountId) {
            return false;
        }

        if (!draft.payload.creditAccount?.id && (draft.payload.debitAccount?.id !== accountId) && draft.getProperty(AGENT_CREDIT_ACCOUNT_ID_PROPERTY) !== accountId) {
            const book = draft.getBook();
            draft.setCreditAccount(new Account(book, { id: accountId }));
            return true;
        }
        return false;
    }

    private setDebitAccountId(draft: Transaction, accountId: string): boolean {
        if (!accountId) {
            return false;
        }

        if (!draft.payload.debitAccount?.id && (draft.payload.creditAccount?.id !== accountId) && draft.getProperty(AGENT_DEBIT_ACCOUNT_ID_PROPERTY) !== accountId) {
            const book = draft.getBook();
            draft.setDebitAccount(new Account(book, { id: accountId }));
            return true;
        }
        return false;
    }

    private count(counts: Map<string, number>, id: string | undefined): void {
        if (!id) {
            return;
        }
        const current = counts.get(id) || 0;
        counts.set(id, current + 1);
    }

    private getHighestFrequencyKey(counts: Map<string, number>): string | undefined {
        let maxCount = 0;
        let maxKey: string | undefined;

        for (const [key, count] of counts.entries()) {
            if (count > maxCount) {
                maxCount = count;
                maxKey = key;
            }
        }

        return maxKey;
    }

    private logDiscovery(creditAccDiscovered: boolean,
        debitAccDiscovered: boolean,
        draft: Transaction,
        queryPart: string | null): void {
        if (creditAccDiscovered) {
            draft.setProperty(AGENT_CREDIT_ACCOUNT_ID_PROPERTY, draft.payload.creditAccount?.id ?? '');
        }
        if (debitAccDiscovered) {
            draft.setProperty(AGENT_DEBIT_ACCOUNT_ID_PROPERTY, draft.payload.debitAccount?.id ?? '');
        }

        if (queryPart) {
            draft.setProperty(AGENT_DESCRIPTION_PART_PROPERTY, queryPart);
        }

    }

    private sanitizeQueryParts(descriptionParts: string[], tags: string[]): string[] {
        const seen = new Set<string>();
        const result: string[] = [];

        for (const part of descriptionParts.sort((a, b) => b.length - a.length).slice(0, MAX_DESCRIPTION_PARTS)) {
            const lowerPart = part.toLowerCase().replace(/^#/, '');
            if (!seen.has(lowerPart)) {
                seen.add(lowerPart);
                result.push(part);
            }
        }

        for (const tag of tags) {
            const lowerTag = tag.toLowerCase();
            if (!seen.has(lowerTag)) {
                seen.add(lowerTag);
                result.push(tag);
            }
        }

        return result;
    }

    public async discoverProperties(account: Account, draft: Transaction, dataSet: Transaction[]): Promise<boolean> {
        try {
            // Validate the account before touching the draft or resolving configuration.
            if (!account) {
                return false;
            }

            // Prune stale provenance even when there is not enough evidence for new discovery.
            if (!dataSet || dataSet.length < MIN_PROPERTY_DISCOVERY_TRANSACTIONS) {
                this.updateDiscoveredPropertiesLog(draft, []);
                return false;
            }

            const book = draft.getBook();
            const skipKeys = await this.getPropertySkipKeys(book, account);
            const firstTxProperties = dataSet[0].getVisibleProperties();
            const commonProperties = new Map<string, string>();

            // Seed candidates from the first transaction, excluding configured keys.
            for (const [key, value] of Object.entries(firstTxProperties)) {
                if (value != null && !skipKeys.has(key.toLowerCase())) {
                    commonProperties.set(key, String(value));
                }
            }

            // Retain only exact key/value matches shared by every historical transaction.
            for (let i = 1; i < dataSet.length; i++) {
                const txProperties = dataSet[i].getVisibleProperties();

                for (const [key, value] of Array.from(commonProperties.entries())) {
                    const txValue = txProperties[key];
                    if (txValue == null || String(txValue) !== value) {
                        commonProperties.delete(key);
                    }
                }

                if (commonProperties.size === 0) {
                    break;
                }
            }

            const draftProperties = draft.getVisibleProperties();
            const addedPropertyKeys: string[] = [];

            // Add only missing properties in deterministic alphabetical order.
            const sortedCommonProperties = Array.from(commonProperties.entries()).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
            for (const [key, value] of sortedCommonProperties) {
                if (!(key in draftProperties)) {
                    draft.setProperty(key, value);
                    addedPropertyKeys.push(key);
                }
            }

            // Update provenance after all visible-property changes are applied.
            this.updateDiscoveredPropertiesLog(draft, addedPropertyKeys);
            return addedPropertyKeys.length > 0;
        } catch (error) {
            // Property enrichment is best-effort and must not block transaction creation.
            if (this.onError) {
                this.onError(error);
            } else {
                console.warn('Property discovery error:', error);
            }
            return false;
        }
    }

    private updateDiscoveredPropertiesLog(draft: Transaction, addedPropertyKeys: string[]): void {
        // Preserve only logged keys that still exist as visible draft properties.
        const existingLog = draft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY);
        const hasExistingLog = existingLog !== undefined;
        const visiblePropertyKeys = new Set(Object.keys(draft.getVisibleProperties()).map((key) => key.toLowerCase()));
        const discoveredKeys = new Map<string, string>();

        if (existingLog) {
            const loggedKeys = JSON.parse(existingLog) as string[];
            for (const key of loggedKeys) {
                const normalizedKey = key.toLowerCase();
                if (visiblePropertyKeys.has(normalizedKey) && !discoveredKeys.has(normalizedKey)) {
                    discoveredKeys.set(normalizedKey, key);
                }
            }
        }

        // Merge only properties added by this discovery call.
        for (const key of addedPropertyKeys) {
            const normalizedKey = key.toLowerCase();
            if (!discoveredKeys.has(normalizedKey)) {
                discoveredKeys.set(normalizedKey, key);
            }
        }

        if (!hasExistingLog && discoveredKeys.size === 0) {
            return;
        }

        const sortedKeys = Array.from(discoveredKeys.values()).sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));
        draft.setProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY, JSON.stringify(sortedKeys));
    }

    private async getPropertySkipKeys(book: Book, account: Account): Promise<Set<string>> {
        const bookId = book.getId() || 'unknown-book';
        const accountId = account.getId() || account.getName() || 'unknown-account';
        const cacheKey = `${bookId}:${accountId}`;

        if (this.propertySkipKeysCache.has(cacheKey)) {
            return this.propertySkipKeysCache.get(cacheKey)!;
        }

        // Resolve and cache policy once for this account/book discovery batch.
        const skipKeys = await this.context.promptLookupService.lookupPropertySkipKeys({ book, account });
        this.propertySkipKeysCache.set(cacheKey, skipKeys);
        return skipKeys;
    }
}