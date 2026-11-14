import { Account, Book, Group } from 'bkper-js';
import {
    AGENT_PROMPT_SKIP_PROPERTY,
    AGENT_EXCLUDED_PROPERTIES_PROPERTY,
} from '../constants.js';

/** Discovery settings lookup. Prompt and parser URL lookups belong to Extractor Bot. */
export interface PropertySkipLookupParams {
    book: Book;
    account?: Account;
    group?: Group;
}

export class PromptLookupService {
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
}
