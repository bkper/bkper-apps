import { Account, Book, Transaction, File, Group } from 'bkper-js';
import {
    ACCOUNT_ID_PROPERTY,
    PARSED_ACCOUNT_NAME_PROPERTY,
    AGENT_PROMPT_PROPERTY,
    AGENT_PROMPT_SKIP_PROPERTY,
    AGENT_EXCLUDED_PROPERTIES_PROPERTY,
    AGENT_PROMPT_TRANSACTION_PROPERTY,
    AGENT_PROMPT_TRANSACTIONS_PROPERTY,
    AGENT_PROMPT_FILE_PROPERTY,
    AGENT_PARSER_TRANSACTION_PROPERTY,
    AGENT_PARSER_TRANSACTIONS_PROPERTY,
    AGENT_PARSER_FILE_PROPERTY,
    GROUP_ID_PROPERTY,
    AGENT_PARSER_URL_TRANSACTION_PROPERTY,
    AGENT_PARSER_URL_TRANSACTIONS_PROPERTY,
    AGENT_PARSER_URL_FILE_PROPERTY,
    AGENT_DISCOVERY_EXAMPLES_PROPERTY,
} from '../constants.js';

export type PromptPurpose = 'transaction' | 'transactions' | 'file';

export interface PromptResolution {
    prompt?: string | undefined;
    account?: Account | undefined;
    group?: Group | undefined;
    promptEntity?: Account | Group | undefined;
    sourceProperty?: string | undefined;
    targetProperty: string;
}

export interface PromptLookupParams {
    book: Book;
    transaction?: Transaction;
    file?: File;
}

export interface PropertySkipLookupParams {
    book: Book;
    account?: Account;
    group?: Group;
}

export interface DiscoveryExamplesLookupParams {
    book: Book;
    account?: Account;
}

export interface ExtractorUrlLookupResult {
    url: string;
    source: 'account' | 'group' | 'book';
    account?: Account;
    group?: Group;
}

interface AccountCandidate {
    account: Account;
    groups: Group[];
}

interface StoredPrompt {
    prompt: string;
    promptEntity: Account | Group;
    sourceProperty: string;
    account?: Account;
    group?: Group;
}

const PROMPT_PROPERTY_MIGRATIONS = [
    { target: AGENT_PARSER_TRANSACTION_PROPERTY, legacy: AGENT_PROMPT_TRANSACTION_PROPERTY },
    { target: AGENT_PARSER_TRANSACTIONS_PROPERTY, legacy: AGENT_PROMPT_TRANSACTIONS_PROPERTY },
    { target: AGENT_PARSER_FILE_PROPERTY, legacy: AGENT_PROMPT_FILE_PROPERTY },
] as const;

export class PromptLookupContext {
    readonly account?: Account | undefined;
    readonly group?: Group | undefined;

    constructor(
        private readonly directAccount?: AccountCandidate | undefined,
        private readonly creditAccount?: AccountCandidate | undefined,
        private readonly debitAccount?: AccountCandidate | undefined,
        private readonly explicitGroup?: Group | undefined,
        private readonly filenameAccount?: AccountCandidate | undefined
    ) {
        this.account = directAccount?.account || (!explicitGroup ? filenameAccount?.account : undefined);
        this.group = this.account ? undefined : explicitGroup;
    }

    getPrompt(purpose: PromptPurpose): PromptResolution {
        const targetProperty = PromptLookupService.getPromptProperty(purpose);
        const legacyProperty = PromptLookupService.getLegacyPromptProperty(purpose);

        if (this.directAccount) {
            return this.resolveAccountPrompt(this.directAccount, targetProperty, legacyProperty);
        }

        const transactionSidePrompt = this.resolveTransactionSidePrompt(targetProperty, legacyProperty);
        if (transactionSidePrompt) {
            return {
                targetProperty,
                ...transactionSidePrompt,
            };
        }

        if (this.explicitGroup) {
            return this.resolveGroupPrompt(this.explicitGroup, targetProperty, legacyProperty);
        }

        if (this.filenameAccount) {
            return this.resolveAccountPrompt(this.filenameAccount, targetProperty, legacyProperty);
        }

        return { targetProperty };
    }

    private resolveAccountPrompt(candidate: AccountCandidate, targetProperty: string, legacyProperty: string): PromptResolution {
        const accountPurposePrompt = candidate.account.getProperty(targetProperty);
        if (accountPurposePrompt) {
            return {
                prompt: accountPurposePrompt,
                account: candidate.account,
                promptEntity: candidate.account,
                sourceProperty: targetProperty,
                targetProperty,
            };
        }

        for (const group of candidate.groups) {
            const groupPurposePrompt = group.getProperty(targetProperty);
            if (groupPurposePrompt) {
                return {
                    prompt: groupPurposePrompt,
                    account: candidate.account,
                    group,
                    promptEntity: group,
                    sourceProperty: targetProperty,
                    targetProperty,
                };
            }
        }

        const accountLegacyPurposePrompt = candidate.account.getProperty(legacyProperty);
        if (accountLegacyPurposePrompt) {
            return {
                prompt: accountLegacyPurposePrompt,
                account: candidate.account,
                promptEntity: candidate.account,
                sourceProperty: legacyProperty,
                targetProperty,
            };
        }

        for (const group of candidate.groups) {
            const groupLegacyPurposePrompt = group.getProperty(legacyProperty);
            if (groupLegacyPurposePrompt) {
                return {
                    prompt: groupLegacyPurposePrompt,
                    account: candidate.account,
                    group,
                    promptEntity: group,
                    sourceProperty: legacyProperty,
                    targetProperty,
                };
            }
        }

        const accountLegacyPrompt = candidate.account.getProperty(AGENT_PROMPT_PROPERTY);
        if (accountLegacyPrompt) {
            return {
                prompt: accountLegacyPrompt,
                account: candidate.account,
                promptEntity: candidate.account,
                sourceProperty: AGENT_PROMPT_PROPERTY,
                targetProperty,
            };
        }

        for (const group of candidate.groups) {
            const groupLegacyPrompt = group.getProperty(AGENT_PROMPT_PROPERTY);
            if (groupLegacyPrompt) {
                return {
                    prompt: groupLegacyPrompt,
                    account: candidate.account,
                    group,
                    promptEntity: group,
                    sourceProperty: AGENT_PROMPT_PROPERTY,
                    targetProperty,
                };
            }
        }

        return {
            account: candidate.account,
            promptEntity: candidate.account,
            targetProperty,
        };
    }

    private resolveGroupPrompt(group: Group, targetProperty: string, legacyProperty: string): PromptResolution {
        const groupPurposePrompt = group.getProperty(targetProperty);
        if (groupPurposePrompt) {
            return {
                prompt: groupPurposePrompt,
                group,
                promptEntity: group,
                sourceProperty: targetProperty,
                targetProperty,
            };
        }

        const groupLegacyPurposePrompt = group.getProperty(legacyProperty);
        if (groupLegacyPurposePrompt) {
            return {
                prompt: groupLegacyPurposePrompt,
                group,
                promptEntity: group,
                sourceProperty: legacyProperty,
                targetProperty,
            };
        }

        const groupLegacyPrompt = group.getProperty(AGENT_PROMPT_PROPERTY);
        if (groupLegacyPrompt) {
            return {
                prompt: groupLegacyPrompt,
                group,
                promptEntity: group,
                sourceProperty: AGENT_PROMPT_PROPERTY,
                targetProperty,
            };
        }

        return {
            group,
            promptEntity: group,
            targetProperty,
        };
    }

    private resolveTransactionSidePrompt(targetProperty: string, legacyProperty: string): StoredPrompt | undefined {
        const accountPurposePrompt = this.resolveSideAccountPrompt(targetProperty);
        if (accountPurposePrompt) {
            return accountPurposePrompt;
        }

        const groupPurposePrompt = this.resolveSideGroupPrompt(targetProperty);
        if (groupPurposePrompt) {
            return groupPurposePrompt;
        }

        const accountLegacyPurposePrompt = this.resolveSideAccountPrompt(legacyProperty);
        if (accountLegacyPurposePrompt) {
            return accountLegacyPurposePrompt;
        }

        const groupLegacyPurposePrompt = this.resolveSideGroupPrompt(legacyProperty);
        if (groupLegacyPurposePrompt) {
            return groupLegacyPurposePrompt;
        }

        const accountLegacyPrompt = this.resolveSideAccountPrompt(AGENT_PROMPT_PROPERTY);
        if (accountLegacyPrompt) {
            return accountLegacyPrompt;
        }

        return this.resolveSideGroupPrompt(AGENT_PROMPT_PROPERTY);
    }

    private resolveSideAccountPrompt(property: string): StoredPrompt | undefined {
        const creditPrompt = this.getAccountStoredPrompt(this.creditAccount, property);
        if (creditPrompt) {
            return creditPrompt;
        }
        return this.getAccountStoredPrompt(this.debitAccount, property);
    }

    private resolveSideGroupPrompt(property: string): StoredPrompt | undefined {
        const creditPrompt = this.getGroupStoredPrompt(this.creditAccount, property);
        if (creditPrompt) {
            return creditPrompt;
        }
        return this.getGroupStoredPrompt(this.debitAccount, property);
    }

    private getAccountStoredPrompt(candidate: AccountCandidate | undefined, property: string): StoredPrompt | undefined {
        if (!candidate) {
            return undefined;
        }

        const prompt = candidate.account.getProperty(property);
        if (!prompt) {
            return undefined;
        }

        return {
            prompt,
            account: candidate.account,
            promptEntity: candidate.account,
            sourceProperty: property,
        };
    }

    private getGroupStoredPrompt(candidate: AccountCandidate | undefined, property: string): StoredPrompt | undefined {
        if (!candidate) {
            return undefined;
        }

        for (const group of candidate.groups) {
            const prompt = group.getProperty(property);
            if (prompt) {
                return {
                    prompt,
                    account: candidate.account,
                    group,
                    promptEntity: group,
                    sourceProperty: property,
                };
            }
        }

        return undefined;
    }

    getParserUrl(purpose: PromptPurpose, book: Book): ExtractorUrlLookupResult | null {
        const property = PromptLookupService.getParserUrlProperty(purpose);

        if (this.directAccount) {
            const directAccountParserUrl = this.resolveAccountParserUrl(this.directAccount, property);
            if (directAccountParserUrl) {
                return directAccountParserUrl;
            }
        }

        const transactionSideParserUrl = this.resolveTransactionSideParserUrl(property);
        if (transactionSideParserUrl) {
            return transactionSideParserUrl;
        }

        if (this.explicitGroup) {
            const explicitGroupParserUrl = this.resolveGroupParserUrl(this.explicitGroup, property);
            if (explicitGroupParserUrl) {
                return explicitGroupParserUrl;
            }
        }

        if (this.filenameAccount) {
            const filenameAccountParserUrl = this.resolveAccountParserUrl(this.filenameAccount, property);
            if (filenameAccountParserUrl) {
                return filenameAccountParserUrl;
            }
        }

        const bookUrl = book.getProperty(property);
        if (bookUrl) {
            console.log(`Found ${property} on book: ${book.getName?.() || book.getId?.() || ''}`);
            const account = this.getParserAccountContext();
            return account ? { url: bookUrl, source: 'book', account } : { url: bookUrl, source: 'book' };
        }

        return null;
    }

    private getParserAccountContext(): Account | undefined {
        return this.directAccount?.account ?? this.creditAccount?.account ?? this.debitAccount?.account ?? (!this.explicitGroup ? this.filenameAccount?.account : undefined);
    }

    private resolveAccountParserUrl(candidate: AccountCandidate, property: string): ExtractorUrlLookupResult | null {
        const accountUrl = candidate.account.getProperty(property);
        if (accountUrl) {
            console.log(`Found ${property} on account: ${candidate.account.getName()}`);
            return { url: accountUrl, source: 'account', account: candidate.account };
        }

        for (const group of candidate.groups) {
            const groupUrl = group.getProperty(property);
            if (groupUrl) {
                console.log(`Found ${property} on group: ${group.getName()}`);
                return { url: groupUrl, source: 'group', account: candidate.account, group };
            }
        }

        return null;
    }

    private resolveGroupParserUrl(group: Group, property: string): ExtractorUrlLookupResult | null {
        const groupUrl = group.getProperty(property);
        if (groupUrl) {
            console.log(`Found ${property} on group: ${group.getName()}`);
            return { url: groupUrl, source: 'group', group };
        }
        return null;
    }

    private resolveTransactionSideParserUrl(property: string): ExtractorUrlLookupResult | null {
        const accountParserUrl = this.resolveSideAccountParserUrl(property);
        if (accountParserUrl) {
            return accountParserUrl;
        }
        return this.resolveSideGroupParserUrl(property);
    }

    private resolveSideAccountParserUrl(property: string): ExtractorUrlLookupResult | null {
        const creditParserUrl = this.getAccountParserUrl(this.creditAccount, property);
        if (creditParserUrl) {
            return creditParserUrl;
        }
        return this.getAccountParserUrl(this.debitAccount, property);
    }

    private resolveSideGroupParserUrl(property: string): ExtractorUrlLookupResult | null {
        const creditParserUrl = this.getGroupParserUrl(this.creditAccount, property);
        if (creditParserUrl) {
            return creditParserUrl;
        }
        return this.getGroupParserUrl(this.debitAccount, property);
    }

    private getAccountParserUrl(candidate: AccountCandidate | undefined, property: string): ExtractorUrlLookupResult | null {
        if (!candidate) {
            return null;
        }
        const url = candidate.account.getProperty(property);
        if (!url) {
            return null;
        }
        console.log(`Found ${property} on account: ${candidate.account.getName()}`);
        return { url, source: 'account', account: candidate.account };
    }

    private getGroupParserUrl(candidate: AccountCandidate | undefined, property: string): ExtractorUrlLookupResult | null {
        if (!candidate) {
            return null;
        }
        for (const group of candidate.groups) {
            const url = group.getProperty(property);
            if (url) {
                console.log(`Found ${property} on group: ${group.getName()}`);
                return { url, source: 'group', account: candidate.account, group };
            }
        }
        return null;
    }
}

export class PromptLookupService {
    async lookupDiscoveryExamples(params: DiscoveryExamplesLookupParams): Promise<string | undefined> {
        if (params.account) {
            const accountExamples = params.account.getProperty(AGENT_DISCOVERY_EXAMPLES_PROPERTY)?.trim();
            if (accountExamples) {
                return accountExamples;
            }

            const groups = await params.account.getGroups();
            for (const group of groups) {
                const groupExamples = group.getProperty(AGENT_DISCOVERY_EXAMPLES_PROPERTY)?.trim();
                if (groupExamples) {
                    return groupExamples;
                }
            }
        }

        return params.book.getProperty(AGENT_DISCOVERY_EXAMPLES_PROPERTY)?.trim() || undefined;
    }

    async lookupPropertySkipKeys(params: PropertySkipLookupParams): Promise<Set<string>> {
        // Resolve the most-specific account-level exclusion list first.
        if (params.account) {
            const accountKeys = PromptLookupService.getPropertySkipKeys(params.account);
            if (accountKeys.size > 0) {
                return accountKeys;
            }

            // Fall back through the account's groups in their existing order.
            const groups = await params.account.getGroups();
            for (const group of groups) {
                const groupKeys = PromptLookupService.getPropertySkipKeys(group);
                if (groupKeys.size > 0) {
                    return groupKeys;
                }
            }
        }

        // Support group-scoped ACE lookups when no account-level value wins.
        if (params.group) {
            const groupKeys = PromptLookupService.getPropertySkipKeys(params.group);
            if (groupKeys.size > 0) {
                return groupKeys;
            }
        }

        // Use the book value only when no more-specific value is configured.
        return PromptLookupService.getPropertySkipKeys(params.book);
    }

    private static getPropertySkipKeys(entity: Account | Group | Book): Set<string> {
        const excludedKeys = PromptLookupService.parsePropertySkipKeys(entity.getProperty(AGENT_EXCLUDED_PROPERTIES_PROPERTY));
        if (excludedKeys.size > 0) {
            return excludedKeys;
        }
        return PromptLookupService.parsePropertySkipKeys(entity.getProperty(AGENT_PROMPT_SKIP_PROPERTY));
    }

    static parsePropertySkipKeys(value: string | undefined): Set<string> {
        // Parse the canonical comma- or whitespace-separated configuration format.
        const keys = new Set<string>();
        if (!value) {
            return keys;
        }

        for (const rawKey of value.split(/[\s,]+/)) {
            const key = rawKey.trim().toLowerCase();
            if (key) {
                keys.add(key);
            }
        }

        return keys;
    }

    static getPromptProperty(purpose: PromptPurpose): string {
        switch (purpose) {
            case 'transaction':
                return AGENT_PARSER_TRANSACTION_PROPERTY;
            case 'transactions':
                return AGENT_PARSER_TRANSACTIONS_PROPERTY;
            case 'file':
                return AGENT_PARSER_FILE_PROPERTY;
        }
    }

    static getLegacyPromptProperty(purpose: PromptPurpose): string {
        switch (purpose) {
            case 'transaction':
                return AGENT_PROMPT_TRANSACTION_PROPERTY;
            case 'transactions':
                return AGENT_PROMPT_TRANSACTIONS_PROPERTY;
            case 'file':
                return AGENT_PROMPT_FILE_PROPERTY;
        }
    }

    static getParserUrlProperty(purpose: PromptPurpose): string {
        switch (purpose) {
            case 'transaction':
                return AGENT_PARSER_URL_TRANSACTION_PROPERTY;
            case 'transactions':
                return AGENT_PARSER_URL_TRANSACTIONS_PROPERTY;
            case 'file':
                return AGENT_PARSER_URL_FILE_PROPERTY;
        }
    }

    async lookupPrompts(params: PromptLookupParams): Promise<PromptLookupContext | null> {
        const directAccount = await this.lookupDirectAccount(params.book, params.transaction, params.file);
        const directAccountCandidate = await this.createAccountCandidate(directAccount);

        const creditAccount = await params.transaction?.getCreditAccount();
        const debitAccount = await params.transaction?.getDebitAccount();
        const creditAccountCandidate = await this.createAccountCandidate(creditAccount);
        const debitAccountCandidate = await this.createAccountCandidate(debitAccount);

        const groupId = params.file?.getProperty(GROUP_ID_PROPERTY, 'group_id_');
        const explicitGroup = groupId ? await params.book.getGroup(groupId) : undefined;
        await this.migrateLegacyPromptProperties(explicitGroup);

        const filenameAccount = await this.lookupFilenameAccount(params.book, params.file);
        const filenameAccountCandidate = await this.createAccountCandidate(filenameAccount);

        const hasTransactionSidePrompt = this.hasAnyPrompt(creditAccountCandidate) || this.hasAnyPrompt(debitAccountCandidate);
        const hasContext = !!directAccountCandidate || hasTransactionSidePrompt || !!explicitGroup || !!filenameAccountCandidate;
        if (!hasContext) {
            return null;
        }

        return new PromptLookupContext(
            directAccountCandidate,
            creditAccountCandidate,
            debitAccountCandidate,
            explicitGroup,
            filenameAccountCandidate
        );
    }

    async lookupParserUrl(params: PromptLookupParams & { purpose: PromptPurpose; account?: Account; group?: Group }): Promise<ExtractorUrlLookupResult | null> {
        const directAccount = params.account ?? await this.lookupDirectAccount(params.book, params.transaction, params.file);
        const directAccountCandidate = await this.createAccountCandidate(directAccount);

        const creditAccount = await params.transaction?.getCreditAccount();
        const debitAccount = await params.transaction?.getDebitAccount();
        const creditAccountCandidate = await this.createAccountCandidate(creditAccount);
        const debitAccountCandidate = await this.createAccountCandidate(debitAccount);

        let explicitGroup = params.group;
        if (!explicitGroup) {
            const groupId = params.file?.getProperty(GROUP_ID_PROPERTY, 'group_id_');
            explicitGroup = groupId ? await params.book.getGroup(groupId) : undefined;
        }
        await this.migrateLegacyPromptProperties(explicitGroup);

        const filenameAccount = await this.lookupFilenameAccount(params.book, params.file);
        const filenameAccountCandidate = await this.createAccountCandidate(filenameAccount);

        const context = new PromptLookupContext(
            directAccountCandidate,
            creditAccountCandidate,
            debitAccountCandidate,
            explicitGroup,
            filenameAccountCandidate
        );

        return context.getParserUrl(params.purpose, params.book);
    }

    async lookupTransactionParserUrl(params: PromptLookupParams & { account?: Account; group?: Group }): Promise<ExtractorUrlLookupResult | null> {
        return this.lookupParserUrl({ ...params, purpose: 'transaction' });
    }

    async lookupTransactionsParserUrl(params: PromptLookupParams & { account?: Account; group?: Group }): Promise<ExtractorUrlLookupResult | null> {
        return this.lookupParserUrl({ ...params, purpose: 'transactions' });
    }

    async lookupFileParserUrl(params: PromptLookupParams & { account?: Account; group?: Group }): Promise<ExtractorUrlLookupResult | null> {
        return this.lookupParserUrl({ ...params, purpose: 'file' });
    }

    private async lookupDirectAccount(book: Book, transaction: Transaction | undefined, file: File | undefined): Promise<Account | undefined> {
        const fileAccountIdProp = file?.getProperty(ACCOUNT_ID_PROPERTY, 'account_id_');
        if (fileAccountIdProp) {
            return book.getAccount(fileAccountIdProp);
        }

        const transactionAccountNameProp = transaction?.getProperty(PARSED_ACCOUNT_NAME_PROPERTY);
        if (transactionAccountNameProp) {
            return book.getAccount(transactionAccountNameProp);
        }

        return undefined;
    }

    private async lookupFilenameAccount(book: Book, file: File | undefined): Promise<Account | undefined> {
        const filename = file?.getName();
        if (!filename) {
            return undefined;
        }

        const accounts = await book.getAccounts();
        for (const account of accounts) {
            const accountName = account.getName();
            if (accountName && filename.toLowerCase().includes(accountName.toLowerCase())) {
                return account;
            }
        }

        return undefined;
    }

    private async createAccountCandidate(account: Account | undefined): Promise<AccountCandidate | undefined> {
        if (!account) {
            return undefined;
        }

        await this.migrateLegacyPromptProperties(account);
        const groups = await account.getGroups();
        for (const group of groups) {
            await this.migrateLegacyPromptProperties(group);
        }

        return {
            account,
            groups,
        };
    }

    private async migrateLegacyPromptProperties(entity: Account | Group | undefined): Promise<void> {
        if (!entity) {
            return;
        }

        const legacyProperties = [AGENT_PROMPT_TRANSACTION_PROPERTY, AGENT_PROMPT_TRANSACTIONS_PROPERTY, AGENT_PROMPT_FILE_PROPERTY, AGENT_PROMPT_PROPERTY];
        if (!legacyProperties.some((property) => entity.getProperty(property) !== undefined)) {
            return;
        }

        try {
            const genericPrompt = entity.getProperty(AGENT_PROMPT_PROPERTY);
            for (const migration of PROMPT_PROPERTY_MIGRATIONS) {
                if (!entity.getProperty(migration.target)) {
                    const legacyPrompt = entity.getProperty(migration.legacy) || genericPrompt;
                    if (legacyPrompt) {
                        entity.setProperty(migration.target, legacyPrompt);
                    }
                }
            }

            for (const property of legacyProperties) {
                entity.deleteProperty(property);
            }

            await entity.update();
            console.log(`Migrated parser prompt properties on ${entity.getName()}`);
        } catch (error) {
            console.error(`Failed to migrate parser prompt properties on ${entity.getName()}`, error);
        }
    }

    private hasAnyPrompt(candidate: AccountCandidate | undefined): boolean {
        if (!candidate) {
            return false;
        }

        if (this.hasAnyPromptOnEntity(candidate.account)) {
            return true;
        }

        return candidate.groups.some((group) => this.hasAnyPromptOnEntity(group));
    }

    private hasAnyPromptOnEntity(entity: Account | Group): boolean {
        return !!(
            entity.getProperty(AGENT_PARSER_TRANSACTION_PROPERTY) ||
            entity.getProperty(AGENT_PARSER_TRANSACTIONS_PROPERTY) ||
            entity.getProperty(AGENT_PARSER_FILE_PROPERTY) ||
            entity.getProperty(AGENT_PROMPT_TRANSACTION_PROPERTY) ||
            entity.getProperty(AGENT_PROMPT_TRANSACTIONS_PROPERTY) ||
            entity.getProperty(AGENT_PROMPT_FILE_PROPERTY) ||
            entity.getProperty(AGENT_PROMPT_PROPERTY)
        );
    }
}
