import { Account, Group } from 'bkper-js';
import {
    EXTRACTOR_PROMPT_FILE_PROPERTY,
    EXTRACTOR_PROMPT_TRANSACTION_PROPERTY,
    EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY,
    LEGACY_AGENT_PARSER_FILE_PROPERTY,
    LEGACY_AGENT_PARSER_TRANSACTION_PROPERTY,
    LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY,
    LEGACY_AGENT_PROMPT_FILE_PROPERTY,
    LEGACY_AGENT_PROMPT_PROPERTY,
    LEGACY_AGENT_PROMPT_TRANSACTION_PROPERTY,
    LEGACY_AGENT_PROMPT_TRANSACTIONS_PROPERTY,
} from '../constants.js';

// Old names of each prompt property, most recent first.
const PROMPT_PROPERTY_MIGRATIONS = [
    { target: EXTRACTOR_PROMPT_TRANSACTION_PROPERTY, legacy: [LEGACY_AGENT_PARSER_TRANSACTION_PROPERTY, LEGACY_AGENT_PROMPT_TRANSACTION_PROPERTY] },
    { target: EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY, legacy: [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY, LEGACY_AGENT_PROMPT_TRANSACTIONS_PROPERTY] },
    { target: EXTRACTOR_PROMPT_FILE_PROPERTY, legacy: [LEGACY_AGENT_PARSER_FILE_PROPERTY, LEGACY_AGENT_PROMPT_FILE_PROPERTY] },
] as const;

const LEGACY_PROMPT_PROPERTIES = [...PROMPT_PROPERTY_MIGRATIONS.flatMap((migration) => migration.legacy), LEGACY_AGENT_PROMPT_PROPERTY];

export class LegacyPromptPropertyMigration {
    async migrateLegacyPromptProperties(entity: Account | Group | undefined): Promise<void> {
        if (!entity) {
            return;
        }

        if (!LEGACY_PROMPT_PROPERTIES.some((property) => entity.getProperty(property) !== undefined)) {
            return;
        }

        try {
            const genericPrompt = entity.getProperty(LEGACY_AGENT_PROMPT_PROPERTY);
            for (const migration of PROMPT_PROPERTY_MIGRATIONS) {
                if (!entity.getProperty(migration.target)) {
                    const legacyPrompt = entity.getProperty(...migration.legacy) || genericPrompt;
                    if (legacyPrompt) {
                        entity.setProperty(migration.target, legacyPrompt);
                    }
                }
            }

            for (const property of LEGACY_PROMPT_PROPERTIES) {
                entity.deleteProperty(property);
            }

            await entity.update();
            console.log(`Migrated parser prompt properties on ${entity.getName()}`);
        } catch (error) {
            console.error(`Failed to migrate parser prompt properties on ${entity.getName()}`, error);
        }
    }
}
