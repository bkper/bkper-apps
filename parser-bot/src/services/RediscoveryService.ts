import { Account, Book, Transaction } from 'bkper-js';
import { AGENT_CREDIT_ACCOUNT_ID_PROPERTY, AGENT_DEBIT_ACCOUNT_ID_PROPERTY, AGENT_DISCOVERED_PROPERTIES_PROPERTY } from '../constants.js';
import { AppContext } from '../AppContext.js';
import { Discovery } from './DiscoveryService.js';

export class RediscoveryService {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    async rediscover(book: Book, transaction: Transaction, event: bkper.Event): Promise<string | null> {
        const previousCreditAccId = event.data?.previousAttributes?.creditAccId;
        const previousDebitAccId = event.data?.previousAttributes?.debitAccId;

        if (previousCreditAccId == null && previousDebitAccId == null) {
            console.log('No changes in accounts');
            return null;
        }

        const transactionAgentCreditAccId = transaction.getProperty(AGENT_CREDIT_ACCOUNT_ID_PROPERTY);
        const transactionAgentDebitAccId = transaction.getProperty(AGENT_DEBIT_ACCOUNT_ID_PROPERTY);
        const correctedCreditAccId = previousCreditAccId != null && transactionAgentCreditAccId === previousCreditAccId ? previousCreditAccId : undefined;
        const correctedDebitAccId = previousDebitAccId != null && transactionAgentDebitAccId === previousDebitAccId ? previousDebitAccId : undefined;

        if (!correctedCreditAccId && !correctedDebitAccId) {
            console.log('Changed account was not agent-discovered');
            return null;
        }

        const backlogCount = (await book.getBacklog()).getCount();

        if (backlogCount && backlogCount > 50) {
            console.log('Too many items on backlog');
            return null;
        }

        const drafts = (await book.listTransactions('is:draft', 100)).getItems();
        const affectedDrafts = drafts.filter((draft) =>
            (correctedCreditAccId != null && draft.getProperty(AGENT_CREDIT_ACCOUNT_ID_PROPERTY) === correctedCreditAccId) ||
            (correctedDebitAccId != null && draft.getProperty(AGENT_DEBIT_ACCOUNT_ID_PROPERTY) === correctedDebitAccId)
        );
        const updatedDrafts: Transaction[] = [];

        const discovery: Discovery = this.context.createDiscovery();
        for (const draft of affectedDrafts) {
            const draftAgentCreditAccId = draft.getProperty(AGENT_CREDIT_ACCOUNT_ID_PROPERTY);
            const draftAgentDebitAccId = draft.getProperty(AGENT_DEBIT_ACCOUNT_ID_PROPERTY);
            let sourceAccount: Account | undefined;

            // Resolve the original upload account before clearing the discovered side.
            try {
                sourceAccount = await this.resolveSourceAccount(book, draft, correctedCreditAccId, correctedDebitAccId);
            } catch (error) {
                console.warn('Source account resolution for property rediscovery failed:', error);
            }

            // Clear previously discovered accounts and their derived properties.
            if (correctedCreditAccId && draftAgentCreditAccId === correctedCreditAccId) {
                draft.setCreditAccount(null);
            }
            if (correctedDebitAccId && draftAgentDebitAccId === correctedDebitAccId) {
                draft.setDebitAccount(null);
            }
            this.clearDiscoveredProperties(draft);

            const discoveryResult = await discovery.discover(draft);
            if (discoveryResult.discovered) {
                if (sourceAccount && discoveryResult.dataSet) {
                    // Re-enrich properties using the account context that survived cleanup.
                    try {
                        await discovery.discoverProperties(sourceAccount, draft, discoveryResult.dataSet);
                    } catch (error) {
                        // Property enrichment is best-effort after account rediscovery succeeds.
                        console.warn('Property rediscovery error:', error);
                    }
                }
                updatedDrafts.push(draft);
            }
        }

        if (updatedDrafts.length > 0) {
            await book.batchUpdateTransactions(updatedDrafts);
            return `Found account(s) for ${updatedDrafts.length} draft(s)!`;
        }
        console.log('No drafts to update');
        return null;
    }

    private async resolveSourceAccount(book: Book, draft: Transaction, previousCreditAccId?: string, previousDebitAccId?: string): Promise<Account | undefined> {
        const sourceAccountIds = new Set<string>();
        const draftAgentCreditAccId = draft.getProperty(AGENT_CREDIT_ACCOUNT_ID_PROPERTY);
        const draftAgentDebitAccId = draft.getProperty(AGENT_DEBIT_ACCOUNT_ID_PROPERTY);

        // The non-agent account side is the original upload-account context.
        if (previousCreditAccId && draftAgentCreditAccId === previousCreditAccId) {
            const sourceAccountId = draft.payload.debitAccount?.id;
            if (sourceAccountId) {
                sourceAccountIds.add(sourceAccountId);
            }
        }
        if (previousDebitAccId && draftAgentDebitAccId === previousDebitAccId) {
            const sourceAccountId = draft.payload.creditAccount?.id;
            if (sourceAccountId) {
                sourceAccountIds.add(sourceAccountId);
            }
        }

        // Refuse to guess when the original account context is not unique.
        if (sourceAccountIds.size !== 1) {
            return undefined;
        }

        return book.getAccount(Array.from(sourceAccountIds)[0]);
    }

    private clearDiscoveredProperties(draft: Transaction): void {
        const discoveredProperties = draft.getProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY);
        if (!discoveredProperties) {
            return;
        }

        // Remove every property previously added by property discovery.
        const propertyKeys = JSON.parse(discoveredProperties) as string[];
        for (const key of propertyKeys) {
            draft.deleteProperty(key);
        }

        // Keep an explicit empty provenance log until the next discovery pass.
        draft.setProperty(AGENT_DISCOVERED_PROPERTIES_PROPERTY, '[]');
    }
}
