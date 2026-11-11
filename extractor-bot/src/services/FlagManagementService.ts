import { Account, Group, Book, File } from 'bkper-js';
import { AGENT_FILE_ID_PROPERTY, AGENT_PROMPT_IMPROVE_PROPERTY } from '../constants.js';

/**
 * Service to manage improvement flags on accounts and groups.
 * Flags are stored as ISO timestamp strings in the entity's properties.
 */
export class FlagManagementService {
    /**
     * Set improvement flag with current timestamp on an account or group.
     * The timestamp is stored as an ISO string directly in the property value.
     *
     * @param entity - The Account or Group to flag
     */
    async setImprovementFlag(entity: Account | Group, file: File): Promise<void> {
        const timestamp = new Date().toISOString();
        if (entity.getProperty(AGENT_PROMPT_IMPROVE_PROPERTY)) {
            // Flag already set, no need to update
            return;
        }
        entity.setProperty(AGENT_PROMPT_IMPROVE_PROPERTY, timestamp);
        await entity.update();
    }

    /**
     * Clear improvement flag from an account or group.
     *
     * @param entity - The Account or Group to clear flag from
     */
    async clearImprovementFlag(entity: Account | Group): Promise<void> {
        entity.deleteProperty(AGENT_PROMPT_IMPROVE_PROPERTY);
        entity.deleteProperty(AGENT_FILE_ID_PROPERTY);
        await entity.update();
    }

    /**
     * Query all flagged entities (accounts and groups) in the book.
     *
     * @param book - The Book to query
     * @returns Array of flagged entities with their timestamps and types
     */
    async getFlaggedEntity(book: Book): Promise<Account | Group | null> {
        const result: Array<{
            entity: Account | Group;
            timestamp: string;
        }> = [];

        // Query all accounts and filter for flagged ones
        const accounts = await book.getAccounts();
        for (const account of accounts) {
            const timestamp = account.getProperty(AGENT_PROMPT_IMPROVE_PROPERTY);
            if (timestamp) {
                result.push({
                    entity: account,
                    timestamp,
                });
            }
        }

        // Query all groups and filter for flagged ones
        const groups = await book.getGroups();
        for (const group of groups) {
            const timestamp = group.getProperty(AGENT_PROMPT_IMPROVE_PROPERTY);
            if (timestamp) {
                result.push({
                    entity: group,
                    timestamp,
                });
            }
        }

        if (result.length === 0) {
            return null;
        }

        // Sort by timestamp in descending order (most recent first)
        const sorted = [...result].sort((a, b) => {
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        });

        return sorted[0].entity;
    }

}
