import { Account, Book, Transaction, File, Group } from 'bkper-js';
import {
    ACCOUNT_ID_PROPERTY,
    PARSED_ACCOUNT_NAME_PROPERTY,
    AGENT_PROMPT_SKIP_PROPERTY,
    AGENT_EXCLUDED_PROPERTIES_PROPERTY,
    EXTRACTOR_PROMPT_TRANSACTION_PROPERTY,
    EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY,
    EXTRACTOR_PROMPT_FILE_PROPERTY,
    EXTRACTOR_URL_TRANSACTION_PROPERTY,
    EXTRACTOR_URL_TRANSACTIONS_PROPERTY,
    EXTRACTOR_URL_FILE_PROPERTY,
    GROUP_ID_PROPERTY,
    LEGACY_AGENT_PARSER_TRANSACTION_PROPERTY,
    LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY,
    LEGACY_AGENT_PARSER_FILE_PROPERTY,
    LEGACY_AGENT_PARSER_URL_TRANSACTION_PROPERTY,
    LEGACY_AGENT_PARSER_URL_TRANSACTIONS_PROPERTY,
    LEGACY_AGENT_PARSER_URL_FILE_PROPERTY,
    LEGACY_AGENT_PROMPT_PROPERTY,
    LEGACY_AGENT_PROMPT_TRANSACTION_PROPERTY,
    LEGACY_AGENT_PROMPT_TRANSACTIONS_PROPERTY,
    LEGACY_AGENT_PROMPT_FILE_PROPERTY,
} from '../constants.js';
import { LegacyPromptPropertyMigration } from './LegacyPromptPropertyMigration.js';

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

/** The first of the names, in order, holding a non-blank value on the resource, with that value. */
function findProperty(resource: Account | Group | Book, properties: readonly string[]): { property: string; value: string } | undefined {
    for (const property of properties) {
        const value = resource.getProperty(property);
        if (value) {
            return { property, value };
        }
    }
    return undefined;
}

export class PromptLookupContext {
    readonly account?: Account | undefined;
    readonly group?: Group | undefined;

    constructor(
        private readonly directAccount?: AccountCandidate | undefined,
        private readonly creditAccount?: AccountCandidate | undefined,
        private readonly debitAccount?: AccountCandidate | undefined,
        private readonly explicitGroup?: Group | undefined,
        private readonly filenameAccount?: AccountCandidate | undefined,
        private readonly log = true
    ) {
        this.account = directAccount?.account || (!explicitGroup ? filenameAccount?.account : undefined);
        this.group = this.account ? undefined : explicitGroup;
    }

    getPrompt(purpose: PromptPurpose): PromptResolution {
        const targetProperty = PromptLookupService.getPromptProperty(purpose);
        // A renamed prompt is the same setting: read both names before falling back to legacy prompts.
        const purposeProperties = [targetProperty, PromptLookupService.getRenamedPromptProperty(purpose)];
        const legacyProperty = PromptLookupService.getLegacyPromptProperty(purpose);

        if (this.directAccount) {
            return this.resolveAccountPrompt(this.directAccount, targetProperty, purposeProperties, legacyProperty);
        }

        const transactionSidePrompt = this.resolveTransactionSidePrompt(purposeProperties, legacyProperty);
        if (transactionSidePrompt) {
            return {
                targetProperty,
                ...transactionSidePrompt,
            };
        }

        if (this.explicitGroup) {
            return this.resolveGroupPrompt(this.explicitGroup, targetProperty, purposeProperties, legacyProperty);
        }

        if (this.filenameAccount) {
            return this.resolveAccountPrompt(this.filenameAccount, targetProperty, purposeProperties, legacyProperty);
        }

        return { targetProperty };
    }

    private resolveAccountPrompt(candidate: AccountCandidate, targetProperty: string, purposeProperties: readonly string[], legacyProperty: string): PromptResolution {
        const accountPurposePrompt = findProperty(candidate.account, purposeProperties);
        if (accountPurposePrompt) {
            return {
                prompt: accountPurposePrompt.value,
                account: candidate.account,
                promptEntity: candidate.account,
                sourceProperty: accountPurposePrompt.property,
                targetProperty,
            };
        }

        for (const group of candidate.groups) {
            const groupPurposePrompt = findProperty(group, purposeProperties);
            if (groupPurposePrompt) {
                return {
                    prompt: groupPurposePrompt.value,
                    account: candidate.account,
                    group,
                    promptEntity: group,
                    sourceProperty: groupPurposePrompt.property,
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

        const accountLegacyPrompt = candidate.account.getProperty(LEGACY_AGENT_PROMPT_PROPERTY);
        if (accountLegacyPrompt) {
            return {
                prompt: accountLegacyPrompt,
                account: candidate.account,
                promptEntity: candidate.account,
                sourceProperty: LEGACY_AGENT_PROMPT_PROPERTY,
                targetProperty,
            };
        }

        for (const group of candidate.groups) {
            const groupLegacyPrompt = group.getProperty(LEGACY_AGENT_PROMPT_PROPERTY);
            if (groupLegacyPrompt) {
                return {
                    prompt: groupLegacyPrompt,
                    account: candidate.account,
                    group,
                    promptEntity: group,
                    sourceProperty: LEGACY_AGENT_PROMPT_PROPERTY,
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

    private resolveGroupPrompt(group: Group, targetProperty: string, purposeProperties: readonly string[], legacyProperty: string): PromptResolution {
        const groupPurposePrompt = findProperty(group, purposeProperties);
        if (groupPurposePrompt) {
            return {
                prompt: groupPurposePrompt.value,
                group,
                promptEntity: group,
                sourceProperty: groupPurposePrompt.property,
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

        const groupLegacyPrompt = group.getProperty(LEGACY_AGENT_PROMPT_PROPERTY);
        if (groupLegacyPrompt) {
            return {
                prompt: groupLegacyPrompt,
                group,
                promptEntity: group,
                sourceProperty: LEGACY_AGENT_PROMPT_PROPERTY,
                targetProperty,
            };
        }

        return {
            group,
            promptEntity: group,
            targetProperty,
        };
    }

    private resolveTransactionSidePrompt(purposeProperties: readonly string[], legacyProperty: string): StoredPrompt | undefined {
        const accountPurposePrompt = this.resolveSideAccountPrompt(purposeProperties);
        if (accountPurposePrompt) {
            return accountPurposePrompt;
        }

        const groupPurposePrompt = this.resolveSideGroupPrompt(purposeProperties);
        if (groupPurposePrompt) {
            return groupPurposePrompt;
        }

        const accountLegacyPurposePrompt = this.resolveSideAccountPrompt([legacyProperty]);
        if (accountLegacyPurposePrompt) {
            return accountLegacyPurposePrompt;
        }

        const groupLegacyPurposePrompt = this.resolveSideGroupPrompt([legacyProperty]);
        if (groupLegacyPurposePrompt) {
            return groupLegacyPurposePrompt;
        }

        const accountLegacyPrompt = this.resolveSideAccountPrompt([LEGACY_AGENT_PROMPT_PROPERTY]);
        if (accountLegacyPrompt) {
            return accountLegacyPrompt;
        }

        return this.resolveSideGroupPrompt([LEGACY_AGENT_PROMPT_PROPERTY]);
    }

    private resolveSideAccountPrompt(properties: readonly string[]): StoredPrompt | undefined {
        const creditPrompt = this.getAccountStoredPrompt(this.creditAccount, properties);
        if (creditPrompt) {
            return creditPrompt;
        }
        return this.getAccountStoredPrompt(this.debitAccount, properties);
    }

    private resolveSideGroupPrompt(properties: readonly string[]): StoredPrompt | undefined {
        const creditPrompt = this.getGroupStoredPrompt(this.creditAccount, properties);
        if (creditPrompt) {
            return creditPrompt;
        }
        return this.getGroupStoredPrompt(this.debitAccount, properties);
    }

    private getAccountStoredPrompt(candidate: AccountCandidate | undefined, properties: readonly string[]): StoredPrompt | undefined {
        if (!candidate) {
            return undefined;
        }

        const prompt = findProperty(candidate.account, properties);
        if (!prompt) {
            return undefined;
        }

        return {
            prompt: prompt.value,
            account: candidate.account,
            promptEntity: candidate.account,
            sourceProperty: prompt.property,
        };
    }

    private getGroupStoredPrompt(candidate: AccountCandidate | undefined, properties: readonly string[]): StoredPrompt | undefined {
        if (!candidate) {
            return undefined;
        }

        for (const group of candidate.groups) {
            const prompt = findProperty(group, properties);
            if (prompt) {
                return {
                    prompt: prompt.value,
                    account: candidate.account,
                    group,
                    promptEntity: group,
                    sourceProperty: prompt.property,
                };
            }
        }

        return undefined;
    }

    getParserUrl(purpose: PromptPurpose, book: Book): ExtractorUrlLookupResult | null {
        // Customers configure parser URLs; both names keep working and neither is ever rewritten.
        const properties = [PromptLookupService.getParserUrlProperty(purpose), PromptLookupService.getRenamedParserUrlProperty(purpose)];

        if (this.directAccount) {
            const directAccountParserUrl = this.resolveAccountParserUrl(this.directAccount, properties);
            if (directAccountParserUrl) {
                return directAccountParserUrl;
            }
        }

        const transactionSideParserUrl = this.resolveTransactionSideParserUrl(properties);
        if (transactionSideParserUrl) {
            return transactionSideParserUrl;
        }

        if (this.explicitGroup) {
            const explicitGroupParserUrl = this.resolveGroupParserUrl(this.explicitGroup, properties);
            if (explicitGroupParserUrl) {
                return explicitGroupParserUrl;
            }
        }

        if (this.filenameAccount) {
            const filenameAccountParserUrl = this.resolveAccountParserUrl(this.filenameAccount, properties);
            if (filenameAccountParserUrl) {
                return filenameAccountParserUrl;
            }
        }

        const bookUrl = findProperty(book, properties);
        if (bookUrl) {
            if (this.log) console.log(`Found ${bookUrl.property} on book: ${book.getName?.() || book.getId?.() || ''}`);
            const account = this.getParserAccountContext();
            return account ? { url: bookUrl.value, source: 'book', account } : { url: bookUrl.value, source: 'book' };
        }

        return null;
    }

    private getParserAccountContext(): Account | undefined {
        return this.directAccount?.account ?? this.creditAccount?.account ?? this.debitAccount?.account ?? (!this.explicitGroup ? this.filenameAccount?.account : undefined);
    }

    private resolveAccountParserUrl(candidate: AccountCandidate, properties: readonly string[]): ExtractorUrlLookupResult | null {
        const accountUrl = findProperty(candidate.account, properties);
        if (accountUrl) {
            if (this.log) console.log(`Found ${accountUrl.property} on account: ${candidate.account.getName()}`);
            return { url: accountUrl.value, source: 'account', account: candidate.account };
        }

        for (const group of candidate.groups) {
            const groupUrl = findProperty(group, properties);
            if (groupUrl) {
                if (this.log) console.log(`Found ${groupUrl.property} on group: ${group.getName()}`);
                return { url: groupUrl.value, source: 'group', account: candidate.account, group };
            }
        }

        return null;
    }

    private resolveGroupParserUrl(group: Group, properties: readonly string[]): ExtractorUrlLookupResult | null {
        const groupUrl = findProperty(group, properties);
        if (groupUrl) {
            if (this.log) console.log(`Found ${groupUrl.property} on group: ${group.getName()}`);
            return { url: groupUrl.value, source: 'group', group };
        }
        return null;
    }

    private resolveTransactionSideParserUrl(properties: readonly string[]): ExtractorUrlLookupResult | null {
        const accountParserUrl = this.resolveSideAccountParserUrl(properties);
        if (accountParserUrl) {
            return accountParserUrl;
        }
        return this.resolveSideGroupParserUrl(properties);
    }

    private resolveSideAccountParserUrl(properties: readonly string[]): ExtractorUrlLookupResult | null {
        const creditParserUrl = this.getAccountParserUrl(this.creditAccount, properties);
        if (creditParserUrl) {
            return creditParserUrl;
        }
        return this.getAccountParserUrl(this.debitAccount, properties);
    }

    private resolveSideGroupParserUrl(properties: readonly string[]): ExtractorUrlLookupResult | null {
        const creditParserUrl = this.getGroupParserUrl(this.creditAccount, properties);
        if (creditParserUrl) {
            return creditParserUrl;
        }
        return this.getGroupParserUrl(this.debitAccount, properties);
    }

    private getAccountParserUrl(candidate: AccountCandidate | undefined, properties: readonly string[]): ExtractorUrlLookupResult | null {
        if (!candidate) {
            return null;
        }
        const url = findProperty(candidate.account, properties);
        if (!url) {
            return null;
        }
        if (this.log) console.log(`Found ${url.property} on account: ${candidate.account.getName()}`);
        return { url: url.value, source: 'account', account: candidate.account };
    }

    private getGroupParserUrl(candidate: AccountCandidate | undefined, properties: readonly string[]): ExtractorUrlLookupResult | null {
        if (!candidate) {
            return null;
        }
        for (const group of candidate.groups) {
            const url = findProperty(group, properties);
            if (url) {
                if (this.log) console.log(`Found ${url.property} on group: ${group.getName()}`);
                return { url: url.value, source: 'group', account: candidate.account, group };
            }
        }
        return null;
    }
}

export class PromptLookupService {
    constructor(private readonly migration: LegacyPromptPropertyMigration = new LegacyPromptPropertyMigration(), private readonly log = true) { }

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
                return EXTRACTOR_PROMPT_TRANSACTION_PROPERTY;
            case 'transactions':
                return EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY;
            case 'file':
                return EXTRACTOR_PROMPT_FILE_PROPERTY;
        }
    }

    static getRenamedPromptProperty(purpose: PromptPurpose): string {
        switch (purpose) {
            case 'transaction':
                return LEGACY_AGENT_PARSER_TRANSACTION_PROPERTY;
            case 'transactions':
                return LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY;
            case 'file':
                return LEGACY_AGENT_PARSER_FILE_PROPERTY;
        }
    }

    static getLegacyPromptProperty(purpose: PromptPurpose): string {
        switch (purpose) {
            case 'transaction':
                return LEGACY_AGENT_PROMPT_TRANSACTION_PROPERTY;
            case 'transactions':
                return LEGACY_AGENT_PROMPT_TRANSACTIONS_PROPERTY;
            case 'file':
                return LEGACY_AGENT_PROMPT_FILE_PROPERTY;
        }
    }

    static getParserUrlProperty(purpose: PromptPurpose): string {
        switch (purpose) {
            case 'transaction':
                return EXTRACTOR_URL_TRANSACTION_PROPERTY;
            case 'transactions':
                return EXTRACTOR_URL_TRANSACTIONS_PROPERTY;
            case 'file':
                return EXTRACTOR_URL_FILE_PROPERTY;
        }
    }

    static getRenamedParserUrlProperty(purpose: PromptPurpose): string {
        switch (purpose) {
            case 'transaction':
                return LEGACY_AGENT_PARSER_URL_TRANSACTION_PROPERTY;
            case 'transactions':
                return LEGACY_AGENT_PARSER_URL_TRANSACTIONS_PROPERTY;
            case 'file':
                return LEGACY_AGENT_PARSER_URL_FILE_PROPERTY;
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
        await this.migration.migrateLegacyPromptProperties(explicitGroup);

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
            filenameAccountCandidate,
            this.log
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
        await this.migration.migrateLegacyPromptProperties(explicitGroup);

        const filenameAccount = await this.lookupFilenameAccount(params.book, params.file);
        const filenameAccountCandidate = await this.createAccountCandidate(filenameAccount);

        const context = new PromptLookupContext(
            directAccountCandidate,
            creditAccountCandidate,
            debitAccountCandidate,
            explicitGroup,
            filenameAccountCandidate,
            this.log
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

        await this.migration.migrateLegacyPromptProperties(account);
        const groups = await account.getGroups();
        for (const group of groups) {
            await this.migration.migrateLegacyPromptProperties(group);
        }

        return {
            account,
            groups,
        };
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
            entity.getProperty(EXTRACTOR_PROMPT_TRANSACTION_PROPERTY) ||
            entity.getProperty(EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY) ||
            entity.getProperty(EXTRACTOR_PROMPT_FILE_PROPERTY) ||
            entity.getProperty(LEGACY_AGENT_PARSER_TRANSACTION_PROPERTY) ||
            entity.getProperty(LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY) ||
            entity.getProperty(LEGACY_AGENT_PARSER_FILE_PROPERTY) ||
            entity.getProperty(LEGACY_AGENT_PROMPT_TRANSACTION_PROPERTY) ||
            entity.getProperty(LEGACY_AGENT_PROMPT_TRANSACTIONS_PROPERTY) ||
            entity.getProperty(LEGACY_AGENT_PROMPT_FILE_PROPERTY) ||
            entity.getProperty(LEGACY_AGENT_PROMPT_PROPERTY)
        );
    }
}
