import { Account, Group } from 'bkper-js';
import {
    AGENT_PROMPT_PROPERTY,
    AGENT_PROMPT_TRANSACTION_PROPERTY,
    AGENT_PROMPT_TRANSACTIONS_PROPERTY,
    AGENT_PROMPT_FILE_PROPERTY,
    AGENT_PARSER_TRANSACTION_PROPERTY,
    AGENT_PARSER_TRANSACTIONS_PROPERTY,
    AGENT_PARSER_FILE_PROPERTY,
} from '../constants.js';

const PROMPT_PROPERTY_MIGRATIONS = [
    { target: AGENT_PARSER_TRANSACTION_PROPERTY, legacy: AGENT_PROMPT_TRANSACTION_PROPERTY },
    { target: AGENT_PARSER_TRANSACTIONS_PROPERTY, legacy: AGENT_PROMPT_TRANSACTIONS_PROPERTY },
    { target: AGENT_PARSER_FILE_PROPERTY, legacy: AGENT_PROMPT_FILE_PROPERTY },
] as const;

export class LegacyPromptPropertyMigration {
    async migrateLegacyPromptProperties(entity: Account | Group | undefined): Promise<void> {
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
}
