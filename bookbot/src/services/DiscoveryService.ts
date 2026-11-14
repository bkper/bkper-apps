import { Book, Transaction, Account, BkperError } from 'bkper-js';
import {
    BOOKBOT_CONFIDENCE_PROPERTY,
    BOOKBOT_CREDIT_ACCOUNT_ID_PROPERTY,
    BOOKBOT_DEBIT_ACCOUNT_ID_PROPERTY,
    BOOKBOT_DESCRIPTION_PART_PROPERTY,
    BOOKBOT_DISCOVERED_PROPERTIES_PROPERTY,
    LEGACY_AGENT_CREDIT_ACCOUNT_ID_PROPERTY,
    LEGACY_AGENT_DEBIT_ACCOUNT_ID_PROPERTY,
    LEGACY_AGENT_DESCRIPTION_PART_PROPERTY,
    LEGACY_AGENT_DISCOVERED_PROPERTIES_PROPERTY,
    PARSED_ACCOUNT_NAME_PROPERTY,
} from '../constants.js';
import { setProvenanceProperty } from './ProvenanceProperty.js';
import { buildAccountChoiceRequest, collectAccountOptions, decideAccountOption, type AccountChoiceDecision, type AccountOption } from './AccountChoice.js';
import { AppContext } from '../AppContext.js';
import { AccountChooser } from '../genai/AccountChooser.js';
import { stripAccountNamesFromDescription } from '../utils.js';

/** Posted transactions read per search for the account choice. */
const NUMBER_OF_TRANSACTIONS = 15;
const MIN_PROPERTY_DISCOVERY_TRANSACTIONS = 2;
const MAX_DESCRIPTION_PARTS = 5;
export const MAX_EXTERNAL_REQUESTS = 950;

export class Discovery {
    private context: AppContext;
    private transactionCache: Map<string, Transaction[]>;
    private accountCache: Map<string, Account | undefined>;
    private descriptionPartsCache: Map<string, string[]>;
    private propertySkipKeysCache: Map<string, Set<string>>;
    private externalRequestCount: number;
    private accountChooser?: AccountChooser;

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

        const descriptionParts = await this.extractDescriptionParts(discoveryDescription);
        const tags = draft.getTags() || [];
        const queryParts = this.sanitizeQueryParts(descriptionParts, tags);
        if (discoveryDescription.length < 50 && !queryParts.includes(discoveryDescription)) {
            queryParts.unshift(discoveryDescription);
        }

        // From the closest history to the whole Book, and from the most specific description part to
        // the broadest: the first search that fills the draft decides, and searches are never mixed.
        const accountName = account?.getName();
        const createdBy = draft.getCreatedBy();
        const searchQueries: string[] = [];
        if (accountName && createdBy) {
            searchQueries.push(...queryParts.map(queryPart => `account: '${accountName}' "${queryPart}" createdBy:${createdBy}`));
        }
        if (accountName) {
            searchQueries.push(...queryParts.map(queryPart => `account: '${accountName}' "${queryPart}"`));
        }
        searchQueries.push(...queryParts.map(queryPart => `"${queryPart}"`));

        for (const searchQuery of searchQueries) {
            const transactions = await this.listTransactions(book, searchQuery);
            await this.describeAccounts(book, transactions);
            const options = collectAccountOptions(draft, transactions);
            if (options.length === 0) {
                continue;
            }
            const result = await this.chooseAccounts(draft, options, account);
            if (result.discovered) {
                return result;
            }
        }
        return { discovered: false };
    }

    /**
     * Fills the draft with the only option one search found, or with the option Jev ranks first when
     * the search found several, then applies it in code only to empty sides that pass the checks.
     */
    private async chooseAccounts(draft: Transaction, options: AccountOption[], account: Account | undefined): Promise<{ discovered: boolean, dataSet?: Transaction[] }> {
        const decision = options.length === 1 ? { option: options[0], confidence: 1 } : await this.rankAccounts(draft, options, account);
        if (!decision) {
            return { discovered: false };
        }

        const creditAccountId = decision.option.creditAccount?.id;
        const debitAccountId = decision.option.debitAccount?.id;
        const creditAccDiscovered = !!creditAccountId && this.setCreditAccountId(draft, creditAccountId);
        const debitAccDiscovered = !!debitAccountId && this.setDebitAccountId(draft, debitAccountId);
        if (!creditAccDiscovered && !debitAccDiscovered) {
            return { discovered: false };
        }
        this.logDiscovery(creditAccDiscovered, debitAccDiscovered, draft, decision.confidence);
        return { discovered: true, dataSet: decision.option.transactions };
    }

    private async rankAccounts(draft: Transaction, options: AccountOption[], account: Account | undefined): Promise<AccountChoiceDecision | undefined> {
        this.externalRequestCount++;
        this.accountChooser ??= this.context.createAccountChooser();
        const answer = await this.accountChooser.choose(buildAccountChoiceRequest(draft, options, account));
        return decideAccountOption(options, answer);
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

    /**
     * Listed transactions carry only their Accounts' IDs; the choice names them and describes their
     * type and groups. Account reads are cached and counted like any other.
     */
    private async describeAccounts(book: Book, transactions: Transaction[]): Promise<void> {
        for (const transaction of transactions) {
            if (transaction.payload.creditAccount) {
                transaction.payload.creditAccount = await this.describeAccount(book, transaction.payload.creditAccount);
            }
            if (transaction.payload.debitAccount) {
                transaction.payload.debitAccount = await this.describeAccount(book, transaction.payload.debitAccount);
            }
        }
    }

    /**
     * The Book's Account, or the transaction's own reference when the Book does not have it: callers
     * that check Book membership then reject the suggestion as an invalid Account.
     */
    private async describeAccount(book: Book, account: bkper.Account): Promise<bkper.Account> {
        try {
            return (account.id && (await this.getAccount(book, account.id))?.json()) || account;
        } catch (error) {
            if (error instanceof BkperError && error.code === 404) {
                return account;
            }
            throw error;
        }
    }

    private async extractDescriptionParts(description: string): Promise<string[]> {
        if (this.descriptionPartsCache.has(description)) {
            return this.descriptionPartsCache.get(description)!;
        }

        this.externalRequestCount++;

        const parts = await this.context.createExtractorDescriptionParts(this.onError).extract(description);
        this.descriptionPartsCache.set(description, parts);
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

    private setCreditAccountId(draft: Transaction, accountId: string): boolean {
        if (!accountId) {
            return false;
        }

        if (!draft.payload.creditAccount?.id && (draft.payload.debitAccount?.id !== accountId) && draft.getProperty(BOOKBOT_CREDIT_ACCOUNT_ID_PROPERTY, LEGACY_AGENT_CREDIT_ACCOUNT_ID_PROPERTY) !== accountId) {
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

        if (!draft.payload.debitAccount?.id && (draft.payload.creditAccount?.id !== accountId) && draft.getProperty(BOOKBOT_DEBIT_ACCOUNT_ID_PROPERTY, LEGACY_AGENT_DEBIT_ACCOUNT_ID_PROPERTY) !== accountId) {
            const book = draft.getBook();
            draft.setDebitAccount(new Account(book, { id: accountId }));
            return true;
        }
        return false;
    }

    private logDiscovery(creditAccDiscovered: boolean,
        debitAccDiscovered: boolean,
        draft: Transaction,
        confidence: number): void {
        if (creditAccDiscovered) {
            setProvenanceProperty(draft, BOOKBOT_CREDIT_ACCOUNT_ID_PROPERTY, LEGACY_AGENT_CREDIT_ACCOUNT_ID_PROPERTY, draft.payload.creditAccount?.id ?? '');
        }
        if (debitAccDiscovered) {
            setProvenanceProperty(draft, BOOKBOT_DEBIT_ACCOUNT_ID_PROPERTY, LEGACY_AGENT_DEBIT_ACCOUNT_ID_PROPERTY, draft.payload.debitAccount?.id ?? '');
        }
        draft.setProperty(BOOKBOT_CONFIDENCE_PROPERTY, confidence.toFixed(2));

        // The matched description part is no longer recorded; remove it, under either name, only when present.
        for (const property of [BOOKBOT_DESCRIPTION_PART_PROPERTY, LEGACY_AGENT_DESCRIPTION_PART_PROPERTY]) {
            if (draft.getProperty(property) !== undefined) {
                draft.deleteProperty(property);
            }
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
        const existingLog = draft.getProperty(BOOKBOT_DISCOVERED_PROPERTIES_PROPERTY, LEGACY_AGENT_DISCOVERED_PROPERTIES_PROPERTY);
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
        setProvenanceProperty(draft, BOOKBOT_DISCOVERED_PROPERTIES_PROPERTY, LEGACY_AGENT_DISCOVERED_PROPERTIES_PROPERTY, JSON.stringify(sortedKeys));
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